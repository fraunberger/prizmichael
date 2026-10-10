'use client';

import React, { useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { usePlayhead } from '@/hooks/usePlayhead';
import { formatTime } from '@/lib/music';
import { setTheme, useTheme } from '@/lib/theme';
import PrismMark from './ui/PrismMark';
import Icon from './ui/Icon';
import Segmented from './ui/Segmented';
import type { Mode } from '@/context/StudioContext';
import type { MidiKeyboard } from '@/hooks/useMidiKeyboard';

export const DEMO_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${encodeURIComponent('Hozier - The Humours of Whiskey (Traditional, a cappella).mp3')}`;
export const DEMO_NAME = 'Hozier — The Humours of Whiskey (a cappella)';

export default function TopBar({ midi }: { midi: MidiKeyboard }) {
  const { engine, state } = useAudio();
  const { region, view, mode, setMode } = useStudio();
  const theme = useTheme();
  const fileInput = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  usePlayhead(t => {
    if (timeRef.current) timeRef.current.textContent = formatTime(t);
  });

  const hasAudio = !!state.audioBuffer;
  const busy = state.status === 'loading' || state.status === 'analyzing';
  const running = state.playing || state.auditioning !== null;

  const toggleLoop = () => {
    if (state.loop) engine.setLoop(null);
    else {
      const r = region ?? [view.start, view.end];
      engine.setLoop({ start: r[0], end: r[1] });
    }
  };

  return (
    <header className="relative z-10 flex items-center gap-5 h-[58px] px-4 border-b border-rule bg-paper">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <PrismMark size={24} animated={busy || state.rendering} />
        <div className="flex flex-col leading-none">
          <span className="font-display text-[15px] tracking-[0.34em] text-ink">PRIZMIKER</span>
          <span className="font-type text-[10px] text-ink-3 mt-[5px] tracking-[0.02em]">harmonizer, after the messina</span>
        </div>
      </div>

      <Segmented<Mode>
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'live', label: 'Live', hint: 'Play chords over the track. Every pass is kept as a take.' },
          { value: 'prepare', label: 'Prepare', hint: 'Write and edit harmony notes, regions and the drive lane' },
        ]}
      />

      {/* Transport */}
      <div className="flex items-center gap-1.5">
        <button className="btn btn-ghost btn-icon" onClick={() => engine.stop()} disabled={!hasAudio} title="Return to start (Enter)" aria-label="Return to start">
          <Icon name="start" />
        </button>
        <button
          onClick={() => engine.togglePlay()}
          disabled={!hasAudio}
          title={running ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={running ? 'Pause' : 'Play'}
          className="w-[38px] h-[38px] rounded-full grid place-items-center bg-ink text-paper transition-transform active:scale-95 disabled:opacity-30 hover:bg-ink-2"
        >
          <Icon name={running ? 'pause' : 'play'} size={17} />
        </button>
        <button
          className={`btn btn-icon ${state.loop ? 'btn-ink' : 'btn-ghost'}`}
          onClick={toggleLoop}
          disabled={!hasAudio}
          aria-pressed={!!state.loop}
          title={state.loop ? 'Stop looping (L)' : 'Loop the selected region or the visible range (L)'}
          aria-label="Loop"
        >
          <Icon name="loop" />
        </button>
        <MidiButton midi={midi} disabled={!hasAudio} />
        <div className="ml-2 flex items-baseline gap-1.5 font-type tabular-nums">
          <span ref={timeRef} className="text-[19px] text-ink w-[76px]">0:00.00</span>
          <span className="text-[11px] text-ink-3">/ {formatTime(state.duration, false)}</span>
        </div>
      </div>

      {/* File + status */}
      <div className="flex-1 min-w-0 flex flex-col leading-tight">
        <span className="truncate text-[13px] text-ink">
          {state.fileName ?? <span className="text-ink-3">No voice loaded</span>}
        </span>
        <StatusLine />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void engine.loadAudioFile(f);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="open" /> Open
        </button>
        <button className="btn" onClick={() => void engine.loadAudioUrl(DEMO_URL, DEMO_NAME)} disabled={busy}>
          Demo
        </button>
        {mode === 'prepare' && (
          <button className="btn btn-ink" onClick={() => void engine.exportWav()} disabled={!hasAudio || busy} title="Bounce the prepared notes and the mix, with space and warmth, to WAV">
            <Icon name="export" /> Export
          </button>
        )}
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Paper theme' : 'Night theme'}
          title={theme === 'dark' ? 'Paper theme' : 'Night theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}

const MIDI_TITLES: Record<MidiKeyboard['status'], string> = {
  off: 'Play the voices from a MIDI keyboard, like the Messina',
  connecting: 'Asking for MIDI access…',
  on: 'MIDI keyboard connected',
  'no-devices': 'No MIDI keyboard found. Plug one in, then click again.',
  unsupported: "This browser can't use MIDI (try Chrome or Edge)",
  denied: 'MIDI access was blocked for this site',
};

function MidiButton({ midi, disabled }: { midi: MidiKeyboard; disabled: boolean }) {
  const on = midi.status === 'on';
  const title = on && midi.device
    ? `Playing from ${midi.device}. Hold notes while the track plays; click to disconnect.`
    : MIDI_TITLES[midi.status];
  return (
    <button
      className={`btn btn-icon ${on ? 'btn-ink' : 'btn-ghost'}`}
      onClick={on ? midi.disconnect : midi.connect}
      disabled={disabled || midi.status === 'connecting'}
      aria-pressed={on}
      aria-label="MIDI keyboard"
      title={title}
      style={midi.status === 'no-devices' || midi.status === 'denied' || midi.status === 'unsupported' ? { color: 'var(--accent)' } : undefined}
    >
      <Icon name="keys" />
    </button>
  );
}

function StatusLine() {
  const { state } = useAudio();
  let text: string;
  let tone = 'text-ink-3';
  switch (state.status) {
    case 'idle': text = 'drop a vocal anywhere, or try the demo'; break;
    case 'loading': text = 'opening…'; break;
    case 'analyzing': text = `${state.renderStage.toLowerCase() || 'listening'}…`; break;
    case 'error': text = state.error ?? 'something went wrong'; tone = 'text-accent'; break;
    default:
      text = state.rendering
        ? `${state.renderStage.toLowerCase() || 'rendering'}…`
        : state.lastRenderMs
          ? `ready · rendered in ${state.lastRenderMs} ms`
          : 'ready';
  }
  return <span className={`font-type text-[11px] truncate ${tone}`} aria-live="polite">{text}</span>;
}
