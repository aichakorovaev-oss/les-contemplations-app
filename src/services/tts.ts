import { Lang, Painting } from '../types/gallery';
import { t } from '../i18n/strings';

/**
 * Narration vocale.
 *
 * Latence : le serveur TTS synthétise un texte ENTIER avant de renvoyer le moindre octet. Une
 * narration complète (≈ 700 caractères) mettait donc plusieurs secondes à démarrer. On la découpe
 * en morceaux de taille croissante (titre + artiste, puis 1-2 phrases, puis le reste), tous demandés
 * en parallèle et joués à la suite : la voix démarre dès que le PREMIER morceau (très court) est prêt.
 */

let isNarrating = false;
let narrationToken = 0;
let _speechResolve: (() => void) | null = null;

// ─────────────────────────────────────────────────────────────
// Cache des morceaux audio (texte + voix → Blob)
// ─────────────────────────────────────────────────────────────
const audioCache = new Map<string, Promise<Blob>>();
const MAX_CACHED = 48;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchOnce(text: string, voice: string): Promise<Blob> {
  const res = await fetch('/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) throw Object.assign(new Error('/tts ' + res.status), { status: res.status });
  return res.blob();
}

/**
 * Un échec passager (quota 429, 5xx, réseau) ne doit PAS faire basculer sur la voix robotique du
 * navigateur : on réessaie d'abord, avec un petit délai croissant. Inutile pour 400 / 501.
 */
const RETRY_DELAYS = [700, 1700];
async function fetchWithRetry(text: string, voice: string): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(text, voice);
    } catch (e: any) {
      const status: number | undefined = e?.status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || status === 501 || attempt >= RETRY_DELAYS.length) throw e;
      await sleep(RETRY_DELAYS[attempt] + Math.random() * 300);
    }
  }
}

function fetchAudio(text: string, voice: string): Promise<Blob> {
  const key = `${voice}|${text}`;
  const hit = audioCache.get(key);
  if (hit) return hit;
  const p = fetchWithRetry(text, voice).catch(e => {
    audioCache.delete(key); // un échec ne doit pas rester en cache
    throw e;
  });
  p.catch(() => {}); // évite « unhandled rejection » pour un préchargement que personne n'attend
  audioCache.set(key, p);
  while (audioCache.size > MAX_CACHED) audioCache.delete(audioCache.keys().next().value as string);
  return p;
}

/**
 * Voix robotique du navigateur, en tout dernier recours : seulement si la voix naturelle est
 * indisponible dès le DÉBUT d'une narration (jamais au milieu : on ne mélange pas deux voix).
 * Mettre false pour préférer le silence.
 */
const ROBOT_FALLBACK = true;

