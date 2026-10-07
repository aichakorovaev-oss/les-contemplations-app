import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Lang, Painting, AnnotationPoint } from '../types/gallery';
import { t } from '../i18n/strings';
import { ttsPlay, haltSpeech, prefetchText } from '../services/tts';

interface GuidedAnnotationsProps {
  lang: Lang;
  painting: Painting;
  camera: THREE.PerspectiveCamera | null;
  paintingMesh: THREE.Mesh | null;
  detailMode: boolean;
  detailImgRef: React.RefObject<HTMLImageElement | null>;
  onClose: () => void;
}

const _pvec = new THREE.Vector3();

function projectToScreen(v: THREE.Vector3, camera: THREE.PerspectiveCamera) {
  _pvec.copy(v).project(camera);
  return {
    x: (_pvec.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_pvec.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function annotWorld(mesh: THREE.Mesh, nx: number, ny: number) {
  const p = mesh.userData.painting as Painting;
  mesh.updateWorldMatrix(true, false);
  const local = new THREE.Vector3((nx - 0.5) * p.width, (0.5 - ny) * p.height, 0.02);
  return local.applyMatrix4(mesh.matrixWorld);
}

interface LayoutItem {
  idx: number;
  dotX: number;
  dotY: number;
  calloutLeft: number;
  calloutTop: number;
  pathD: string;
}
interface Layout {
  /** 'side' : bulles de part et d'autre du tableau · 'sheet' : une seule fiche en bas (petit écran) */
  mode: 'side' | 'sheet';
  calloutW: number;
  items: LayoutItem[];
}

/** Place minimale (px) de chaque côté du tableau pour y loger une bulle lisible. */
const MIN_SIDE_ROOM = 176;
const MAX_CALLOUT_W = 240;
const NO_ANNOTATIONS: AnnotationPoint[] = [];

export const GuidedAnnotations: React.FC<GuidedAnnotationsProps> = ({
  lang,
  painting,
  camera,
  paintingMesh,
  detailMode,
  detailImgRef,
}) => {
  const [activeStep, setActiveStep] = useState<number>(-1);
  /** Dernière étape affichée (reste visible dans la fiche une fois la lecture terminée). */
  const [shownStep, setShownStep] = useState<number>(-1);
  const annotations: AnnotationPoint[] = painting.annotations || NO_ANNOTATIONS;
  const guideTokenRef = useRef(0);
  const [layout, setLayout] = useState<Layout | null>(null);

  const calloutEls = useRef<(HTMLDivElement | null)[]>([]);
  const heightsRef = useRef<number[]>([]);
  const frameRef = useRef(0);
  const heightsKeyRef = useRef('');
  const lastLayoutKey = useRef('');

  // Texte lu en introduction (affiché dans la fiche pendant la respiration)
  const introText = painting.raison
    ? `${t('breathe_reason', lang)}${painting.raison}`
    : (t('breathe_generic', lang) as (title: string) => string)(painting.title);

  // Mise en page : recalculée à chaque frame (le tableau bouge pendant le travelling
  // de la caméra, et l'image bouge pendant le zoom / déplacement de la vue détail),
  // mais l'état React n'est mis à jour que si le résultat change réellement.
  const computeLayout = useCallback((): Layout | null => {
    if (!annotations.length) return null;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const shortScreen = H < 520;
    const GAPX = 16;

    // Hauteurs réelles des bulles : mémorisées (elles disparaissent du DOM en mode fiche)
    // et oubliées dès que l'écran ou le tableau change.
    const hKey = `${W}x${H}|${painting.id}|${annotations.length}`;
    if (heightsKeyRef.current !== hKey) {
      heightsKeyRef.current = hKey;
      heightsRef.current = [];
    }
    // Lecture du DOM (reflow forcé) : toutes les ~12 images seulement, ou tant qu'on n'a aucune mesure.
    frameRef.current++;
    if (frameRef.current % 12 === 0 || heightsRef.current.length === 0) {
      calloutEls.current.forEach((el, i) => {
        if (el && el.offsetHeight) heightsRef.current[i] = el.offsetHeight;
      });
    }

    let bbL = 0;
    let bbR = W;
    let dotPos = (nx: number, ny: number) => ({ x: W * nx, y: H * ny });

    if (detailMode && detailImgRef.current) {
      const r = detailImgRef.current.getBoundingClientRect();
      if (r.width <= 0) return null;
      bbL = r.left;
      bbR = r.right;
      dotPos = (nx, ny) => ({ x: r.left + nx * r.width, y: r.top + ny * r.height });
    } else if (paintingMesh && camera) {
      camera.updateMatrixWorld(true);
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([nx, ny]) => projectToScreen(annotWorld(paintingMesh, nx, ny), camera));
      bbL = Math.min(...corners.map(c => c.x));
      bbR = Math.max(...corners.map(c => c.x));
      dotPos = (nx, ny) => projectToScreen(annotWorld(paintingMesh, nx, ny), camera);
    }

    // Y a-t-il la place de poser des bulles de chaque côté du tableau ?
    const roomL = bbL - 12;
    const roomR = W - bbR - 12;
    const sideRoom = Math.min(roomL, roomR);
    // Image agrandie sur un écran large : les bulles restent de part et d'autre, reliées par une ligne,
    // même quand l'image est zoomée au-delà des bords (elles se collent alors aux bords de l'écran).
    const wideDetail = detailMode && W >= 900 && H >= 520;
    let mode: 'side' | 'sheet' = wideDetail || (W >= 560 && sideRoom >= MIN_SIDE_ROOM) ? 'side' : 'sheet';
    const maxW = shortScreen ? 208 : MAX_CALLOUT_W;
    const calloutW = wideDetail
      ? 232
      : Math.min(maxW, Math.max(MIN_SIDE_ROOM - GAPX, Math.floor(sideRoom - GAPX)));

    const items = annotations.map((ann, idx) => {
      const s = dotPos(ann.x, ann.y);
      return { idx, sx: s.x, sy: s.y, side: (ann.x < 0.5 ? 'left' : 'right') as 'left' | 'right' };
    });

    // Écarte les pastilles qui se chevauchent
    const MIN_SEP = mode === 'sheet' ? 32 : 42;
    for (let iter = 0; iter < 6; iter++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let k = i + 1; k < items.length; k++) {
          let dx = items[k].sx - items[i].sx;
          let dy = items[k].sy - items[i].sy;
          let d = Math.hypot(dx, dy);
          if (d < MIN_SEP) {
            if (d < 0.001) {
              dx = k % 2 ? 1 : -1;
              dy = 0.5;
              d = Math.hypot(dx, dy);
            }
            const push = (MIN_SEP - d) / 2;
            const ux = dx / d;
            const uy = dy / d;
            items[i].sx -= ux * push;
            items[i].sy -= uy * push;
            items[k].sx += ux * push;
            items[k].sy += uy * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    const out: LayoutItem[] = items.map(it => ({
      idx: it.idx,
      dotX: it.sx,
      dotY: it.sy,
      calloutLeft: 0,
      calloutTop: 0,
      pathD: '',
    }));

    let overflow = false;
    if (mode === 'side') {
      const TOP = shortScreen ? 52 : 90;
      const BOT = H - (shortScreen ? 12 : 36);
      const GAP = shortScreen ? 8 : 12;
      const leftX = Math.max(12, bbL - GAPX - calloutW);
      const rightX = Math.min(W - 12 - calloutW, bbR + GAPX);

      (['left', 'right'] as const).forEach(side => {
        const group = items.filter(it => it.side === side).sort((a, b) => a.sy - b.sy);
        if (!group.length) return;
        const left = side === 'left' ? leftX : rightX;
        // Hauteurs RÉELLES des bulles (le texte généré varie beaucoup d'un tableau à l'autre)
        const hs = group.map(it => heightsRef.current[it.idx] || 96);
        const total = hs.reduce((s, h) => s + h, 0) + GAP * (group.length - 1);
        const avail = BOT - TOP;

        let tops: number[];
        if (total >= avail) {
          overflow = true;
          let y = TOP;
          tops = hs.map(h => {
            const v = y;
            y += h + GAP;
            return v;
          });
        } else {
          tops = group.map((it, i) => it.sy - hs[i] / 2);
          for (let i = 1; i < tops.length; i++) {
            const minTop = tops[i - 1] + hs[i - 1] + GAP;
            if (tops[i] < minTop) tops[i] = minTop;
          }
          const lastI = tops.length - 1;
          if (tops[lastI] + hs[lastI] > BOT) tops[lastI] = BOT - hs[lastI];
          for (let i = lastI - 1; i >= 0; i--) {
            const maxTop = tops[i + 1] - hs[i] - GAP;
            if (tops[i] > maxTop) tops[i] = maxTop;
          }
          if (tops[0] < TOP) tops[0] = TOP;
        }

        group.forEach((it, i) => {
          const o = out[it.idx];
          const top = tops[i];
          const ax = side === 'left' ? left + calloutW : left;
          const ay = top + hs[i] / 2;
          const mx = (ax + it.sx) / 2;
          o.calloutLeft = left;
          o.calloutTop = top;
          o.pathD = `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${it.sy}, ${it.sx} ${it.sy}`;
        });
      });
    }

    // Les bulles ne tiennent pas en hauteur (texte long, écran bas) : une seule fiche en bas
    if (overflow) mode = 'sheet';

    return { mode, calloutW, items: out };
  }, [annotations, camera, detailMode, detailImgRef, paintingMesh, painting.id]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = computeLayout();
      const key = next
        ? next.mode +
          next.calloutW +
          next.items.map(i => [i.dotX, i.dotY, i.calloutLeft, i.calloutTop].map(v => Math.round(v)).join(',')).join('|')
        : '';
      if (key !== lastLayoutKey.current) {
        lastLayoutKey.current = key;
        setLayout(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [computeLayout]);

  // La fiche remplace la légende et les boutons précédent / suivant pendant la visite
  const mode = layout?.mode;
  useEffect(() => {
    document.body.classList.toggle('annot-sheet-open', mode === 'sheet');
    return () => document.body.classList.remove('annot-sheet-open');
  }, [mode]);
  // (en paysage court, la légende et la navigation s'effacent aussi en mode bulles — voir le CSS)
  useEffect(() => {
    document.body.classList.add('annot-open');
    return () => document.body.classList.remove('annot-open');
  }, []);

  // Narration vocale, point par point
  useEffect(() => {
    const token = ++guideTokenRef.current;

    async function run() {
      setActiveStep(-1);
      setShownStep(-1);

      // Les 2 premières annotations sont synthétisées pendant que l'introduction est lue
      prefetchText(introText, lang);
      annotations.slice(0, 2).forEach(a => prefetchText(a.text, lang));
      await ttsPlay(introText, lang);
      if (token !== guideTokenRef.current) return;
      await new Promise(r => setTimeout(r, 450));

      for (let i = 0; i < annotations.length; i++) {
        if (token !== guideTokenRef.current) return;
        setActiveStep(i);
        setShownStep(i);
        if (annotations[i + 2]) prefetchText(annotations[i + 2].text, lang);
        await new Promise(r => setTimeout(r, i === 0 ? 250 : 650));
        if (token !== guideTokenRef.current) return;
        await ttsPlay(annotations[i].text, lang);
        if (token !== guideTokenRef.current) return;
      }

      await new Promise(r => setTimeout(r, 400));
      if (token !== guideTokenRef.current) return;
      setActiveStep(-1);
    }

    if (annotations.length > 0) {
      run();
    }

    return () => {
      guideTokenRef.current++;
      haltSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, lang, painting]);

  const jumpToStep = (i: number) => {
    if (i < 0 || i >= annotations.length) return;
    haltSpeech();
    const token = ++guideTokenRef.current;
    (async () => {
      for (let k = i; k < annotations.length; k++) {
        if (token !== guideTokenRef.current) return;
        setActiveStep(k);
        setShownStep(k);
        if (k > i) await new Promise(r => setTimeout(r, 550));
        if (token !== guideTokenRef.current) return;
        await ttsPlay(annotations[k].text, lang);
        if (token !== guideTokenRef.current) return;
      }
      setActiveStep(-1);
    })();
  };

  const isSheet = layout?.mode === 'sheet';
  const current = shownStep >= 0 ? annotations[shownStep] : null;

  return (
    <div id="annot-layer">
      {!isSheet && (
        <svg id="annot-lines">
          {layout?.items.map(item => {
            const isActive = activeStep === item.idx;
            const isDim = activeStep >= 0 && !isActive;
            return (
              <path
                key={item.idx}
                d={item.pathD}
                className={`annot-line ${isActive ? 'active' : ''} ${isDim ? 'dim' : ''}`}
              />
            );
          })}
        </svg>
      )}

      {layout?.items.map(item => {
        const isActive = activeStep === item.idx;
        const isDim = activeStep >= 0 && !isActive;
        const ann = annotations[item.idx];

        return (
          <React.Fragment key={item.idx}>
            {/* Pastille numérotée posée sur le tableau */}
            <div
              onClick={() => jumpToStep(item.idx)}
              style={{ left: item.dotX, top: item.dotY }}
              className={`annot-dot ${isActive ? 'active' : ''} ${isDim ? 'dim' : ''}`}
            >
              {item.idx + 1}
            </div>

            {/* Bulle (écrans larges uniquement) */}
            {!isSheet && (
              <div
                ref={el => {
                  calloutEls.current[item.idx] = el;
                }}
                onClick={() => jumpToStep(item.idx)}
                style={{ left: item.calloutLeft, top: item.calloutTop, width: layout.calloutW }}
                className={`annot-callout show ${isActive ? 'active' : ''} ${isDim ? 'dim' : ''}`}
              >
                <div className="ac-label">
                  <span className="ac-num">{item.idx + 1}</span>
                  <span>{ann.label || t('look_here', lang)}</span>
                </div>
                <div className="ac-text">{ann.text}</div>
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Petit écran : UNE seule fiche en bas, qui suit la lecture (ne masque plus le tableau) */}
      {isSheet && (
        <div className="annot-sheet" role="region" aria-live="polite">
          <div className="as-head">
            <button
              type="button"
              className="as-step"
              onClick={() => jumpToStep(shownStep - 1)}
              disabled={shownStep <= 0}
              aria-label={t('nav_prev', lang) as string}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="as-chips">
              {annotations.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`as-chip ${i === shownStep ? 'active' : ''} ${i < shownStep ? 'done' : ''}`}
                  onClick={() => jumpToStep(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="as-step"
              onClick={() => jumpToStep(shownStep + 1)}
              disabled={shownStep >= annotations.length - 1}
              aria-label={t('nav_next', lang) as string}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
          {current ? (
            <>
              <div className="as-label">{current.label || t('look_here', lang)}</div>
              <div className="as-text">{current.text}</div>
            </>
          ) : (
            <div className="as-text intro">{introText}</div>
          )}
        </div>
      )}
    </div>
  );
};
