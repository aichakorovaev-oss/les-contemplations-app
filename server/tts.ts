/**
 * Synthèse vocale côté serveur pour la narration (route POST /tts).
 *
 * Moteurs essayés dans l'ordre (TTS_ENGINES, défaut « edge,gemini ») :
 *   1. Edge TTS  — voix neurales Microsoft, comme la version d'origine : rapide, sans quota.
 *   2. Gemini TTS — modèles listés dans TTS_MODELS (même clé GEMINI_API_KEY), en secours.
 * Un moteur en échec est mis en pause quelques minutes (voir fallback.ts).
 *
 * Réponse : { data, type } — MP3 (Edge) ou WAV (Gemini). Le client n'a rien à savoir du moteur utilisé.
 */
import { createHash } from 'crypto';
import { DEFAULT_TTS_MODELS, parseModels, withFallback } from './fallback.ts';
import { synthesizeEdge } from './edge.ts';

const ENDPOINT = () => (process.env.GOOGLE_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com') + '/v1beta/interactions';
// Modèles vocaux par ordre de préférence (même schéma de requête) : TTS_MODELS="a,b" et/ou TTS_MODEL="a".
const MODELS = () => parseModels(process.env.TTS_MODELS, process.env.TTS_MODEL, DEFAULT_TTS_MODELS);
const STYLE = () => process.env.TTS_STYLE || 'calm, warm and unhurried, like a gentle museum guide';
export const MAX_TTS_CHARS = 2500;

/** Le client envoie un nom de voix Edge (fr-FR-DeniseNeural…) : on ne garde que la langue. */
export function voiceFor(requested: unknown): string {
  const r = typeof requested === 'string' ? requested.toLowerCase() : '';
  if (r.startsWith('en')) return process.env.TTS_VOICE_EN || process.env.TTS_VOICE || 'Sulafat';
  return process.env.TTS_VOICE_FR || process.env.TTS_VOICE || 'Sulafat';
}

export function buildTtsRequest(text: string, voice: string, model: string) {
  return {
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text,
            annotations: [{ type: 'speech_metadata', style: STYLE() }],
          },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  };
}

/** Récupère le dernier bloc audio de la réponse (REST brut ou convenience SDK). */
export function extractAudioBase64(json: any): string | null {
  if (json?.output_audio?.data) return json.output_audio.data;
  let found: string | null = null;
  for (const step of json?.steps ?? []) {
    for (const c of step?.content ?? []) {
      if (c?.type === 'audio' && c.data) found = c.data;
    }
  }
  return found;
}

/** Garantit un WAV lisible par <audio> : enveloppe du PCM 24 kHz/16 bits/mono si besoin. */
export function ensureWav(buf: Buffer, sampleRate = 24000): Buffer {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF') return buf;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + buf.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

// ── Cache LRU en mémoire : une même narration n'est synthétisée qu'une fois ──
export interface Synthesized {
  data: Buffer;
  type: string;
}
const cache = new Map<string, Synthesized>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;

function cacheSet(key: string, val: Synthesized) {
  cache.set(key, val);
  cacheBytes += val.data.length;
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value as string;
    cacheBytes -= cache.get(oldest)!.data.length;
    cache.delete(oldest);
  }
}

// Requêtes identiques simultanées (préchargement + lecture) : une seule synthèse
const inflight = new Map<string, Promise<Synthesized>>();

// File d'attente pour Gemini : limite les appels simultanés, sinon une rafale de morceaux
// dépasse le quota par minute et la voix retombe sur la synthèse robotique du navigateur.
class Semaphore {
  private waiters: (() => void)[] = [];
  constructor(private slots: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.slots > 0) this.slots--;
    else await new Promise<void>(r => this.waiters.push(r));
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.slots++;
    }
  }
}
const geminiQueue = new Semaphore(Number(process.env.TTS_GEMINI_CONCURRENCY) || 2);

/** Liste ordonnée des moteurs : 'edge' puis les modèles Gemini (selon TTS_ENGINES). */
export function engineList(): string[] {
  const engines = (process.env.TTS_ENGINES || 'edge,gemini')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const out: string[] = [];
  for (const e of engines) {
    if (e === 'edge') out.push('edge');
    else if (e === 'gemini') out.push(...MODELS());
  }
  return out.length ? out : MODELS();
}

async function synthesizeGemini(text: string, requestedVoice: unknown, model: string, apiKey: string): Promise<Synthesized> {
  const voice = voiceFor(requestedVoice);
  return geminiQueue.run(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40_000);
    try {
      const res = await fetch(ENDPOINT(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildTtsRequest(text, voice, model)),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw Object.assign(new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 200)}`), {
          status: res.status,
        });
      }
      const b64 = extractAudioBase64(await res.json());
      if (!b64) throw new Error('Gemini TTS: JSON invalide : aucune donnée audio dans la réponse');
      return { data: ensureWav(Buffer.from(b64, 'base64')), type: 'audio/wav' };
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function synthesize(text: string, requestedVoice: unknown, apiKey: string | undefined): Promise<Synthesized> {
  const key = createHash('sha1').update(`${String(requestedVoice)}|${STYLE()}|${text}`).digest('hex');
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // rafraîchit l'ordre LRU
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const engines = engineList().filter(e => e === 'edge' || !!apiKey);
  const job = withFallback(
    engines,
    async engine => (engine === 'edge'
      ? { data: await synthesizeEdge(text, requestedVoice), type: 'audio/mpeg' }
      : synthesizeGemini(text, requestedVoice, engine, apiKey!)),
    { label: 'TTS', attemptTimeoutMs: 45_000, timeoutFor: e => (e === 'edge' ? 9_000 : undefined), budgetMs: 70_000 }
  )
    .then(out => {
      cacheSet(key, out);
      return out;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
