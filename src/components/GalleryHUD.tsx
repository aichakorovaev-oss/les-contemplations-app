import React, { useEffect, useRef } from 'react';
import { Lang, Painting, RoomKey } from '../types/gallery';
import { ROOM_NAMES, t } from '../i18n/strings';
import { ROOMS, WallLightItem } from '../three/builder';
import { renderMinimap } from '../three/minimap';
import * as THREE from 'three';

interface GalleryHUDProps {
  lang: Lang;
  camera: THREE.PerspectiveCamera | null;
  yaw: number;
  wallLights: WallLightItem[];
  proximityPainting: Painting | null;
  currentRoomKey: RoomKey | null;
  roomPaintingCounts: Record<RoomKey, number>;
  paintings: Painting[];
  activePaintingIdx: number;
  isFocused: boolean;
  onReturnHome: () => void;
  onOpenFeedback: () => void;
  roomNudgeText: string | null;
}

export const GalleryHUD: React.FC<GalleryHUDProps> = ({
  lang,
  camera,
  yaw,
  wallLights,
  proximityPainting,
  currentRoomKey,
  roomPaintingCounts,
  paintings,
  activePaintingIdx,
  isFocused,
  onReturnHome,
  onOpenFeedback,
  roomNudgeText,
}) => {
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || !camera) return;
    renderMinimap(canvas, camera, yaw, wallLights);
  });

  if (isFocused) return null;

  const roomDef = currentRoomKey ? ROOMS[currentRoomKey] : null;
  const countInRoom = currentRoomKey ? roomPaintingCounts[currentRoomKey] || 0 : 0;
  const roomNameStr = currentRoomKey ? ROOM_NAMES[lang][currentRoomKey] : '';

  return (
    <>
      {/* RETICLE */}
      <div
        className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none z-10 mix-blend-difference transition-all duration-200 after:content-[''] after:absolute after:left-1/2 after:top-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:w-[2px] after:h-[2px] after:bg-[rgba(255,230,200,0.5)] after:rounded-full ${
          proximityPainting
            ? 'w-7 h-7 border border-[rgba(255,230,200,0.85)] bg-[rgba(255,230,200,0.06)]'
            : 'w-3.5 h-3.5 border border-[rgba(255,230,200,0.28)]'
        }`}
      />

      {/* PROXIMITY LABEL */}
      {proximityPainting && (
        <div className="fixed left-1/2 top-[calc(50%+42px)] sm:top-[calc(50%+46px)] -translate-x-1/2 text-center pointer-events-none z-11 animate-[fadeIn_0.18s_ease_both] px-3">
          <span
            className="block italic font-normal text-lg sm:text-xl text-[#f4f0e6] drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]"
            style={{ fontFamily: 'var(--night-uncial)' }}
          >
            {proximityPainting.title}
          </span>
          <span className="block font-sans text-[9px] sm:text-[10px] tracking-[0.18em] uppercase text-[#f4f0e6]/60 mt-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
            tap / click<span className="kbd-only"> · or press <kbd className="border border-[#f4f0e6]/60 px-1 py-0.5 rounded text-[9px] sm:text-[10px]">E</kbd></span>
          </span>
        </div>
      )}

      {/* ROOM NAMEPLATE */}
      {currentRoomKey && roomDef && (
        <div
          key={currentRoomKey}
          className="fixed top-14 sm:top-7 left-4 sm:left-8 z-10 flex flex-col gap-0.5 pointer-events-none animate-[roomFade_4.8s_ease_both]"
        >
          <span
            className="italic font-normal text-2xl sm:text-3xl tracking-tight text-[#f4f0e6] drop-shadow-[0_2px_14px_rgba(0,0,0,0.8)]"
            style={{ fontFamily: 'var(--night-uncial)' }}
          >
            {roomNameStr}
          </span>
          {countInRoom > 0 ? (
            <span className="font-sans text-[9px] sm:text-[10px] tracking-[0.28em] uppercase text-[#d6b187]">
              {roomDef.subtitle}
            </span>
          ) : (
            <span className="font-sans text-[9px] sm:text-[10px] tracking-[0.28em] uppercase text-[#ff9d4d] drop-shadow-[0_0_14px_rgba(255,157,77,0.55)]">
              {t('room_empty', lang)}
            </span>
          )}
        </div>
      )}

      {/* ROOM NUDGE BANNER */}
      {roomNudgeText && (
        <div id="room-nudge" className="pointer-events-none">
          {roomNudgeText}
        </div>
      )}

      {/* PARCOURS PROGRESS HUD DOTS */}
      <div className="fixed top-7 right-60 z-12 hidden md:flex gap-1.5 pointer-events-none">
        {paintings.slice(0, 10).map((p, idx) => (
          <div
            key={p.id || idx}
            className={`w-1.5 h-1.5 rounded-full border transition-colors duration-300 ${
              idx === activePaintingIdx
                ? 'bg-[#d6b187] border-[#d6b187]'
                : 'bg-transparent border-[#f4f0e6]/50'
            }`}
          />
        ))}
      </div>

      {/* MINIMAP */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-10 p-2 sm:p-2.5 bg-[#0a0d1a]/85 backdrop-blur-md border border-[#f4f0e6]/20 rounded-lg shadow-xl scale-85 sm:scale-100 origin-bottom-right">
        <canvas ref={minimapCanvasRef} width={150} height={150} className="block w-[110px] h-[110px] sm:w-[150px] sm:h-[150px]" />
        <div className="font-sans text-[8.5px] sm:text-[9px] tracking-[0.22em] uppercase text-[#f4f0e6]/60 text-center mt-1.5">
          {t('minimap_label', lang)}
        </div>
      </div>

      {/* CONTROLS STRIP */}
      <div className="fixed bottom-4.5 left-4 sm:bottom-6.5 sm:left-7 z-10 hidden sm:flex gap-3 sm:gap-4.5 pointer-events-none items-center font-sans text-[9.5px] sm:text-[10px] text-[#f4f0e6]/40 tracking-[0.14em] uppercase whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <kbd className="border border-[#f4f0e6]/35 px-1.5 py-0.5 rounded text-[#f4f0e6]/60">drag / swipe</kbd> look
        </span>
        <span className="inline-flex items-center gap-1.5">
          <kbd className="border border-[#f4f0e6]/35 px-1.5 py-0.5 rounded text-[#f4f0e6]/60">tap / click</kbd> walk
        </span>
        <span className="hidden md:inline-flex items-center gap-1.5">
          <kbd className="border border-[#f4f0e6]/35 px-1.5 py-0.5 rounded text-[#f4f0e6]/60">W A S D</kbd> move
        </span>
      </div>

      {/* GENERAL FEEDBACK BUTTON */}
      <button
        id="feedback-btn"
        type="button"
        onClick={onOpenFeedback}
        title={t('feedback_title_attr', lang)}
        className="fixed top-4 sm:top-6 right-26 sm:right-36 z-20 inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 bg-[#0a0d1a]/85 backdrop-blur-md border border-[#f4f0e6]/20 rounded-full text-[#f4f0e6]/80 font-sans text-[9.5px] sm:text-[10px] font-medium tracking-[0.16em] uppercase cursor-pointer hover:bg-[#f4f0e6]/[0.15] hover:border-[#f4f0e6]/50 hover:text-[#f4f0e6] transition-all duration-300 shadow-md"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>{t('feedback_label', lang)}</span>
      </button>

      {/* RETURN HOME BUTTON */}
      <button
        id="home-btn"
        type="button"
        onClick={onReturnHome}
        title={t('home_title', lang)}
        className="fixed top-4 sm:top-6 right-4 sm:right-6 z-20 inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 bg-[#0a0d1a]/85 backdrop-blur-md border border-[#f4f0e6]/20 rounded-full text-[#f4f0e6]/80 font-sans text-[9.5px] sm:text-[10px] font-medium tracking-[0.16em] uppercase cursor-pointer hover:bg-[#f4f0e6]/[0.15] hover:border-[#f4f0e6]/50 hover:text-[#f4f0e6] transition-all duration-300 shadow-md"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v9h14v-9" />
        </svg>
        <span>{t('home_label', lang)}</span>
      </button>
    </>
  );
};
