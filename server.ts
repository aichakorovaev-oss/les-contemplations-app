import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
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
import { DEFAULT_TEXT_MODELS, parseModels, withFallback } from './server/fallback.ts';
import { languageMismatch, languageSystemInstruction } from './src/shared/lang.ts';
import { checkStorage, describeConfig, logDatasetFiles, sanitizeFeedback, sanitizeReport, saveRecord } from './server/storage.ts';

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

// Modèles texte/vision, par ordre de préférence. Si l'un répond 503 (forte demande), 429, etc.,
// on passe au suivant. Surchargeable : GEMINI_MODELS="a,b,c" (liste) et/ou GEMINI_MODEL="a" (prioritaire).
const TEXT_MODELS = parseModels(process.env.GEMINI_MODELS, process.env.GEMINI_MODEL, DEFAULT_TEXT_MODELS);
console.log('Modèles Gemini (ordre de repli) :', TEXT_MODELS.join(' → '));

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

/**
 * Appelle Gemini en JSON avec repli automatique entre modèles.
 * - la langue attendue est imposée en consigne système (le prompt d'origine est surtout en français) ;
 * - `validate` (facultatif) rejette une sortie inexploitable ou dans la mauvaise langue :
 *   le modèle suivant est alors essayé.
 */
async function askGemini(
  contents: any,
  temperature: number,
  lang: 'fr' | 'en',
  validate?: (json: any) => void
): Promise<any> {
  return withFallback(TEXT_MODELS, async model => {
    const response = await ai!.models.generateContent({
      model,
      contents,
      config: {
        responseMimeType: 'application/json',
        temperature,
        maxOutputTokens: 8192,
        systemInstruction: languageSystemInstruction(lang),
      },
    });
    const json = parseModelJSON(response.text);
    if (!json || typeof json !== 'object' || Object.keys(json).length === 0) {
      throw new Error('JSON invalide : réponse vide');
    }
    if (validate) validate(json);
    return json;
  });
}

const assertLang = (lang: 'fr' | 'en', ...texts: (string | undefined)[]) => {
  if (languageMismatch(texts.filter(Boolean).join(' '), lang)) {
    throw new Error('JSON invalide : langue incorrecte');
  }
};

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
    const j1 = await askGemini(buildSelectionPrompt({ lang, mood, catalogue: shuffled, daySeed }), 0.95, lang, json => {
      const known = (json.selected || []).filter((it: any) => catalogue.some(c => c.id === (typeof it === 'string' ? it : it?.id)));
      if (known.length < 2) throw new Error('JSON invalide : sélection inexploitable');
      assertLang(lang, json.intro, ...(json.selected || []).map((it: any) => it?.reason));
    });
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
        0.85,
        lang,
        validateTexts(lang)
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

const validateTexts = (lang: 'fr' | 'en') => (json: any) => {
  const texts = Array.isArray(json.texts) ? json.texts : [];
  if (!texts.length) throw new Error('JSON invalide : aucun texte');
  assertLang(lang, ...texts.map((x: any) => x?.meditation), ...texts.map((x: any) => x?.raison), ...texts.map((x: any) => x?.anecdote));
};

// ─── POST /api/texts — régénère méditation / raison / anecdote / questions dans une autre langue ───
// Utilisé quand le visiteur change de langue en cours de visite (sans recomposer le parcours).
app.post('/api/texts', rateLimit(12), async (req, res) => {
  try {
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    const lang = asLang(req.body?.lang);
    const catalogue = getLocalizedCatalogue(lang);
    const ids: string[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x: unknown) => String(x)).slice(0, 12);
    const picks = ids.map(id => catalogue.find(c => c.id === id)).filter(Boolean).map(p => ({ p: p! }));
    if (!picks.length) return res.status(400).json({ error: 'ids required' });
    const tags: string[] = (Array.isArray(req.body?.tags) ? req.body.tags : [])
      .map((x: unknown) => clampText(x, 40))
      .filter(Boolean)
      .slice(0, 12);
    const mood = moodString(tags, clampText(req.body?.freeText, 600), lang);
    const json = await askGemini(buildTextsPrompt({ lang, mood, picks }), 0.85, lang, validateTexts(lang));
    res.json({
      texts: json.texts.map((x: any) => ({
        id: String(x?.id || ''),
        meditation: x?.meditation || '',
        raison: x?.raison || '',
        anecdote: x?.anecdote || '',
        questions: Array.isArray(x?.questions) ? x.questions : [],
      })),
    });
  } catch (err: any) {
    console.error('Texts error:', err.message || err);
    res.status(502).json({ error: 'texts unavailable' });
  }
});

