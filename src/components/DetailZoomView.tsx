import React, { useState, useRef, useEffect } from 'react';
import { Lang, Painting } from '../types/gallery';
import { t } from '../i18n/strings';

interface DetailZoomViewProps {
  lang: Lang;
  painting: Painting;
  isGuiding: boolean;
  onToggleGuide: () => void;
  onClose: () => void;
  imgRef: React.RefObject<HTMLImageElement | null>;
}

export const DetailZoomView: React.FC<DetailZoomViewProps> = ({
  lang,
  painting,
  isGuiding,
  onToggleGuide,
  onClose,
  imgRef,
}) => {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showHint, setShowHint] = useState(true);
  // Écran large + visite guidée : on réserve des gouttières à gauche et à droite de l'image pour que les
  // bulles d'annotation (reliées par une ligne) ne la recouvrent pas.
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const gutter = isGuiding && wide ? 280 : 0;

  // Gestes multi-pointeurs (souris, doigt, stylet)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef({ x: 0, y: 0 });
  const pinch = useRef<{ dist: number; scale: number; pos: { x: number; y: number }; mid: { x: number; y: number } } | null>(null);
  const tap = useRef({ time: 0, x: 0, y: 0, moved: 0, type: 'mouse' });

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 3200);
    return () => clearTimeout(timer);
  }, []);

  const clampScale = (v: number) => Math.max(1, Math.min(6, v));

  /** Empêche de perdre l'image hors de l'écran. */
  const clampPos = (p: { x: number; y: number }, sc: number) => {
    const el = imgRef.current;
    if (!el || sc <= 1.001) return { x: 0, y: 0 };
    const w = el.offsetWidth * sc;
    const h = el.offsetHeight * sc;
    const mx = w > window.innerWidth ? (w - window.innerWidth) / 2 + 40 : (w - 0) / 4;
    const my = h > window.innerHeight ? (h - window.innerHeight) / 2 + 40 : (h - 0) / 4;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };

  const zoomAt = (cx: number, cy: number, next: number, from = { scale, pos }) => {
    // garde fixe le point de l'image situé sous (cx, cy)
    const ox = cx - window.innerWidth / 2;
    const oy = cy - window.innerHeight / 2;
    const ratio = next / from.scale;
    setScale(next);
    setPos(clampPos({ x: (from.pos.x - ox) * ratio + ox, y: (from.pos.y - oy) * ratio + oy }, next));
  };

  const handleWheel = (e: React.WheelEvent) => {
    const next = clampScale(scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
    zoomAt(e.clientX, e.clientY, next);
  };

  const toggleZoom = (cx: number, cy: number) => {
    if (scale > 1.1) {
      setScale(1);
      setPos({ x: 0, y: 0 });
    } else {
      zoomAt(cx, cy, 2.5);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointeur déjà relâché : sans importance */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      tap.current.moved = 0;
      tap.current.type = e.pointerType;
      setIsDragging(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale,
        pos,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      tap.current.moved = 99;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      // Pincement : zoom centré entre les deux doigts (+ déplacement du centre)
      const [a, b] = [...pointers.current.values()];
      const g = pinch.current;
      const next = clampScale((g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ox = g.mid.x - window.innerWidth / 2;
      const oy = g.mid.y - window.innerHeight / 2;
      const ratio = next / g.scale;
      const nx = mid.x - window.innerWidth / 2 - (ox - g.pos.x) * ratio;
      const ny = mid.y - window.innerHeight / 2 - (oy - g.pos.y) * ratio;
      setScale(next);
      setPos(clampPos({ x: nx, y: ny }, next));
      return;
    }
    if (pointers.current.size === 1 && isDragging) {
      tap.current.moved = Math.max(
        tap.current.moved,
        Math.hypot(e.clientX - dragStart.current.x - pos.x, e.clientY - dragStart.current.y - pos.y)
      );
      setPos(clampPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }, scale));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const wasDown = pointers.current.delete(e.pointerId);
    if (!wasDown) return;
    pinch.current = null;
    if (pointers.current.size === 1) {
      // un doigt reste posé : on reprend le déplacement sans saut
      const [p] = [...pointers.current.values()];
      dragStart.current = { x: p.x - pos.x, y: p.y - pos.y };
    } else if (pointers.current.size === 0) {
      setIsDragging(false);
      // Double-tap (tactile) : bascule zoom ×2,5 / ajustement
      if (e.pointerType !== 'mouse' && tap.current.moved < 10) {
        const now = Date.now();
        const near = Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) < 40;
        if (now - tap.current.time < 320 && near) {
          toggleZoom(e.clientX, e.clientY);
          tap.current.time = 0;
        } else {
          tap.current.time = now;
          tap.current.x = e.clientX;
          tap.current.y = e.clientY;
        }
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (tap.current.type !== 'mouse') return; // déjà géré par le double-tap tactile
    toggleZoom(e.clientX, e.clientY);
  };

  const hint =
    lang === 'fr'
      ? ['pincer / molette', 'zoomer', 'glisser', 'déplacer', 'double-tap', 'réinitialiser']
      : ['pinch / scroll', 'zoom', 'drag', 'pan', 'double-tap', 'reset'];

  const imgSrc = painting.detailUrl || painting.url || '';

  return (
    <div
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      className={`fixed inset-0 z-40 bg-black overflow-hidden grid place-items-center touch-none select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        title={t('detail_close', lang)}
        className="absolute top-[max(16px,env(safe-area-inset-top))] right-[max(16px,env(safe-area-inset-right))] sm:right-6 w-10 h-10 rounded-full bg-[#f4f0e6]/10 backdrop-blur-[6px] border border-[#f4f0e6]/25 text-[#f4f0e6] text-2xl grid place-items-center cursor-pointer hover:bg-[#f4f0e6]/25 hover:border-[#f4f0e6]/60 transition-all duration-200 z-[2]"
      >
        ×
      </button>

      <button
        type="button"
        onClick={onToggleGuide}
        title={t('tool_guide', lang)}
        className={`absolute top-[max(16px,env(safe-area-inset-top))] right-[calc(max(16px,env(safe-area-inset-right))+52px)] sm:right-[76px] w-10 h-10 rounded-full backdrop-blur-[6px] border grid place-items-center cursor-pointer transition-all duration-200 z-[2] hover:bg-[#f4f0e6]/25 hover:border-[#f4f0e6]/60 ${
          isGuiding
            ? 'bg-[#f4f0e6]/20 border-[#f4f0e6] text-[#f4f0e6] shadow-[0_0_20px_rgba(244,240,230,0.4)]'
            : 'bg-[#f4f0e6]/10 border-[#f4f0e6]/25 text-[#f4f0e6]/80'
        }`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
      </button>

      <img
        ref={imgRef}
        src={imgSrc}
        alt={painting.title}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.05s linear, max-width .3s ease',
          maxWidth: gutter ? `calc(100vw - ${gutter * 2}px)` : undefined,
        }}
        className="max-w-[95vw] max-h-[95vh] select-none pointer-events-none origin-center shadow-[0_30px_80px_rgba(0,0,0,0.8)]"
      />

      {showHint && (
        <div className="absolute bottom-[max(24px,calc(env(safe-area-inset-bottom)+12px))] sm:bottom-9 left-1/2 -translate-x-1/2 max-w-[94vw] px-3 sm:px-4 py-2 bg-[#0a0d1a]/85 border border-[#f4f0e6]/25 rounded-full font-sans text-[9.5px] sm:text-[10px] tracking-[0.12em] sm:tracking-[0.18em] uppercase text-[#f4f0e6]/70 pointer-events-none text-center shadow-lg">
          <span className="text-[#d6b187]">{hint[0]}</span> {hint[1]} · <span className="text-[#d6b187]">{hint[2]}</span> {hint[3]} · <span className="text-[#d6b187]">{hint[4]}</span> {hint[5]}
        </div>
      )}
    </div>
  );
};
