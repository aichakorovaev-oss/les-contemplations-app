import { Lang, Painting } from '../types/gallery';
import { t } from '../i18n/strings';

let isNarrating = false;
let narrationToken = 0;
const ttsCache = new Map<string, Promise<Blob>>();
let _speechResolve: (() => void) | null = null;

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
  if (!a) return;
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

export function ttsCacheKey(p: Painting, lang: Lang, voice: string): string {
  return `${p.id}|${lang}|${voice}`;
}

export function buildNarrationText(p: Painting, lang: Lang): string {
  const parts = [`${p.title}. ${p.artist}, ${p.year}.`];
  if (p.meditation) parts.push(p.meditation);
  parts.push(p.desc);
  if (p.anecdote) parts.push(p.anecdote);
  return parts.join('  ');
}

/** Réchauffe l'audio dès que le tableau est ciblé, pendant que la caméra glisse. */
export function prefetchNarration(p: Painting, lang: Lang): void {
  const voice = t('tts_voice', lang);
  const key = ttsCacheKey(p, lang, voice);
  if (ttsCache.has(key)) return;
  const text = buildNarrationText(p, lang);
  const promise = fetch('/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  })
    .then(res => {
      if (!res.ok) throw new Error('/tts ' + res.status);
      return res.blob();
    })
    .catch(e => {
      ttsCache.delete(key);
      throw e;
    });
  promise.catch(() => {}); // évite « unhandled rejection » si personne n'attend ce prefetch
  ttsCache.set(key, promise);
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
  p: Painting | null,
  lang: Lang,
  onStateChange?: (active: boolean) => void
): Promise<void> {
  const myToken = ++narrationToken;
  const voice = t('tts_voice', lang);
  if (onStateChange) onStateChange(true);
  const cacheKey = p ? ttsCacheKey(p, lang, voice) : null;

  try {
    let blob: Blob;
    if (cacheKey && ttsCache.has(cacheKey)) {
      blob = await ttsCache.get(cacheKey)!;
    } else {
      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) throw new Error('/tts ' + res.status);
      blob = await res.blob();
    }
    if (myToken !== narrationToken) return;

    const url = URL.createObjectURL(blob);
    const a = player();
    releasePlayer();
    a.volume = NARRATION_VOLUME;
    a.src = url;
    a.onended = () => {
      URL.revokeObjectURL(url);
      if (myToken === narrationToken) stopNarration(onStateChange);
    };
    a.onerror = () => {
      if (myToken === narrationToken) stopNarration(onStateChange);
    };
    await a.play();
    isNarrating = true;
  } catch (e: any) {
    console.warn('[TTS]', e.message);
    if (cacheKey) ttsCache.delete(cacheKey);
    if (myToken === narrationToken) {
      speakFallback(text, lang, onStateChange);
    }
  }
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
    try {
      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) throw new Error('tts ' + res.status);
      const blob = await res.blob();
      if (_speechResolve !== resolve) return; // interrompu pendant le chargement
      const url = URL.createObjectURL(blob);
      const a = player();
      releasePlayer();
      a.volume = NARRATION_VOLUME;
      a.src = url;
      a.onended = () => {
        URL.revokeObjectURL(url);
        done();
      };
      a.onerror = done;
      await a.play();
      return;
    } catch (_) {
      /* repli : synthèse vocale du navigateur */
    }
    if (_speechResolve !== resolve) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      done();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
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
