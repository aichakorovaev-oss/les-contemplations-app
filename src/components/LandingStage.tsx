import React, { useState, useEffect, useRef } from 'react';
import { Lang } from '../types/gallery';
import { MOOD_TAGS, t } from '../i18n/strings';

interface LandingStageProps {
  lang: Lang;
  onSubmitMood: (tags: string[], text: string) => void;
  onShowCrisis?: (onContinue: () => void) => void;
}

export const LandingStage: React.FC<LandingStageProps> = ({ lang, onSubmitMood, onShowCrisis }) => {
  const [phase, setPhase] = useState<'landing' | 'rising' | 'mood'>('landing');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState('');

  const floatRef = useRef<HTMLDivElement | null>(null);
  const cargoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mouseX = window.innerWidth / 2,
      mouseY = window.innerHeight / 2;
    let springX = mouseX,
      springY = mouseY,
      springVX = 0,
      springVY = 0;
    let prevSpringX = mouseX,
      prevSpringY = mouseY;
    let floatX = 0,
      floatY = 0,
      rotate = 0,
      swing = 0;
    let prevFloatX = 0;
    const t0 = performance.now();
    let lastP = t0;
    let rafId: number;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches.length) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
      }
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    function frame(now: number) {
      const dt = Math.min(3, (now - lastP) / 16.666);
      lastP = now;
      const timeSec = (now - t0) / 1000;

      const stiffness = 10,
        damping = 20,
        mass = 2;
      const axf = (-stiffness * (springX - mouseX) - damping * springVX) / mass;
      const ayf = (-stiffness * (springY - mouseY) - damping * springVY) / mass;
      springVX += axf * (dt / 60);
      springVY += ayf * (dt / 60);
      springX += springVX * (dt / 60) * 60;
      springY += springVY * (dt / 60) * 60;
      const velX = springX - prevSpringX;
      prevSpringX = springX;
      prevSpringY = springY;

      const windSwayX = Math.sin(timeSec * 1.0) * 5 + Math.sin(timeSec * 0.55) * 3;
      const windSwayY = Math.cos(timeSec * 1.4) * 3 + Math.sin(timeSec * 0.8) * 2;

      const newFloatX = windSwayX - velX * 0.03;
      const newFloatY = windSwayY - velX * 0.03;
      floatX += (newFloatX - floatX) * 0.06 * dt;
      floatY += (newFloatY - floatY) * 0.06 * dt;

      const tilt = Math.cos(timeSec * 1.0) * 1 + Math.sin(timeSec * 1.7) * 0.5;
      const newRotate = tilt - velX * 0.012;
      rotate += (newRotate - rotate) * 0.06 * dt;

      const kv = floatX - prevFloatX;
      prevFloatX = floatX;
      const gravityCounter = -rotate * 0.85;
      const drag = -kv * 1.5;
      const windSway = Math.sin(timeSec * 1.4) * 1.2;
      const targetSwing = gravityCounter + drag + windSway;
      swing += (targetSwing - swing) * 0.08 * dt;

      if (floatRef.current) {
        floatRef.current.style.transform = `translate(${floatX.toFixed(2)}px, ${floatY.toFixed(2)}px) rotate(${rotate.toFixed(3)}deg)`;
      }
      if (cargoRef.current) {
        cargoRef.current.style.transformOrigin = '50% -80px';
        // Sur téléphone, un grand panneau qui pivote de ±1° se décale de ±12 px en bas : on amortit
        const amp = window.innerWidth < 640 ? 0.3 : 1;
        cargoRef.current.style.transform = `rotate(${(swing * amp).toFixed(3)}deg)`;
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  const handleEnter = () => {
    setPhase('rising');
    setTimeout(() => {
      setPhase('mood');
    }, 850);
  };

  const handleReturn = () => {
    setPhase('rising');
    setTimeout(() => {
      setPhase('landing');
    }, 600);
  };

  const toggleTag = (label: string) => {
    const next = new Set(selectedTags);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setSelectedTags(next);
  };

  const isSubmitDisabled = selectedTags.size === 0 && freeText.trim() === '';

  const handleSubmit = () => {
    const tagsArr = Array.from(selectedTags);
    onSubmitMood(tagsArr, freeText);
  };

  const isRising = phase === 'rising' || phase === 'mood';
  const isMood = phase === 'mood';

  return (
    <div id="landing-screen" className={`${isRising ? 'is-rising' : ''} ${isMood ? 'is-mood' : ''}`}>
      <div className="kite-column" id="kite-column">
        <div className="kite-float" id="kite-float" ref={floatRef}>
          <div className="kite-svg-wrap" id="kite-wrap">
            <div className="kite-glow" />
            <svg viewBox="0 0 200 200" className="kite-svg">
              <defs>
                <linearGradient id="kiteGradCyanL" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FEF08A" />
                  <stop offset="100%" stopColor="#EAB308" />
                </linearGradient>
                <linearGradient id="kiteGradPinkL" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FDBA74" />
                  <stop offset="100%" stopColor="#EA580C" />
                </linearGradient>
                <linearGradient id="kiteGradYellowL" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#F9A8D4" />
                  <stop offset="100%" stopColor="#DB2777" />
                </linearGradient>
                <linearGradient id="kiteGradBlueL" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#C4B5FD" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
                <linearGradient id="kiteGradPurpleL" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#67E8F9" />
                  <stop offset="100%" stopColor="#0891B2" />
                </linearGradient>
              </defs>
              <polygon points="100,0 65,35 100,35" fill="url(#kiteGradCyanL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="65,35 35,65 65,60 82,35" fill="url(#kiteGradPinkL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="100,35 82,35 65,60 65,85 100,80" fill="url(#kiteGradYellowL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="35,65 15,85 35,92 65,85 65,60" fill="url(#kiteGradBlueL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="15,85 0,100 15,96 35,92" fill="url(#kiteGradPurpleL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="100,0 135,35 100,35" fill="url(#kiteGradCyanL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="135,35 165,65 135,60 118,35" fill="url(#kiteGradPinkL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="100,35 118,35 135,60 135,85 100,80" fill="url(#kiteGradYellowL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="165,65 185,85 165,92 135,85 135,60" fill="url(#kiteGradBlueL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
              <polygon points="185,85 200,100 185,96 165,92" fill="url(#kiteGradPurpleL)" stroke="rgba(0,0,0,.1)" strokeWidth="0.5" />
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
              <polygon points="95,110 105,110 108,120 92,120" fill="url(#kiteGradPinkL)" stroke="rgba(0,0,0,.2)" strokeWidth="0.5" />
              <polygon points="100,110 105,110 108,120 100,120" fill="url(#kiteGradYellowL)" stroke="rgba(0,0,0,.2)" strokeWidth="0.5" />
            </svg>
          </div>

          <div className="kite-cargo" id="kite-cargo" ref={cargoRef}>
            {/* Title Cargo */}
            <div className="cargo-content landing-cargo" id="landing-cargo">
              <h1 className="kite-title">
                <span className="kw" style={{ '--i': 0 } as any}>
                  <span className="drop-cap">{t('kite_dropcap', lang)}</span>
                  {t('kite_word1_rest', lang)}
                </span>{' '}
                <span className="kw" style={{ '--i': 1 } as any}>
                  {t('kite_word2', lang)}
                </span>
              </h1>
              <p className="kite-subtitle">
                {(t('subtitle_words', lang) as string[]).map((w, idx) => (
                  <span key={idx} className="kw" style={{ '--i': idx } as any}>
                    {w}
                  </span>
                ))}
              </p>
            </div>

            {/* Mood Cargo */}
            <div className="cargo-content mood-cargo" id="mood-cargo">
              <svg className="cargo-strings taut" viewBox="0 0 800 80" preserveAspectRatio="none">
                <line x1="400" y1="0" x2="120" y2="80" stroke="rgba(244,240,230,.45)" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="400" y1="0" x2="400" y2="80" stroke="rgba(244,240,230,.45)" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="400" y1="0" x2="680" y2="80" stroke="rgba(244,240,230,.45)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>

              <div className="mood-card">
                <div className="mood-card-bg" />
                <div className="mood-card-dots">
                  <span />
                  <span />
                  <span />
                </div>

                <h2 className="mood-title">
                  {(t('mood_title_words', lang) as string[]).map((w, idx) => (
                    <span key={idx} className="kw" style={{ '--i': idx } as any}>
                      {w}
                    </span>
                  ))}
                </h2>

                <div className="mood-input-wrap">
                  <textarea
                    className="mood-text-area"
                    rows={1}
                    value={freeText}
                    onChange={e => setFreeText(e.target.value)}
                    placeholder={t('mood_placeholder', lang)}
                  />
                </div>

                <div className="mood-tags">
                  {MOOD_TAGS.map((tag, idx) => {
                    const label = lang === 'en' ? tag.en : tag.fr;
                    const isSelected = selectedTags.has(label);
                    return (
                      <button
                        key={tag.key}
                        type="button"
                        onClick={() => toggleTag(label)}
                        className={`mood-tag ${isSelected ? 'selected' : ''}`}
                        style={{ '--ti': idx } as any}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <p className="mood-caption">
                  {(t('mood_caption_words', lang) as string[]).map((w, idx) => (
                    <span key={idx} className="kw" style={{ '--i': idx } as any}>
                      {w}
                    </span>
                  ))}
                </p>

                <div className="mood-nav">
                  <button type="button" onClick={handleReturn} className="mood-nav-link mood-nav-return">
                    {t('mood_return', lang)}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitDisabled}
                    onClick={handleSubmit}
                    className="mood-nav-link mood-nav-continue"
                  >
                    {t('mood_continue', lang)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="landing-footer" id="landing-footer">
        <button type="button" onClick={handleEnter} className="landing-enter">
          <span>{t('landing_enter', lang)}</span>
          <span className="enter-line" />
        </button>
      </footer>
    </div>
  );
};
