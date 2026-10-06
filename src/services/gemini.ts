import { Lang, Painting, ParcoursResult, AnnotationPoint } from '../types/gallery';
import { getLocalizedCatalogue, assignSlots } from '../data/catalogue';
import { t } from '../i18n/strings';
import { paintingToInline, fetchImageUrl } from './imageResolver';
import { FALLBACK_IDS } from '../shared/prompts';

export async function buildMoodParcours(
  tags: string[],
  freeText: string,
  lang: Lang
): Promise<ParcoursResult> {
  try {
    const res = await fetch('/api/curate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags, freeText, lang }),
    });
    if (res.ok) {
      const data = await res.json();
      const catalogue = getLocalizedCatalogue(lang);
      const selected = (data.paintings || [])
        .map((p: any) => {
          const base = catalogue.find(c => c.id === p.id);
          if (!base) return null;
          return {
            ...base,
            meditation: p.meditation || base.desc,
            raison: p.raison || '',
            anecdote: p.anecdote || '',
            questions: p.questions || [],
          };
        })
        .filter(Boolean);

      const assigned = assignSlots(selected);
      return {
        paintings: assigned,
        introText: data.introText || t('fallback_intro', lang),
        perPainting: Object.fromEntries(
          assigned.map(p => [
            p.id,
            {
              meditation: p.meditation,
              raison: p.raison,
              anecdote: p.anecdote,
              questions: p.questions,
            },
          ])
        ),
      };
    }
  } catch (err) {
    console.warn('Backend curate call error, using local selection fallback:', err);
  }

  // Backend injoignable : parcours de secours identique à l'original
  const catalogue = getLocalizedCatalogue(lang);
  const fallbackList = FALLBACK_IDS.map(id => catalogue.find(c => c.id === id)).filter(Boolean) as Painting[];
  const assigned = assignSlots(fallbackList);
  return {
    paintings: assigned,
    introText: t('fallback_intro', lang),
    perPainting: {},
  };
}

export async function fetchAnnotations(
  p: Painting,
  userMood: string,
  lang: Lang
): Promise<AnnotationPoint[]> {
  if (Array.isArray(p.annotations) && p.annotations.length > 0) return p.annotations;

  try {
    let imageInline: { mimeType: string; data: string } | null = null;
    const imgUrl = p.detailUrl || p.url || (await fetchImageUrl(p));
    if (imgUrl) {
      imageInline = await paintingToInline(imgUrl);
    }

    const res = await fetch('/api/annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        painting: {
          id: p.id,
          title: p.title,
          artist: p.artist,
          year: p.year,
          desc: p.desc,
          raison: p.raison,
          meditation: p.meditation,
        },
        userMood,
        lang,
        image: imageInline,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.points) && data.points.length > 0) {
        p.annotations = data.points;
        return data.points;
      }
    }
  } catch (err) {
    console.warn('Backend annotation call error, using fallback points:', err);
  }

  const fallback = fallbackAnnotations(p, lang);
  p.annotations = fallback;
  return fallback;
}

function fallbackAnnotations(p: Painting, lang: Lang): AnnotationPoint[] {
  const src = (p.details && p.details.length ? p.details : [p.desc]).filter(Boolean).slice(0, 4);
  const spots = [
    { x: 0.32, y: 0.34 },
    { x: 0.68, y: 0.44 },
    { x: 0.5, y: 0.72 },
    { x: 0.5, y: 0.16 },
  ];
  if (!src.length) src.push(t('fallback_annotation', lang));
  return src.map((txt, i) => ({
    x: spots[i % spots.length].x,
    y: spots[i % spots.length].y,
    label: `${t('detail_label', lang)}${i + 1}`,
    text: txt,
  }));
}