/** Découpe un texte en morceaux dont la taille augmente : le 1er est court pour démarrer vite. */
export function splitNarration(text: string, limits: number[] = [110, 220, 520]): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = (clean.match(/[^.!?…]+(?:[.!?…]+["»”)]*|$)/g) || [clean]).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const limit = limits[Math.min(chunks.length, limits.length - 1)];
    if (cur && cur.length + 1 + s.length > limit) {
      chunks.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ─────────────────────────────────────────────────────────────
// Lecteur audio unique et « déverrouillé »
//
// Sur iOS/Android un nouvel <audio> lancé après un `await fetch` est bloqué
// (le geste de l'utilisateur est déjà expiré). On réutilise donc UN seul
// élément, joué une première fois (en silence) au premier toucher.
// ─────────────────────────────────────────────────────────────
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const NARRATION_VOLUME = 0.92;
let sharedAudio: HTMLAudioElement | null = null;
let _playResolve: ((r: 'ended' | 'error' | 'aborted') => void) | null = null;
let _objectUrl: string | null = null;

function player(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    (sharedAudio as any).playsInline = true;
  }
  return sharedAudio;
}

/** Arrête le lecteur SANS déclencher d'événement « error » tardif (qui annulerait la narration suivante). */
function releasePlayer(): void {
  const a = sharedAudio;
  if (a) {
    a.onended = null;
    a.onerror = null;
    try {
      a.pause();
    } catch (_) {}
    a.removeAttribute('src');
    try {
      a.load();
    } catch (_) {}
  }
  if (_objectUrl) {
    URL.revokeObjectURL(_objectUrl);
    _objectUrl = null;
  }
  const r = _playResolve;
  _playResolve = null;
  if (r) r('aborted');
}

/** Joue un morceau et se résout à la fin ('ended'), en cas d'erreur ('error') ou d'arrêt ('aborted'). */
function playBlob(blob: Blob): Promise<'ended' | 'error' | 'aborted'> {
  return new Promise(resolve => {
    releasePlayer();
    const a = player();
    const url = URL.createObjectURL(blob);
    _objectUrl = url;
    _playResolve = resolve;
    a.volume = NARRATION_VOLUME;
    a.src = url;
    a.onended = () => {
      if (_playResolve === resolve) _playResolve = null;
      if (_objectUrl === url) {
        URL.revokeObjectURL(url);
        _objectUrl = null;
      }
      resolve('ended');
    };
    a.onerror = () => {
      if (_playResolve === resolve) _playResolve = null;
      resolve('error');
    };
    a.play().catch(() => {
      if (_playResolve === resolve) _playResolve = null;
      resolve('error');
    });
  });
}

let unlocked = false;
/** À appeler au premier geste (touch / clic) : débloque la lecture audio et la synthèse vocale mobiles. */
export function unlockAudio(): void {
  if (unlocked || typeof window === 'undefined') return;
  unlocked = true;
  try {
    const a = player();
    a.src = SILENT_WAV;
    a.volume = 0;
    a.play()
      .then(() => {
        // ne touche pas au lecteur si une vraie narration l'a déjà repris
        if (a.src === SILENT_WAV) releasePlayer();
        a.volume = NARRATION_VOLUME;
      })
      .catch(() => {
        a.volume = NARRATION_VOLUME;
      });
  } catch (_) {}
  try {
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch (_) {}
}

export function buildNarrationText(p: Painting, lang: Lang): string {
  const parts = [`${p.title}. ${p.artist}, ${p.year}.`];
  if (p.meditation) parts.push(p.meditation);
  parts.push(p.desc);
  if (p.anecdote) parts.push(p.anecdote);
  return parts.join('  ');
}

/**
 * Réchauffe l'audio avant qu'il soit demandé.
 * `firstOnly` : ne précharge que le 1er morceau (tableau voisin, accueil) — une seule petite requête.
 */
export function prefetchNarration(p: Painting, lang: Lang, firstOnly = false): void {
  const voice = t('tts_voice', lang);
  const chunks = splitNarration(buildNarrationText(p, lang));
  (firstOnly ? chunks.slice(0, 1) : chunks).forEach(c => fetchAudio(c, voice));
}

/** Découpage des textes courts lus par le guide (introduction, annotations). */
const SHORT_LIMITS = [100, 200, 300];

/** Précharge un texte court (ex. une annotation) avant de le lire. */
export function prefetchText(text: string, lang: Lang): void {
  const voice = t('tts_voice', lang);
  splitNarration(text, SHORT_LIMITS).forEach(c => fetchAudio(c, voice));
}

export function stopNarration(onStateChange?: (active: boolean) => void): void {
  narrationToken++;
  releasePlayer();
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (_speechResolve) {
    const r = _speechResolve;
    _speechResolve = null;
    r();
  }
  isNarrating = false;
  if (onStateChange) onStateChange(false);
}

export async function speakEdgeTTS(
  text: string,
  _p: Painting | null,
  lang: Lang,
  onStateChange?: (active: boolean) => void
): Promise<void> {
  const myToken = ++narrationToken;
  const voice = t('tts_voice', lang);
  if (onStateChange) onStateChange(true);

  // Tous les morceaux sont demandés tout de suite, dans l'ordre ; on joue au fur et à mesure.
  const chunks = splitNarration(text);
  const audios = chunks.map(c => fetchAudio(c, voice));

  for (let i = 0; i < chunks.length; i++) {
    let blob: Blob;
    try {
      blob = await audios[i];
    } catch (e: any) {
      console.warn('[TTS]', e.message);
      if (myToken !== narrationToken) return;
      // 1er morceau : voix du navigateur en dernier recours. Plus tard : on s'arrête, sans changer de voix.
      if (i === 0 && ROBOT_FALLBACK) speakFallback(chunks.join(' '), lang, onStateChange);
      else stopNarration(onStateChange);
      return;
    }
    if (myToken !== narrationToken) return;
    const result = await playBlob(blob);
    if (myToken !== narrationToken || result === 'aborted') return;
    isNarrating = true;
    if (result === 'error') {
      if (i === 0 && ROBOT_FALLBACK) speakFallback(chunks.join(' '), lang, onStateChange);
      else stopNarration(onStateChange);
      return;
    }
  }
  if (myToken === narrationToken) stopNarration(onStateChange);
}

export function speakFallback(
  text: string,
  lang: Lang,
  onStateChange?: (active: boolean) => void
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    stopNarration(onStateChange);
    return;
  }
  window.speechSynthesis.cancel();
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let idx = 0;

  function next() {
    if (idx >= sentences.length || !isNarrating) {
      stopNarration(onStateChange);
      return;
    }
    const u = new SpeechSynthesisUtterance(sentences[idx++].trim());
    const voices = window.speechSynthesis.getVoices();
    const v =
      voices.find(v => t('speech_voice_re', lang).test(v.name)) ||
      voices.find(v => t('speech_lang_re', lang).test(v.lang));
    if (v) u.voice = v;
    u.lang = t('speech_lang', lang);
    u.rate = 0.82;
    u.pitch = 0.92;
    u.volume = 0.9;
    u.onend = next;
    u.onerror = next;
    window.speechSynthesis.speak(u);
  }

  isNarrating = true;
  next();
}

export function haltSpeech(): void {
  releasePlayer();
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (_speechResolve) {
    const r = _speechResolve;
    _speechResolve = null;
    r();
  }
}

/** Lit un texte court (intro / annotation) ; se résout à la fin ou quand on l'interrompt. */
export function ttsPlay(text: string, lang: Lang): Promise<void> {
  const voice = t('tts_voice', lang);
  return new Promise(async resolve => {
    _speechResolve = resolve;
    const done = () => {
      if (_speechResolve === resolve) {
        _speechResolve = null;
        resolve();
      }
    };
    // Même principe que la narration : morceaux demandés ensemble, joués à la suite.
    const chunks = splitNarration(text, SHORT_LIMITS);
    const audios = chunks.map(c => fetchAudio(c, voice));
    let spokenUpTo = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        const blob = await audios[i];
        if (_speechResolve !== resolve) return; // interrompu pendant le chargement
        const result = await playBlob(blob);
        if (result === 'error') throw new Error('lecture impossible');
        if (result === 'aborted' || _speechResolve !== resolve) {
          done();
          return;
        }
        spokenUpTo = i + 1;
      }
      done();
      return;
    } catch (_) {
      /* voir ci-dessous */
    }
    if (_speechResolve !== resolve) return;
    // Voix naturelle déjà entamée : on n'y mêle pas la voix robotique
    if (spokenUpTo > 0 || !ROBOT_FALLBACK) {
      done();
      return;
    }
    const rest = text;
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      done();
      return;
    }
    const u = new SpeechSynthesisUtterance(rest);
    const voices = window.speechSynthesis.getVoices();
    const v =
      voices.find(v => t('speech_voice_re', lang).test(v.name)) ||
      voices.find(v => t('speech_lang_re', lang).test(v.lang));
    if (v) u.voice = v;
    u.lang = t('speech_lang', lang);
    u.rate = 0.9;
    u.pitch = 0.95;
    u.volume = 0.9;
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  });
}
