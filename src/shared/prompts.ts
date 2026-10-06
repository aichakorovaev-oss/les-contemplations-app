/**
 * Prompts envoyés à Gemini — portés à l'identique depuis la version
 * mono-fichier (index.html) de « Les Contemplations ».
 *
 * Ce module est volontairement sans dépendance serveur : il peut être testé
 * seul (voir tests/prompts.test.ts).
 */
import type { AnnotationPoint, Lang, Painting } from '../types/gallery';
import { t } from '../i18n/strings';

/** Parcours de secours (identique à l'original) si Gemini est indisponible. */
export const FALLBACK_IDS = [
  'pearl',
  'milkmaid',
  'selfportrait_vg',
  'wave',
  'starry_night',
  'wanderer',
  'waterlilies',
  'irises',
  'crows_wheat',
  'kiss',
];

/** Limite défensive sur les textes saisis par le visiteur (injection / coût). */
export function clampText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function moodString(tags: string[], freeText: string, lang: Lang): string {
  return [
    tags.length > 0 ? `${t('mood_label', lang)} : ${tags.join(', ')}` : '',
    freeText ? `${t('context_label', lang)} : ${freeText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Garde-fou de ton : injecté dans CHAQUE appel génératif. L'application aide
 * à aller mieux grâce à l'art, jamais à amplifier la tristesse.
 */
export function toneGuardrail(lang: Lang): string {
  return lang === 'en'
    ? 'ESSENTIAL RULE: this application exists to help visitors feel better through art, never to amplify sadness, hopelessness or dark thoughts. Even if the mood expressed is difficult, sad, or touches on death, endings, loneliness or despair, your writing must stay warm and gently guide toward comfort, hope and beauty — never toward pessimism, darkness, or bleak imagery (fading existence, "last confidences", encroaching silence, nearing the end, counting down, etc.). NEVER use metaphors about the visitor\'s own death, their life ending, or an existential countdown. Acknowledge the feeling without dramatising it, then gently turn toward reassurance, warmth or a glimmer of hope.\n\n'
    : 'CONSIGNE ESSENTIELLE : cette application existe pour aider les visiteurs à aller mieux grâce à l\'art, jamais pour amplifier la tristesse, le désespoir ou des pensées sombres. Même si l\'humeur exprimée est difficile, triste, ou évoque la mort, la fin, la solitude ou le désespoir, tes textes doivent rester bienveillants et orientés vers l\'apaisement, l\'espoir et la beauté — jamais vers le pessimisme, la noirceur ou des images funestes (déclin de l\'existence, "dernières confidences", silence qui approche, fin proche, compte à rebours existentiel, etc.). N\'utilise JAMAIS de métaphore évoquant la mort du visiteur, l\'approche de sa fin, ou un compte à rebours existentiel. Accueille l\'émotion sans la dramatiser, puis oriente doucement vers la réconciliation, la douceur ou une lueur d\'espoir.\n\n';
}

const englishPrefix = (lang: Lang) => (lang === 'en' ? 'Respond in English throughout this task.\n\n' : '');

// ─────────────────────────────────────────────────────────────
// Curation — appel 1 : sélection des œuvres + raison du choix
// ─────────────────────────────────────────────────────────────
export function buildSelectionPrompt(opts: {
  lang: Lang;
  mood: string;
  catalogue: Pick<Painting, 'id' | 'title' | 'artist' | 'room_hint'>[];
  daySeed: number;
}): string {
  const { lang, mood, catalogue, daySeed } = opts;
  const list = catalogue
    .map((p, i) => `${i + 1}. ${p.id} | "${p.title}" — ${p.artist} | ${p.room_hint}`)
    .join('\n');

  return (
    englishPrefix(lang) +
    toneGuardrail(lang) +
    "Tu es conservateur de Les Contemplations, une galerie d'art virtuelle.\n" +
    "Le visiteur arrive avec cet état d'esprit : " + mood + '\n\n' +
    'Catalogue disponible :\n' + list + '\n\n' +
    'Choisis exactement 10 œuvres qui résonnent profondément avec cette humeur, 2-3 par salle.\n' +
    'Jeton du jour : ' + daySeed + '. Le visiteur peut revenir CHAQUE JOUR avec la même humeur : ' +
    "à humeur égale, propose un parcours RENOUVELÉ d'un jour à l'autre en explorant d'autres œuvres tout aussi " +
    "pertinentes (varie les artistes, les époques, les ambiances). Ne reprends pas toujours les mêmes incontournables.\n" +
    "Pour l'intro : écris une phrase poétique, chaleureuse et porteuse d'espoir qui accueille le visiteur en tutoiement et évoque son humeur sans la dramatiser.\n" +
    "Pour chaque œuvre : écris une raison courte (reason) expliquant POURQUOI tu l'as choisie pour cette humeur spécifique, dans un esprit qui aide le visiteur à se sentir mieux.\n" +
    'JSON strict : {"intro":"phrase d\'accueil poétique et rassurante","selected":[{"id":"slug","reason":"pourquoi ce tableau pour cette humeur"}]}' +
    (t('llm_lang_directive', lang) as string)
  );
}

// ─────────────────────────────────────────────────────────────
// Curation — appel 2 : textes personnalisés pour les œuvres retenues
// ─────────────────────────────────────────────────────────────
export function buildTextsPrompt(opts: {
  lang: Lang;
  mood: string;
  picks: { p: Pick<Painting, 'id' | 'title' | 'artist'>; reason?: string }[];
}): string {
  const { lang, mood, picks } = opts;
  const titlesStr = picks
    .map(({ p, reason }, i) => {
      const r = reason ? ' [raison du choix: ' + reason + ']' : '';
      return i + 1 + '. ' + p.id + ' — "' + p.title + '" (' + p.artist + ')' + r;
    })
    .join('\n');

  return (
    englishPrefix(lang) +
    toneGuardrail(lang) +
    'Humeur du visiteur : ' + mood + '\n\n' +
    'Pour chacun de ces tableaux choisis pour cette humeur, écris ' + (lang === 'en' ? 'in English' : 'en français') + ' :\n' +
    "- meditation : 2-3 phrases poétiques, chaleureuses et porteuses d'espoir (tutoiement) qui font le lien explicite entre l'œuvre et l'humeur du visiteur, en aidant doucement à se sentir mieux — jamais de tonalité sombre, funeste ou renvoyant à la fin de l'existence\n" +
    '- raison : 1 phrase qui explique clairement pourquoi ce tableau a été choisi pour cette humeur\n' +
    "- anecdote : 1 fait surprenant sur l'œuvre\n" +
    "- questions : 2 questions courtes, bienveillantes, invitant le visiteur à contempler l'œuvre avec son état d'esprit\n\n" +
    'Tableaux :\n' + titlesStr + '\n\n' +
    'JSON strict : {"texts":[{"id":"slug","meditation":"...","raison":"...","anecdote":"...","questions":["...","..."]}]}' +
    (t('llm_lang_directive', lang) as string)
  );
}

// ─────────────────────────────────────────────────────────────
// Annotations « Guider mon regard » — vision + points précis
// ─────────────────────────────────────────────────────────────
export function buildAnnotatePrompt(opts: {
  lang: Lang;
  painting: { title: string; artist: string; year: string; desc?: string; raison?: string; meditation?: string };
  userMood?: string;
}): string {
  const { lang, painting: p, userMood = '' } = opts;
  const emo = [
    userMood || '',
    p.raison ? 'Pourquoi ce tableau lui a été proposé : ' + p.raison : '',
    p.meditation ? 'Méditation associée : ' + p.meditation : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    englishPrefix(lang) +
    "Tu es médiateur d'art à la galerie Les Contemplations. Tu accompagnes un visiteur devant un tableau " +
    "et tu l'aides à SE CONNECTER À L'ŒUVRE PAR SON ÉMOTION.\n" +
    'Tableau : "' + p.title + '" par ' + p.artist + ' (' + p.year + ').\n' +
    (p.desc ? 'Description : ' + p.desc + '\n' : '') +
    (emo ? '\n— État émotionnel du visiteur —\n' + emo + '\n' : '') +
    "\nL'IMAGE de cette œuvre t'est fournie ci-jointe. Observe-la attentivement et localise précisément " +
    'les éléments tels qu\'ils apparaissent réellement.\n' +
    "Donne 3 à 4 points d'attention, situés sur des éléments DISTINCTS et BIEN ESPACÉS de la toile " +
    '(jamais deux points au même endroit), qui guident le regard ET relient ce que le visiteur voit à ce qu\'il ressent.\n' +
    'Pour CHAQUE point, dans le MÊME objet, renvoie :\n' +
    "- point : la position EXACTE de l'élément, AU FORMAT GEMINI [y, x] (y EN PREMIER), " +
    'en ENTIERS de 0 à 1000 (y = vertical, 0 = tout en haut, 1000 = tout en bas ; ' +
    'x = horizontal, 0 = tout à gauche, 1000 = tout à droite).\n' +
    "  Vise le détail PRÉCIS, pas le centre d'une zone : pour un regard, pointe exactement les YEUX " +
    '(pas le milieu du visage) ; pour une main, le creux de la main ; pour une fleur, son cœur.\n' +
    '  Exemple : des yeux en haut au centre ≈ [180, 500] ; une main en bas à droite ≈ [870, 800].\n' +
    "- cote : de quel côté de l'image se trouve l'élément, vu par QUELQU'UN QUI REGARDE l'image : " +
    '"gauche", "centre" ou "droite". Sois rigoureux : un élément à GAUCHE de l\'image a un x PETIT, ' +
    'à DROITE un x GRAND. Ce repère sert à vérifier la cohérence de x.\n' +
    '- label : 2 à 4 mots (repère écrit, NON lu à voix haute)\n' +
    '- text : 1 à 2 phrases en tutoiement, douces, qui décrivent l\'élément à cet endroit PUIS ' +
    "invitent le visiteur à y relier son émotion (ce qu'il peut y reconnaître, y déposer, y ressentir). " +
    'Ne répète JAMAIS le label dans le text.\n' +
    "Ordonne les points comme un parcours du regard cohérent (de l'élément principal vers les détails).\n" +
    'JSON strict : {"points":[{"point":[180,500],"cote":"centre","label":"...","text":"..."}]}' +
    (t('llm_lang_directive', lang) as string)
  );
}

// ─────────────────────────────────────────────────────────────
// Lecture tolérante du JSON renvoyé par le modèle
// ─────────────────────────────────────────────────────────────
export function parseModelJSON(raw: string | undefined | null): any {
  const s = (raw || '').trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    const unfenced = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(unfenced);
    } catch {
      const a = unfenced.indexOf('{');
      const b = unfenced.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(unfenced.slice(a, b + 1));
      throw new Error('JSON invalide renvoyé par le modèle');
    }
  }
}

/**
 * Réduit n'importe quel format spatial renvoyé par le modèle
 * (box_2d / point [y,x] / x,y ; échelles 0-1, 0-100 ou 0-1000)
 * à un point central normalisé dans [0.02 ; 0.98].
 * Logique reprise telle quelle de l'original, y compris le recoupement
 * x ↔ « cote » qui ne corrige que les contradictions grossières.
 */
export function normalizeAnnotationPoints(json: any): AnnotationPoint[] {
  const clamp = (n: number) => Math.max(0.02, Math.min(0.98, n));

  // Anciennes clés x / y : échelle ambiguë (0-1, 0-100 ou 0-1000), on devine.
  const to01 = (v: unknown) => {
    let n = parseFloat(String(v));
    if (!isFinite(n)) return NaN;
    if (n > 100) n = n / 1000;
    else if (n > 1.5) n = n / 100;
    return clamp(n);
  };

  // Formats natifs Gemini (point [y,x] / box_2d) : le prompt impose des ENTIERS 0-1000.
  // Dans la version d'origine, tout nombre ≤ 100 était lu en échelle 0-100 : un détail situé
  // dans les 10 % du haut ou de la gauche (ex. y = 85) atterrissait donc tout en bas / à droite.
  // On ne retombe sur l'échelle 0-1 que si TOUTES les valeurs sont ≤ 1,5.
  const scale = (vals: number[]) => (Math.max(...vals.map(Math.abs)) <= 1.5 ? 1 : 1000);

  const centre = (a: any) => {
    for (const key of ['box_2d', 'box']) {
      if (Array.isArray(a[key]) && a[key].length === 4) {
        const v = a[key].map(parseFloat);
        if (v.every(isFinite)) {
          const sc = scale(v);
          const [ymin, xmin, ymax, xmax] = v;
          return { x: clamp((xmin + xmax) / 2 / sc), y: clamp((ymin + ymax) / 2 / sc) };
        }
      }
    }
    if (Array.isArray(a.point) && a.point.length === 2) {
      const v = a.point.map(parseFloat);
      if (v.every(isFinite)) {
        const sc = scale(v);
        return { x: clamp(v[1] / sc), y: clamp(v[0] / sc) }; // Gemini : point = [y, x]
      }
    }
    return { x: to01(a.x), y: to01(a.y) };
  };

  const list: any[] = (json && (json.points || json.annotations)) || [];
  return list
    .map(a => {
      const c = centre(a || {});
      const cote = String(a?.cote || a?.side || a?.cote_image || '').toLowerCase();
      if (isFinite(c.x)) {
        if (/gauche|left/.test(cote) && c.x > 0.55) c.x = 0.24;
        else if (/droite|right/.test(cote) && c.x < 0.45) c.x = 0.78;
        else if (/centre|center|milieu/.test(cote) && (c.x < 0.3 || c.x > 0.7)) c.x = 0.5;
      }
      return {
        x: c.x,
        y: c.y,
        label: String(a?.label || '').slice(0, 40),
        text: String(a?.text || '').trim(),
      };
    })
    .filter(a => isFinite(a.x) && isFinite(a.y) && a.text)
    .slice(0, 4);
}
