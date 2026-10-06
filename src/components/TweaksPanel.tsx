import React from 'react';
import { TweakSettings } from '../types/gallery';

interface TweaksPanelProps {
  settings: TweakSettings;
  onChange: (updated: Partial<TweakSettings>) => void;
  onClose: () => void;
}

export const TweaksPanel: React.FC<TweaksPanelProps> = ({ settings, onChange, onClose }) => {
  return (
    <div className="fixed top-6 right-6 z-30 w-72 p-4.5 pb-3.5 bg-[#0a0d1a]/95 border border-[#f4f0e6]/25 backdrop-blur-md shadow-2xl font-sans select-none">
      <header className="flex justify-between items-center mb-3.5 text-[10px] tracking-[0.3em] uppercase text-[#d6b187]">
        <span>Tweaks</span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="bg-[#f4f0e6]/[0.05] border border-[#f4f0e6]/20 text-[#f4f0e6]/60 cursor-pointer text-sm w-6 h-6 rounded-full grid place-items-center hover:bg-[#f4f0e6]/[0.15] hover:border-[#f4f0e6]/50 hover:text-[#f4f0e6] transition-all duration-200"
        >
          ×
        </button>
      </header>

      <div className="flex flex-col gap-1.5 mb-3.5">
        <label className="flex justify-between text-[10px] tracking-wider uppercase text-[#f4f0e6]/60">
          Lighting drama <span className="text-[#f4f0e6] font-mono">{settings.lightingDrama}</span>
        </label>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={settings.lightingDrama}
          onChange={e => onChange({ lightingDrama: +e.target.value })}
          className="w-full h-0.5 bg-[#f4f0e6]/25 outline-none accent-[#d6b187] cursor-pointer"
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-3.5">
        <label className="flex justify-between text-[10px] tracking-wider uppercase text-[#f4f0e6]/60">
          Walk speed <span className="text-[#f4f0e6] font-mono">{settings.walkSpeed.toFixed(1)}</span>
        </label>
        <input
          type="range"
          min="1.5"
          max="6"
          step="0.1"
          value={settings.walkSpeed}
          onChange={e => onChange({ walkSpeed: +e.target.value })}
          className="w-full h-0.5 bg-[#f4f0e6]/25 outline-none accent-[#d6b187] cursor-pointer"
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-3.5">
        <label className="flex justify-between text-[10px] tracking-wider uppercase text-[#f4f0e6]/60">
          Mouse sensitivity <span className="text-[#f4f0e6] font-mono">{settings.lookSensitivity.toFixed(4)}</span>
        </label>
        <input
          type="range"
          min="0.0008"
          max="0.005"
          step="0.0002"
          value={settings.lookSensitivity}
          onChange={e => onChange({ lookSensitivity: +e.target.value })}
          className="w-full h-0.5 bg-[#f4f0e6]/25 outline-none accent-[#d6b187] cursor-pointer"
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-3.5">
        <label className="flex justify-between text-[10px] tracking-wider uppercase text-[#f4f0e6]/60">
          Field of view <span className="text-[#f4f0e6] font-mono">{settings.fov}°</span>
        </label>
        <input
          type="range"
          min="55"
          max="95"
          step="1"
          value={settings.fov}
          onChange={e => onChange({ fov: +e.target.value })}
          className="w-full h-0.5 bg-[#f4f0e6]/25 outline-none accent-[#d6b187] cursor-pointer"
        />
      </div>

      <div className="flex flex-col gap-1.5 mb-3.5">
        <label className="flex justify-between text-[10px] tracking-wider uppercase text-[#f4f0e6]/60">
          Ambient volume <span className="text-[#f4f0e6] font-mono">{Math.round(settings.audioVolume * 100)}%</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={settings.audioVolume}
          onChange={e => onChange({ audioVolume: +e.target.value })}
          className="w-full h-0.5 bg-[#f4f0e6]/25 outline-none accent-[#d6b187] cursor-pointer"
        />
      </div>

      <div className="flex justify-between items-center mb-3.5">
        <label className="text-[10px] tracking-wider uppercase text-[#f4f0e6]/60 cursor-pointer" htmlFor="cb-narr">
          Auto-narrate on focus
        </label>
        <input
          id="cb-narr"
          type="checkbox"
          checked={settings.narration}
          onChange={e => onChange({ narration: e.target.checked })}
          className="accent-[#d6b187] cursor-pointer"
        />
      </div>

      <div className="font-sans text-[9px] text-[#f4f0e6]/60 tracking-wider uppercase text-center pt-1.5 border-t border-[#f4f0e6]/15">
        Press <kbd className="border border-[#f4f0e6]/60 px-1 py-0.5 rounded text-[#f4f0e6]">M</kbd> to toggle
      </div>
    </div>
  );
};
