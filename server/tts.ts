/**
 * Synthèse vocale côté serveur pour la narration (route POST /tts).
 *
 * L'original appelait un serveur Edge-TTS externe ; le portage n'avait qu'un
 * stub 501, ce qui faisait retomber TOUTES les narrations sur la voix du
 * navigateur. Ici on utilise l'API Gemini TTS (même clé GEMINI_API_KEY),
 * documentée sur https://ai.google.dev/gemini-api/docs/speech-generation
 *
 * Le client n'a rien à changer : il envoie { text, voice } et reçoit un WAV.
 */
import { createHash } from 'crypto';

const ENDPOINT = () => (process.env.GOOGLE_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com') + '/v1beta/interactions';
const MODEL = () => process.env.TTS_MODEL || 'gemini-3.8-flash-lite-tts';
const STYLE = () => process.env.TTS_STYLE || 'calm, warm and unhurried, like a gentle museum guide';
export const MAX_TTS_CHARS = 2500;

/** Le client envoie un nom de voix Edge (fr-FR-DeniseNeural…) : on ne garde que la langue. */
export function voiceFor(requested: unknown): string {
  const r = typeof requested === 'string' ? requested.toLowerCase() : '';
  if (r.startsWith('en')) return process.env.TTS_VOICE_EN || process.env.TTS_VOICE || 'Sulafat';
  return process.env.TTS_VOICE_FR || process.env.TTS_VOICE || 'Sulafat';
}

export function buildTtsRequest(text: string, voice: string) {
  return {
    model: MODEL(),
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

// Petit cache LRU en mémoire : une même narration n'est facturée qu'une fois.
const cache = new Map<string, Buffer>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;

function cacheSet(key: string, val: Buffer) {
  cache.set(key, val);
  cacheBytes += val.length;
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value as string;
    cacheBytes -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
}

export async function synthesize(text: string, requestedVoice: unknown, apiKey: string): Promise<Buffer> {
  const voice = voiceFor(requestedVoice);
  const key = createHash('sha1').update(`${MODEL()}|${voice}|${STYLE()}|${text}`).digest('hex');
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // rafraîchit l'ordre LRU
    return hit;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(ENDPOINT(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildTtsRequest(text, voice)),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const b64 = extractAudioBase64(await res.json());
    if (!b64) throw new Error('Gemini TTS: aucune donnée audio dans la réponse');
    const wav = ensureWav(Buffer.from(b64, 'base64'));
    cacheSet(key, wav);
    return wav;
  } finally {
    clearTimeout(timer);
  }
}
