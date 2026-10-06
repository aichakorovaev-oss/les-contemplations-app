import React from 'react';
import { Lang } from '../types/gallery';

interface LanguageSwitchProps {
  currentLang: Lang;
  onSelect: (lang: Lang) => void;
  isFocused?: boolean;
}

export const LanguageSwitch: React.FC<LanguageSwitchProps> = ({ currentLang, onSelect, isFocused }) => {
  if (isFocused) return null;

  return (
    <div
      id="lang-switch"
      role="group"
      aria-label="Language / Langue"
      className="fixed top-4 left-4 sm:top-6 sm:left-6 z-[95] inline-flex items-center gap-1 p-0.5 sm:p-1 bg-[#0a0d1a]/85 backdrop-blur-md border border-[#f4f0e6]/20 rounded-full shadow-lg"
    >
      <button
        type="button"
        onClick={() => onSelect('fr')}
        className={`border-none cursor-pointer px-2.5 sm:px-3 py-1 rounded-full font-sans text-[9.5px] sm:text-[10px] font-semibold tracking-[0.14em] uppercase transition-all duration-200 ${
          currentLang === 'fr'
            ? 'bg-[#f4f0e6]/20 text-[#f4f0e6] shadow-[0_0_12px_rgba(244,240,230,0.3)]'
            : 'bg-transparent text-[#f4f0e6]/50 hover:text-[#f4f0e6]/90'
        }`}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => onSelect('en')}
        className={`border-none cursor-pointer px-2.5 sm:px-3 py-1 rounded-full font-sans text-[9.5px] sm:text-[10px] font-semibold tracking-[0.14em] uppercase transition-all duration-200 ${
          currentLang === 'en'
            ? 'bg-[#f4f0e6]/20 text-[#f4f0e6] shadow-[0_0_12px_rgba(244,240,230,0.3)]'
            : 'bg-transparent text-[#f4f0e6]/50 hover:text-[#f4f0e6]/90'
        }`}
      >
        EN
      </button>
    </div>
  );
};
