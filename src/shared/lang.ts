import type { Lang } from '../types/gallery';

/**
 * Détecte un texte rédigé dans la mauvaise langue (ex. méditation en français alors que le visiteur
 * est en anglais). Heuristique volontairement prudente : il faut au moins 6 mots, 3 mots-outils de la
 * mauvaise langue ET deux fois plus que ceux de la bonne langue.
 */
const FR = new Set(
  'le la les des une est tu ton ta tes que qui dans pour avec sur pas cette du aux au et il elle nous vous ses mais ce'.split(' ')
);
const EN = new Set('the and you your with this that is are of to in it for'.split(' '));

export function languageMismatch(text: string | undefined | null, expected: Lang): boolean {
  const words = (text || '').toLowerCase().match(/[a-zà-ÿ']+/g) || [];
  if (words.length < 6) return false;
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FR.has(w)) fr++;
    if (EN.has(w)) en++;
  }
  return expected === 'en' ? fr >= 3 && fr > en * 2 : en >= 3 && en > fr * 2;
}

/** Consigne de langue donnée au modèle en plus du prompt (qui reste majoritairement en français). */
export function languageSystemInstruction(lang: Lang): string {
  return lang === 'en'
    ? 'LANGUAGE RULE: the visitor uses the app in ENGLISH. Every user-facing string in your JSON output (intro, reasons, meditations, anecdotes, questions, labels and annotation texts) MUST be written in English, even though parts of the instructions or the context are in French. Never mix languages. Keep JSON keys exactly as requested.'
    : 'RÈGLE DE LANGUE : le visiteur utilise l\'application en FRANÇAIS. Toutes les chaînes destinées au visiteur dans ton JSON (intro, raisons, méditations, anecdotes, questions, libellés et textes d\'annotation) doivent être rédigées en français, même si une partie du contexte est en anglais. Ne mélange jamais les langues. Conserve exactement les clés JSON demandées.';
}
