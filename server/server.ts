import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { getLocalizedCatalogue } from './src/data/catalogue.ts';
import { t } from './src/i18n/strings.ts';
import {
  FALLBACK_IDS,
  clampText,
  moodString,
  buildSelectionPrompt,
  buildTextsPrompt,
  buildAnnotatePrompt,
  parseModelJSON,
  normalizeAnnotationPoints,
} from './src/shared/prompts.ts';
import { synthesize, MAX_TTS_CHARS } from './server/tts.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));

const geminiApiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Modèle texte/vision. L'original utilisait gemini-3.1-flash-lite ; le portage
// gemini-3.8-flash. Surchargeable sans toucher au code : GEMINI_MODEL=...
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// Limiteur de débit minimal (par IP, fenêtre d'une minute) pour protéger la clé API.
function rateLimit(max: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || 'anon';
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now > h.reset) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > max) return res.status(429).json({ error: 'Too many requests' });
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    next();
  };
}
app.set('trust proxy', 1);

const asLang = (v: unknown): 'fr' | 'en' => (v === 'en' ? 'en' : 'fr');

async function askGemini(contents: any, temperature: number): Promise<any> {
  const response = await ai!.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: { responseMimeType: 'application/json', temperature, maxOutputTokens: 8192 },
  });
  return parseModelJSON(response.text);
}

// ─── POST /api/curate — sélection (appel 1) puis textes personnalisés (appel 2) ───
app.post('/api/curate', rateLimit(12), async (req, res) => {
  const lang = asLang(req.body?.lang);
  const tags: string[] = (Array.isArray(req.body?.tags) ? req.body.tags : [])
    .map((x: unknown) => clampText(x, 40))
    .filter(Boolean)
    .slice(0, 12);
  const freeText = clampText(req.body?.freeText, 600);
  const catalogue = getLocalizedCatalogue(lang);
  const fallbackResponse = () => ({
    introText: t('fallback_intro', lang),
    paintings: FALLBACK_IDS.map(id => catalogue.find(c => c.id === id)).filter(Boolean),
  });

  if (!ai || (tags.length === 0 && !freeText)) return res.json(fallbackResponse());

  try {
    const mood = moodString(tags, freeText, lang);

    // Variation quotidienne : le catalogue est mélangé avec une graine qui change toutes les 24 h.
    const daySeed = Math.floor(Date.now() / 86400000);
    const shuffled = seededShuffle(catalogue, mulberry32(daySeed));

    // Appel 1 — choix des œuvres + raison
    const j1 = await askGemini(buildSelectionPrompt({ lang, mood, catalogue: shuffled, daySeed }), 0.95);
    const reasonMap: Record<string, string> = {};
    const ids: string[] = (j1.selected || []).slice(0, 10).map((item: any) => {
      if (typeof item === 'string') return item;
      reasonMap[item.id] = item.reason || '';
      return item.id;
    });
    const base = ids.map(id => catalogue.find(c => c.id === id)).filter(Boolean) as typeof catalogue;
    // doublons éventuels
    const picked = base.filter((p, i) => base.findIndex(q => q.id === p.id) === i);
    if (picked.length < 2) throw new Error(`Seulement ${picked.length} IDs valides reçus`);

    // Appel 2 — méditation / raison / anecdote / questions (non bloquant si cet appel échoue)
    let tm: Record<string, any> = {};
    try {
      const j2 = await askGemini(
        buildTextsPrompt({ lang, mood, picks: picked.map(p => ({ p, reason: reasonMap[p.id] })) }),
        0.85
      );
      for (const item of j2.texts || []) tm[item.id] = item;
    } catch (e: any) {
      console.warn('Curate: appel 2 (textes) échoué, on garde les raisons de l\'appel 1 —', e.message);
    }

    res.json({
      introText: j1.intro || t('fallback_intro', lang),
      paintings: picked.map(p => ({
        id: p.id,
        meditation: tm[p.id]?.meditation || p.desc,
        raison: tm[p.id]?.raison || reasonMap[p.id] || '',
        anecdote: tm[p.id]?.anecdote || '',
        questions: Array.isArray(tm[p.id]?.questions) ? tm[p.id].questions : [],
      })),
    });
  } catch (err: any) {
    console.error('Curate error:', err.message || err);
    res.json(fallbackResponse());
  }
});

// ─── POST /api/annotate — points d'attention ancrés dans l'image (vision) ───
app.post('/api/annotate', rateLimit(30), async (req, res) => {
  try {
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    const { painting, image } = req.body || {};
    if (!painting || typeof painting.title !== 'string') return res.status(400).json({ error: 'painting required' });
    const lang = asLang(req.body?.lang);

    const prompt = buildAnnotatePrompt({
      lang,
      painting: {
        title: clampText(painting.title, 200),
        artist: clampText(painting.artist, 120),
        year: clampText(painting.year, 40),
        desc: clampText(painting.desc, 800),
        raison: clampText(painting.raison, 600),
        meditation: clampText(painting.meditation, 1200),
      },
      userMood: clampText(req.body?.userMood, 800),
    });

    // L'image passe en PREMIER pour que le modèle s'ancre dans la toile réelle.
    const parts: any[] = [];
    if (image && typeof image.data === 'string' && image.data.length > 0) {
      parts.push({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } });
    }
    parts.push({ text: prompt });

    // Température basse → coordonnées plus précises.
    const json = await askGemini([{ role: 'user', parts }], 0.2);
    const points = normalizeAnnotationPoints(json);
    if (!points.length) return res.status(502).json({ error: 'No usable points returned' });
    res.json({ points });
  } catch (err: any) {
    console.error('Annotate error:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/report — Artwork reporting ───
app.post('/api/report', (req, res) => {
  console.log('[Report Received]', req.body);
  res.json({ ok: true, received: true });
});

// ─── POST /api/feedback — Gallery visit feedback ───
app.post('/api/feedback', (req, res) => {
  console.log('[Feedback Received]', req.body);
  res.json({ ok: true, received: true });
});

// ─── POST /tts — narration vocale (Gemini TTS) ───
// Renvoie un WAV. En cas d'échec le client bascule sur la voix du navigateur.
app.post('/tts', rateLimit(60), async (req, res) => {
  const text = clampText(req.body?.text, MAX_TTS_CHARS);
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!geminiApiKey) return res.status(501).json({ error: 'GEMINI_API_KEY not configured' });
  try {
    const wav = await synthesize(text, req.body?.voice, geminiApiKey);
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=86400' });
    res.send(wav);
  } catch (err: any) {
    console.error('TTS error:', err.message || err);
    res.status(502).json({ error: 'TTS unavailable' });
  }
});

// ─── Static files and Vite integration ───
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
