import React, { useState, useEffect } from 'react';
import { Lang, Painting, ReportPayload, FeedbackPayload } from '../types/gallery';
import { CRISIS_RESOURCES, t } from '../i18n/strings';

// ─── HOME CONFIRM MODAL ───
interface HomeConfirmModalProps {
  lang: Lang;
  onStay: () => void;
  onLeave: () => void;
}

export const HomeConfirmModal: React.FC<HomeConfirmModalProps> = ({ lang, onStay, onLeave }) => {
  return (
    <div id="home-confirm-overlay" className="fixed inset-0 z-[95] bg-[#060812]/80 backdrop-blur-[6px] flex items-center justify-center p-4">
      <div className="home-confirm-card max-w-[400px] w-full p-6 sm:p-8 rounded-2xl border border-[rgba(180,200,230,0.22)] text-center" style={{ background: 'var(--glass-night)' }}>
        <p className="font-serif italic text-base sm:text-lg text-[#f4f0e6] leading-relaxed mb-6">
          {t('home_confirm_text', lang)}
        </p>
        <div className="home-confirm-actions flex justify-center gap-3">
          <button type="button" onClick={onStay} className="mood-nav-link mood-nav-return px-5 py-2.5 text-[11px]" id="home-stay">
            {t('home_confirm_stay', lang)}
          </button>
          <button type="button" onClick={onLeave} className="mood-nav-link mood-nav-continue px-5 py-2.5 text-[11px]" id="home-leave">
            {t('home_confirm_leave', lang)}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── CRISIS SUPPORT MODAL ───
interface CrisisModalProps {
  lang: Lang;
  onClose: () => void;
  onContinue: () => void;
}

export const CrisisModal: React.FC<CrisisModalProps> = ({ lang, onClose, onContinue }) => {
  const list = CRISIS_RESOURCES[lang] || CRISIS_RESOURCES.fr;

  return (
    <div id="crisis-overlay" className="fixed inset-0 z-[95] bg-[#060812]/80 backdrop-blur-[6px] flex items-center justify-center p-4">
      <div className="safety-card max-w-[460px] w-full p-6 sm:p-8 rounded-3xl border border-[rgba(180,200,230,0.22)] text-center max-h-[90vh] overflow-y-auto" style={{ background: 'var(--glass-night)' }}>
        <h3 className="safety-title text-lg sm:text-xl font-serif italic text-[#f4f0e6] mb-2">{t('crisis_title', lang)}</h3>
        <p className="safety-text text-xs sm:text-sm leading-relaxed text-[#f4f0e6]/75 mb-4">{t('crisis_text', lang)}</p>
        <div className="safety-resources flex flex-col gap-2 mb-5">
          {list.map((r, idx) => {
            const href = r.tel ? `tel:${r.tel.replace(/\s+/g, '')}` : r.url || '#';
            const target = r.url ? '_blank' : undefined;
            return (
              <a
                key={idx}
                href={href}
                target={target}
                rel={target ? 'noopener noreferrer' : undefined}
                className="safety-resource flex flex-col items-start gap-0.5 p-2.5 px-3.5 rounded-xl bg-[#f4f0e6]/[0.06] border border-[#f4f0e6]/15 text-inherit no-underline hover:bg-[#f4f0e6]/[0.14]"
              >
                <span className="safety-resource-name text-xs font-semibold text-[#f4f0e6]">{r.name}</span>
                <span className="safety-resource-detail text-[11px] text-[#f4f0e6]/60">{r.detail}</span>
              </a>
            );
          })}
        </div>
        <div className="nudity-gate-actions flex flex-col gap-2">
          <button type="button" onClick={onClose} className="nudity-gate-safe py-3 text-[11px]">
            {t('crisis_close', lang)}
          </button>
          <button type="button" onClick={onContinue} className="nudity-gate-reveal py-2 text-xs">
            {t('crisis_continue', lang)}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── 18+ SENSITIVE CONTENT GATE ───
interface NudityGateModalProps {
  lang: Lang;
  onDecline: () => void;
  onAccept: () => void;
}

export const NudityGateModal: React.FC<NudityGateModalProps> = ({ lang, onDecline, onAccept }) => {
  const [secondsLeft, setSecondsLeft] = useState(4);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  return (
    <div id="nudity-gate-overlay" className="fixed inset-0 z-[95] bg-[#060812]/80 backdrop-blur-[6px] flex items-center justify-center p-4">
      <div className="safety-card max-w-[460px] w-full p-6 sm:p-8 rounded-3xl border border-[rgba(180,200,230,0.22)] text-center" style={{ background: 'var(--glass-night)' }}>
        <h3 className="safety-title text-lg sm:text-xl font-serif italic text-[#f4f0e6] mb-2">{t('nudity_gate_title', lang)}</h3>
        <p className="safety-text text-xs sm:text-sm leading-relaxed text-[#f4f0e6]/75 mb-5">{t('nudity_gate_text', lang)}</p>
        <div className="nudity-gate-actions flex flex-col gap-2.5">
          <button type="button" onClick={onDecline} className="nudity-gate-safe py-3 text-[11px]" id="gate-decline">
            {t('nudity_gate_decline', lang)}
          </button>
          <button
            type="button"
            disabled={secondsLeft > 0}
            onClick={onAccept}
            className="nudity-gate-reveal py-2.5 text-[11px]"
            id="gate-accept"
          >
            {secondsLeft > 0
              ? t('nudity_gate_wait', lang).replace('{n}', String(secondsLeft))
              : t('nudity_gate_accept', lang)}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── REPORT ARTWORK MODAL ───
interface ReportModalProps {
  lang: Lang;
  painting: Painting;
  moodTags: string[];
  sessionId: string;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  lang,
  painting,
  moodTags,
  sessionId,
  onClose,
}) => {
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const reasons = [
    { id: 'triggering', key: 'report_reason_triggering' as const },
    { id: 'mismatched', key: 'report_reason_mismatched' as const },
    { id: 'empty_frame', key: 'report_reason_empty_frame' as const },
    { id: 'other', key: 'report_reason_other' as const },
  ];

  const handleSubmit = async () => {
    if (!reasonId || status === 'sending') return;
    setStatus('sending');
    try {
      const payload: ReportPayload = {
        painting_id: painting.id,
        painting_title: painting.title,
        reason_category: reasonId,
        reason_text: note.trim().slice(0, 1000),
        mood_tags: moodTags,
        lang,
        nonce: sessionId,
      };
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('bad status');
      setStatus('sent');
    } catch (_) {
      setStatus('error');
    }
  };

  return (
    <div id="report-overlay" className="fixed inset-0 z-[95] bg-[#060812]/80 backdrop-blur-[6px] flex items-center justify-center p-4">
      <div className="safety-card fb-card max-w-[480px] w-full p-5 sm:p-7 rounded-3xl border border-[rgba(180,200,230,0.22)]" style={{ background: 'var(--glass-night)' }}>
        {status === 'sent' ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--amber)', margin: '0 auto 10px' }}>
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="4" />
            </svg>
            <h3 className="safety-title text-lg font-serif italic text-[#f4f0e6] mb-1.5">
              {t('report_thanks_title', lang)}
            </h3>
            <p className="safety-text text-xs text-[#f4f0e6]/75 mb-4">
              {t('report_thanks_text', lang)}
            </p>
            <button type="button" onClick={onClose} className="fb-submit py-2.5 text-xs" style={{ maxWidth: 180, margin: '0 auto' }}>
              {t('close_generic', lang)}
            </button>
          </div>
        ) : (
          <div>
            <h3 className="safety-title text-lg font-serif italic text-[#f4f0e6] mb-1">{t('report_title', lang)}</h3>
            <p className="safety-text text-xs text-[#f4f0e6]/70 mb-3.5">{t('report_subtitle', lang)(painting.title)}</p>

            <div className="fb-question mb-3">
              <div className="flex flex-col gap-1.5">
                {reasons.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setReasonId(r.id)}
                    className={`fb-pill text-xs py-2 px-3 text-left ${reasonId === r.id ? 'selected' : ''}`}
                  >
                    {t(r.key, lang)}
                  </button>
                ))}
              </div>
            </div>

            <div className="fb-question mb-3">
              <textarea
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('report_note_placeholder', lang)}
                className="fb-textarea text-xs p-2.5"
              />
            </div>

            {status === 'error' && (
              <p style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8 }}>{t('report_error', lang)}</p>
            )}

            <button
              type="button"
              disabled={!reasonId || status === 'sending'}
              onClick={handleSubmit}
              className="fb-submit py-2.5 text-xs font-semibold"
            >
              {status === 'sending' ? t('report_sending', lang) : t('report_submit', lang)}
            </button>

            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', textDecoration: 'underline', fontSize: 11, cursor: 'pointer' }}
              >
                {t('report_cancel', lang)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── GENERAL FEEDBACK MODAL (NO-SCROLL & FULLY RESPONSIVE) ───
interface FeedbackModalProps {
  lang: Lang;
  moodTags: string[];
  paintingCount: number;
  sessionId: string;
  onClose: () => void;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  lang,
  moodTags,
  paintingCount,
  sessionId,
  onClose,
}) => {
  const [rating, setRating] = useState<number>(0);
  const [emptyFrame, setEmptyFrame] = useState<boolean | null>(null);
  const [resonated, setResonated] = useState<boolean | null>(null);
  const [surprised, setSurprised] = useState<boolean | null>(null);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [whyNot, setWhyNot] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const hasAnyAnswer =
    rating > 0 ||
    emptyFrame !== null ||
    resonated !== null ||
    surprised !== null ||
    wouldRecommend !== null ||
    comment.trim() !== '';

  const handleSubmit = async () => {
    if (!hasAnyAnswer || status === 'sending') return;
    setStatus('sending');
    try {
      const payload: FeedbackPayload = {
        rating: rating || null,
        empty_frame_seen: emptyFrame,
        resonated: resonated,
        surprised: surprised,
        would_recommend: wouldRecommend,
        why_not: whyNot.trim().slice(0, 1000),
        comment: comment.trim().slice(0, 2000),
        mood_tags: moodTags,
        painting_count: paintingCount,
        lang,
        nonce: sessionId,
      };
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('bad status');
      setStatus('sent');
    } catch (_) {
      setStatus('error');
    }
  };

  return (
    <div id="feedback-overlay" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="safety-card fb-card">
        {status === 'sent' ? (
          <div className="fb-thanks">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" style={{ color: 'var(--amber)', margin: '0 auto 10px' }}>
              <path d="M12 21s-6.7-4.35-9.3-8.6C1 9.7 1.7 6.4 4.4 4.9c2.3-1.3 4.9-.6 6.4 1.3l1.2 1.5 1.2-1.5c1.5-1.9 4.1-2.6 6.4-1.3 2.7 1.5 3.4 4.8 1.7 7.5C18.7 16.65 12 21 12 21z" />
            </svg>
            <p className="safety-title">{t('feedback_thanks_title', lang)}</p>
            <p className="safety-text">{t('feedback_thanks_text', lang)}</p>
            <button type="button" onClick={onClose} className="fb-submit" style={{ maxWidth: 200, margin: '.4rem auto 0', display: 'block' }}>
              {t('close_generic', lang)}
            </button>
          </div>
        ) : (
          <div>
            <p className="safety-title" id="feedback-title">{t('feedback_title', lang)}</p>
            <p className="safety-text">{t('feedback_subtitle', lang)}</p>

            <div className="fb-scroll">
              {/* Étoiles */}
              <div className="fb-stars">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`fb-star-btn ${star <= rating ? 'on' : ''}`}
                    title={`${star} / 5`}
                    aria-label={`${star} / 5`}
                  >
                    <svg viewBox="0 0 24 24" width="28" height="28" fill={star <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4">
                      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9" />
                    </svg>
                  </button>
                ))}
              </div>

              <div className="fb-question">
                <div className="fb-question-label">{t('fb_q_empty_frame_label', lang)}</div>
                <div className="fb-question-hint">{t('fb_q_empty_frame_hint', lang)}</div>
                <YesNo value={emptyFrame} onChange={setEmptyFrame} lang={lang} />
              </div>

              <div className="fb-question">
                <div className="fb-question-label">{t('fb_q_resonate_label', lang)}</div>
                <YesNo value={resonated} onChange={setResonated} lang={lang} />
              </div>

              <div className="fb-question">
                <div className="fb-question-label">{t('fb_q_surprised_label', lang)}</div>
                <YesNo value={surprised} onChange={setSurprised} lang={lang} />
              </div>

              <div className="fb-question">
                <div className="fb-question-label">{t('fb_q_recommend_label', lang)}</div>
                <YesNo value={wouldRecommend} onChange={setWouldRecommend} lang={lang} />
                {wouldRecommend === false && (
                  <textarea
                    className="fb-textarea"
                    rows={2}
                    value={whyNot}
                    onChange={e => setWhyNot(e.target.value)}
                    placeholder={t('feedback_why_not_placeholder', lang)}
                    style={{ marginTop: '.6rem' }}
                  />
                )}
              </div>

              <textarea
                className="fb-textarea"
                rows={3}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder={t('feedback_comment_placeholder', lang)}
              />
            </div>

            {status === 'error' && <p className="fb-error">{t('feedback_error', lang)}</p>}

            <button type="button" className="fb-submit" disabled={!hasAnyAnswer || status === 'sending'} onClick={handleSubmit}>
              {status === 'sending' ? t('feedback_sending', lang) : t('feedback_submit', lang)}
            </button>
            <div className="home-confirm-actions safety-actions" style={{ marginTop: '.8rem' }}>
              <a
                href="#"
                className="safety-link-action"
                onClick={e => {
                  e.preventDefault();
                  onClose();
                }}
              >
                {t('feedback_cancel', lang)}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Pastilles Oui / Non (mêmes classes que l'original). */
const YesNo: React.FC<{ value: boolean | null; onChange: (v: boolean) => void; lang: Lang }> = ({ value, onChange, lang }) => (
  <div className="fb-row" style={{ marginTop: '.55rem' }}>
    <button type="button" className={`fb-pill ${value === true ? 'selected' : ''}`} onClick={() => onChange(true)}>
      {t('yes_label', lang)}
    </button>
    <button type="button" className={`fb-pill ${value === false ? 'selected' : ''}`} onClick={() => onChange(false)}>
      {t('no_label', lang)}
    </button>
  </div>
);
