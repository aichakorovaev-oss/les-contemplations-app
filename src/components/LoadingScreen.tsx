import React from 'react';
import { Lang } from '../types/gallery';
import { t } from '../i18n/strings';

interface LoadingScreenProps {
  lang: Lang;
  progressPct: number;
  status: string;
  previewUrl?: string;
  previewTitle?: string;
  introText?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  lang,
  progressPct,
  status,
  previewUrl,
  previewTitle,
  introText,
}) => {
  return (
    <div id="loading-screen" className="fixed inset-0 z-56 flex flex-col items-center justify-start text-center p-0 px-4 sm:px-10 pb-10 overflow-y-auto">
      <div className="kite-column">
        <div className="kite-float">
          <div className="kite-svg-wrap" style={{ transform: 'translateX(-50%) scale(0.75)' }}>
            <div className="kite-glow" />
            <svg viewBox="0 0 200 200" className="kite-svg">
              <defs>
                <linearGradient id="kiteGradCyanLd" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FEF08A" />
                  <stop offset="100%" stopColor="#EAB308" />
                </linearGradient>
                <linearGradient id="kiteGradPinkLd" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FDBA74" />
                  <stop offset="100%" stopColor="#EA580C" />
                </linearGradient>
                <linearGradient id="kiteGradYellowLd" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#F9A8D4" />
                  <stop offset="100%" stopColor="#DB2777" />
                </linearGradient>
                <linearGradient id="kiteGradBlueLd" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#C4B5FD" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
                <linearGradient id="kiteGradPurpleLd" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#67E8F9" />
                  <stop offset="100%" stopColor="#0891B2" />
                </linearGradient>
              </defs>
              <polygon points="100,0 65,35 100,35" fill="url(#kiteGradCyanLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="65,35 35,65 65,60 82,35" fill="url(#kiteGradPinkLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="100,35 82,35 65,60 65,85 100,80" fill="url(#kiteGradYellowLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="35,65 15,85 35,92 65,85 65,60" fill="url(#kiteGradBlueLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="15,85 0,100 15,96 35,92" fill="url(#kiteGradPurpleLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="100,0 135,35 100,35" fill="url(#kiteGradCyanLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="135,35 165,65 135,60 118,35" fill="url(#kiteGradPinkLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="100,35 118,35 135,60 135,85 100,80" fill="url(#kiteGradYellowLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="165,65 185,85 165,92 135,85 135,60" fill="url(#kiteGradBlueLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="185,85 200,100 185,96 165,92" fill="url(#kiteGradPurpleLd)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <line x1="100" y1="0" x2="0" y2="100" stroke="#111" strokeWidth="2" strokeLinecap="round" />
              <line x1="100" y1="0" x2="200" y2="100" stroke="#111" strokeWidth="2" strokeLinecap="round" />
              <line x1="100" y1="0" x2="100" y2="80" stroke="#111" strokeWidth="2" strokeLinecap="round" />
              <line x1="65" y1="35" x2="135" y2="35" stroke="#111" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="82" y1="35" x2="65" y2="60" stroke="#222" strokeWidth="0.7" />
              <line x1="118" y1="35" x2="135" y2="60" stroke="#222" strokeWidth="0.7" />
              <line x1="65" y1="60" x2="65" y2="85" stroke="#222" strokeWidth="0.7" />
              <line x1="135" y1="60" x2="135" y2="85" stroke="#222" strokeWidth="0.7" />
              <line x1="35" y1="65" x2="65" y2="60" stroke="#222" strokeWidth="0.7" />
              <line x1="165" y1="65" x2="135" y2="60" stroke="#222" strokeWidth="0.7" />
              <line x1="15" y1="85" x2="35" y2="92" stroke="#222" strokeWidth="0.7" />
              <line x1="185" y1="85" x2="165" y2="92" stroke="#222" strokeWidth="0.7" />
              <path d="M 0 100 L 15 96 L 35 92 L 65 85 L 100 80 L 135 85 L 165 92 L 185 96 L 200 100" fill="none" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />
              <line x1="65" y1="85" x2="100" y2="110" stroke="rgba(255,255,255,.6)" strokeWidth="1" />
              <line x1="135" y1="85" x2="100" y2="110" stroke="rgba(255,255,255,.6)" strokeWidth="1" />
              <line x1="100" y1="80" x2="100" y2="110" stroke="rgba(255,255,255,.6)" strokeWidth="1" />
              <polygon points="95,110 105,110 108,120 92,120" fill="url(#kiteGradPinkLd)" stroke="rgba(0,0,0,.2)" strokeWidth="0.5" />
              <polygon points="100,110 105,110 108,120 100,120" fill="url(#kiteGradYellowLd)" stroke="rgba(0,0,0,.2)" strokeWidth="0.5" />
            </svg>
          </div>

          <div className="kite-cargo">
            <div className="cargo-content" style={{ opacity: 1 }}>
              <svg className="cargo-strings taut" viewBox="0 0 600 80" preserveAspectRatio="none">
                <line x1="300" y1="0" x2="90" y2="80" stroke="rgba(244,240,230,.45)" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="300" y1="0" x2="300" y2="80" stroke="rgba(244,240,230,.45)" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="300" y1="0" x2="510" y2="80" stroke="rgba(244,240,230,.45)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>

              <div className="decor-card">
                <div className="mood-card-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="eyebrow" id="loading-eyebrow">
                  {t('loading_eyebrow', lang)}
                </div>

                {previewUrl ? (
                  <img
                    id="loading-preview"
                    className="loading-painting-preview rounded shadow-xl transition-all duration-300"
                    src={previewUrl}
                    alt={previewTitle || ''}
                  />
                ) : (
                  <div className="loading-painting-preview rounded bg-[#f4f0e6]/[0.08] animate-pulse flex items-center justify-center">
                    <span className="text-[#f4f0e6]/40 text-xs">...</span>
                  </div>
                )}

                <div id="loading-title" className="text-xl sm:text-2xl font-serif italic text-[#f4f0e6] mb-2 min-h-[32px]">
                  {previewTitle || '...'}
                </div>
                <div id="loading-status" className="font-sans text-[11px] text-[#d6b187] tracking-[0.2em] uppercase mb-6 min-h-[20px]">
                  {status || t('loading_status_default', lang)}
                </div>

                <div className="loading-bar-track">
                  <div className="loading-bar-fill" id="loading-bar" style={{ width: `${progressPct}%` }} />
                </div>

                {introText && (
                  <p id="loading-parcours" className="visible mt-6 text-sm text-[#f4f0e6]/70 italic leading-relaxed">
                    {introText}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