// ─── POST /api/annotate — points d'attention ancrés dans l'image (vision) ───
app.post('/api/annotate', rateLimit(30), async (req, res) => {
  try {
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    const { painting, image } = req.body || {};
    if (!painting || typeof painting.title !== 'string') return res.status(400).json({ error: 'painting required' });
    const lang = asLang(req.body?.lang);
    const moodTags: string[] = (Array.isArray(req.body?.moodTags) ? req.body.moodTags : [])
      .map((x: unknown) => clampText(x, 40))
      .filter(Boolean)
      .slice(0, 12);
    const moodText = clampText(req.body?.moodText, 600);

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
      // Étiquettes + texte libre reconstruits dans la langue courante (l'ancien champ userMood reste accepté)
      userMood: moodTags.length || moodText
        ? moodString(moodTags, moodText, lang)
        : clampText(req.body?.userMood, 800),
    });

    // L'image passe en PREMIER pour que le modèle s'ancre dans la toile réelle.
    const parts: any[] = [];
    if (image && typeof image.data === 'string' && image.data.length > 0) {
      parts.push({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } });
    }
    parts.push({ text: prompt });

    // Température basse → coordonnées plus précises.
    const json = await askGemini([{ role: 'user', parts }], 0.2, lang, j => {
      const pts = normalizeAnnotationPoints(j);
      if (!pts.length) throw new Error('JSON invalide : aucun point exploitable');
      assertLang(lang, ...pts.map(p => p.text), ...pts.map(p => p.label));
    });
    const points = normalizeAnnotationPoints(json);
    if (!points.length) return res.status(502).json({ error: 'No usable points returned' });
    res.json({ points });
  } catch (err: any) {
    console.error('Annotate error:', err.message || err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Retours visiteurs : signalements d'œuvres et feedback → dataset Hugging Face ───
// (voir server/storage.ts ; sans configuration, repli sur un fichier local éphémère)
const storageStatus = describeConfig();
console.log(
  storageStatus.configured
    ? `Retours visiteurs → Hugging Face dataset « ${storageStatus.dataset} » (jeton : ${storageStatus.token_variable}, dataset : ${storageStatus.dataset_variable})`
    : `Retours visiteurs → fichier LOCAL éphémère : HF_TOKEN et/ou dataset non détectés (jetons vus : ${storageStatus.token_variables_found.join(', ') || 'aucun'} ; datasets vus : ${storageStatus.dataset_variables_found.join(', ') || 'aucun'})`
);

void logDatasetFiles(); // fichiers du dataset et fichiers qui seront complétés (affichés dans les logs)

function recordHandler(kind: 'feedback' | 'reports', clean: (b: any) => object | null, label: string) {
  return async (req: express.Request, res: express.Response) => {
    const rec = clean(req.body);
    if (!rec) return res.status(400).json({ ok: false, error: 'invalid payload' });
    try {
      const saved = await saveRecord(kind, rec);
      console.log(`[${label}] enregistré (${saved.backend}) : ${saved.where}`);
      res.json({ ok: true, stored: saved.backend });
    } catch (err: any) {
      // On répond par une erreur : le visiteur voit « impossible d'envoyer » au lieu d'un faux merci
      console.error(`[${label}] ENREGISTREMENT IMPOSSIBLE :`, err.message || err);
      res.status(502).json({ ok: false, error: 'storage unavailable' });
    }
  };
}

// ─── POST /api/report — signalement d'une œuvre ───
app.post('/api/report', rateLimit(10), recordHandler('reports', sanitizeReport, 'Report'));

// ─── POST /api/feedback — avis sur la visite ───
app.post('/api/feedback', rateLimit(10), recordHandler('feedback', sanitizeFeedback, 'Feedback'));

// ─── GET /api/storage-status — diagnostic (jamais le jeton) ───
// /api/storage-status          : ce que le serveur détecte
// /api/storage-status?check=1  : teste vraiment le jeton et l'accès en écriture au dataset
app.get('/api/storage-status', rateLimit(20), async (req, res) => {
  res.json(req.query.check ? await checkStorage() : describeConfig());
});

// ─── POST /tts — narration vocale (Edge TTS, puis Gemini TTS en secours) ───
// Renvoie du MP3 ou du WAV. Si tous les moteurs échouent, le client réessaie puis, en dernier recours,
// bascule sur la voix du navigateur.
app.post('/tts', rateLimit(150), async (req, res) => {
  const text = clampText(req.body?.text, MAX_TTS_CHARS);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const { data, type } = await synthesize(text, req.body?.voice, geminiApiKey);
    res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' });
    res.send(data);
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

    // Fichiers déjà compressés au build (brotli / gzip) : on les sert tels quels, sans CPU.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const ext = path.extname(req.path);
      if (!['.js', '.css', '.html', '.svg', '.json', '.txt'].includes(ext)) return next();
      const enc = req.acceptsEncodings('br', 'gzip');
      if (!enc) return next();
      const file = path.join(distPath, path.normalize(req.path));
      const compressed = file + (enc === 'br' ? '.br' : '.gz');
      if (!file.startsWith(distPath) || !fs.existsSync(compressed)) return next();
      res.set({ 'Content-Encoding': enc, Vary: 'Accept-Encoding' });
      res.type(ext);
      if (req.path.startsWith('/assets/')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(compressed, err => err && next());
    });

    // Les fichiers de /assets/ ont un nom empreinté (hash) : cache d'un an. L'index se revalide toujours.
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
          else res.set('Cache-Control', 'no-cache');
        },
      })
    );
    app.get('*', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
