import React from 'react';
import { Lang, Painting } from '../types/gallery';
import { ROOM_NAMES, t } from '../i18n/strings';

interface StartScreenProps {
  lang: Lang;
  paintings: Painting[];
  introText: string;
  onEnterGallery: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({
  lang,
  paintings,
  introText,
  onEnterGallery,
}) => {
  const hints = t('hints', lang) as [string, string][];

  return (
    <div id="start-screen">
      <div className="parcours-bg">
        <div className="parcours-content">
          <h1 id="start-heading">
            {t('start_heading_pre', lang)}
            <em>{t('start_heading_em', lang)}</em>
            {t('start_heading_post', lang)}
          </h1>

          {introText && <p id="parcours-intro">{introText}</p>}

          <div id="parcours-list">
            {paintings.slice(0, 10).map((p, idx) => {
              const room = p.room_hint ? ROOM_NAMES[lang][p.room_hint] : '';
              return (
                <div key={p.id || idx} className="parcours-item">
                  <span className="parcours-num">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="parcours-item-body">
                    <span className="parcours-item-title">{p.title}</span>
                    <span className="parcours-item-artist">
                      {p.artist} {room ? `· ${room}` : ''}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <button id="start-btn" type="button" onClick={onEnterGallery}>
            {t('start_btn', lang)}
          </button>

          <div className="controls-hint" id="controls-hint-list">
            {hints.map(([key, label], idx) => (
              <span key={idx}>
                <b>{key}</b> {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
