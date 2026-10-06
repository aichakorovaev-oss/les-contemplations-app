import React from 'react';
import { Lang, Painting } from '../types/gallery';
import { t } from '../i18n/strings';

interface FocusOverlayProps {
  lang: Lang;
  painting: Painting;
  infoOpen: boolean;
  isNarrating: boolean;
  isGuiding: boolean;
  isGuideLoading: boolean;
  onToggleInfo: () => void;
  onCloseInfo: () => void;
  onZoom: () => void;
  onToggleGuide: () => void;
  onReport: () => void;
  onExit: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleNarration: () => void;
}

export const FocusOverlay: React.FC<FocusOverlayProps> = ({
  lang,
  painting,
  infoOpen,
  isNarrating,
  isGuiding,
  isGuideLoading,
  onToggleInfo,
  onCloseInfo,
  onZoom,
  onToggleGuide,
  onReport,
  onExit,
  onPrev,
  onNext,
  onToggleNarration,
}) => {
  const isGated = !!(painting.nudity || painting.graphic);

  return (
    <div id="focus-overlay" className="fixed inset-0 z-20 pointer-events-none">
      {/* TOP-RIGHT TOOLBOX */}
      <div id="focus-toolbar" className={`absolute top-3 right-3 sm:top-5 sm:right-6 flex gap-1.5 sm:gap-2 z-22 pointer-events-auto transition-opacity duration-300 ${infoOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <button
          id="focus-info-btn"
          type="button"
          onClick={onToggleInfo}
          title={t('tool_info', lang)}
          className={`focus-tool w-9 h-9 sm:w-10 sm:h-10 ${infoOpen ? 'active' : ''}`}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16" />
            <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
          </svg>
        </button>

        <button
          id="focus-zoom-btn"
          type="button"
          onClick={onZoom}
          title={t('tool_zoom', lang)}
          className="focus-tool w-9 h-9 sm:w-10 sm:h-10"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8V4h4" />
            <path d="M16 4h4v4" />
            <path d="M20 16v4h-4" />
            <path d="M8 20H4v-4" />
          </svg>
        </button>

        <button
          id="focus-guide-btn"
          type="button"
          onClick={onToggleGuide}
          title={t('tool_guide', lang)}
          className={`focus-tool w-9 h-9 sm:w-10 sm:h-10 ${isGuiding ? 'active' : ''} ${isGuideLoading ? 'loading' : ''}`}
        >
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        </button>

        {!isGated && (
          <button
            id="focus-report-btn"
            type="button"
            onClick={onReport}
            title={t('tool_report', lang)}
            className="focus-tool w-9 h-9 sm:w-10 sm:h-10"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="4" />
            </svg>
          </button>
        )}

        <button
          id="focus-exit-btn"
          type="button"
          onClick={onExit}
          title={t('tool_exit', lang)}
          className="focus-tool w-9 h-9 sm:w-10 sm:h-10"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>

      {/* BOTTOM CAPTION */}
      <div id="focus-caption" className="pointer-events-none">
        <div id="focus-caption-title" className="">{painting.title}</div>
        <div id="focus-caption-meta" className="text-[9px] sm:text-[10px]">
          {painting.artist} · {painting.year}
        </div>
      </div>

      {/* BOTTOM NAVIGATION (PREV / NEXT) */}
      <div id="focus-nav" className="pointer-events-auto">
        <button
          id="focus-prev"
          type="button"
          onClick={onPrev}
          className="focus-nav-btn py-2.5 px-4 sm:py-3 sm:px-5 text-[9.5px] sm:text-[10px]"
          title={t('nav_prev', lang)}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span id="focus-prev-label">{t('nav_prev', lang)}</span>
        </button>

        <button
          id="focus-next"
          type="button"
          onClick={onNext}
          className="focus-nav-btn py-2.5 px-4 sm:py-3 sm:px-5 text-[9.5px] sm:text-[10px]"
          title={t('nav_next', lang)}
        >
          <span id="focus-next-label">{t('nav_next', lang)}</span>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* SLIDE-OVER ARTWORK SHEET */}
      <aside
        id="focus-info-panel"
        className={`pointer-events-auto z-35 ${infoOpen ? 'open' : ''}`}
      >
        <button
          id="close-info-btn"
          type="button"
          onClick={onCloseInfo}
          title={t('close_info', lang)}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 w-9 h-9 flex items-center justify-center rounded-full bg-[#f4f0e6]/10 hover:bg-[#f4f0e6]/25 text-[#f4f0e6] border border-[#f4f0e6]/30 cursor-pointer transition-all z-40"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>

        <div className="label" id="focus-panel-label">{t('panel_label', lang)}</div>

        <h2 id="focus-title" className="text-2xl sm:text-3xl md:text-4xl">{painting.title}</h2>

        <div id="focus-meta">
          <span id="focus-artist">{painting.artist}</span>
          <span id="focus-year">{painting.year}</span>
        </div>

        <dl id="focus-techspec">
          <div>
            <dt id="dt-technique">{t('dt_medium', lang)}</dt>
            <dd id="focus-medium">{painting.medium || '—'}</dd>
          </div>
          <div>
            <dt id="dt-format">{t('dt_format', lang)}</dt>
            <dd id="focus-dimensions">{painting.dimensions || '—'}</dd>
          </div>
          <div>
            <dt id="dt-conservation">{t('dt_location', lang)}</dt>
            <dd id="focus-location">{painting.location || '—'}</dd>
          </div>
        </dl>

        <p id="focus-desc">{painting.desc || ''}</p>

        {painting.details && painting.details.length > 0 && (
          <div className="details-block">
            <div className="dl-head" id="dl-head-details">{t('look_closely', lang)}</div>
            <ul id="focus-detail-list">
              {painting.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {/* AI REFLECTION SECTION */}
        {(painting.raison || painting.meditation || painting.anecdote || (painting.questions && painting.questions.length > 0)) && (
          <div className="ai-section" id="ai-section">
            {painting.raison && (
              <>
                <div className="ai-section-head" id="ai-head-why">{t('ai_why', lang)}</div>
                <p className="ai-raison" id="ai-raison">{painting.raison}</p>
              </>
            )}

            {painting.meditation && (
              <>
                <div className="ai-section-head" id="ai-head-meditation" style={{ marginTop: 14 }}>
                  {t('ai_meditation', lang)}
                </div>
                <p className="ai-meditation" id="ai-meditation">{painting.meditation}</p>
              </>
            )}

            {painting.anecdote && (
              <>
                <div className="ai-section-head" id="ai-head-anecdote" style={{ marginTop: 14 }}>
                  {t('ai_anecdote', lang)}
                </div>
                <p className="ai-anecdote" id="ai-anecdote">{painting.anecdote}</p>
              </>
            )}

            {painting.questions && painting.questions.length > 0 && (
              <>
                <div className="ai-section-head" id="ai-head-questions" style={{ marginTop: 14 }}>
                  {t('ai_questions', lang)}
                </div>
                <ul className="ai-questions" id="ai-questions">
                  {painting.questions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <button id="narration-btn" type="button" onClick={onToggleNarration} className="mt-4 w-full sm:w-auto">
          {isNarrating ? t('narration_stop', lang) : t('narration_play', lang)}
        </button>
      </aside>
    </div>
  );
};
