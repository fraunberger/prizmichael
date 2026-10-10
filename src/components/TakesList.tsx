'use client';

import React, { useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { usePlayhead } from '@/hooks/usePlayhead';
import { Take } from '@/engine/types';
import { formatTime } from '@/lib/music';
import Icon from './ui/Icon';

const HEAT = ['', 'var(--ink-4)', 'var(--ink-3)', 'var(--ink-2)', 'var(--accent)'];

/** Every pass you play chords over, newest first. Listen, save, or take it to Prepare. */
export default function TakesList() {
  const { state } = useAudio();
  return (
    <div className="flex flex-col min-h-0 flex-1 border-t border-rule">
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
        <span className="label">Takes</span>
        {state.takes.length > 0 && <span className="font-type text-[10.5px] text-ink-3">{state.takes.length} kept</span>}
      </div>
      {state.takes.length === 0 && !state.recording ? (
        <p className="px-4 font-type text-[10.5px] leading-[1.5] text-ink-3">
          Play chords over the track. Every pass you play is kept here, so you can listen back and save the one you like.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 px-2 pb-3 overflow-y-auto min-h-0">
          {state.recording && <RecordingRow number={state.recording.number} start={state.recording.start} />}
          {state.takes.map(t => <TakeRow key={t.id} take={t} />)}
        </ul>
      )}
    </div>
  );
}

function TakeRow({ take }: { take: Take }) {
  const { engine, state } = useAudio();
  const { setMode } = useStudio();
  const selected = state.selectedTake === take.id;
  const playing = state.auditioning === take.id;
  const ready = take.audio !== null;
  const chords = new Set(take.notes.map(n => Math.round(n.startTime * 1000))).size;

  const levels = [...new Set(take.levels.map(l => l.level))];

  return (
    <li
      onClick={() => engine.selectTake(take.id)}
      className={`group flex flex-col gap-1.5 px-2 py-2 rounded-[8px] cursor-pointer transition-colors ${
        selected ? 'bg-card shadow-[var(--shadow-raised)]' : 'hover:bg-paper-3'
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          className={`btn btn-icon shrink-0 ${playing ? 'btn-ink' : ''}`}
          style={{ width: 26, height: 26 }}
          disabled={!ready}
          onClick={e => {
            e.stopPropagation();
            if (playing) engine.stopAudition();
            else void engine.playTake(take.id);
          }}
          aria-label={playing ? `Stop take ${take.number}` : `Listen to take ${take.number}`}
          title={ready ? (playing ? 'Stop' : 'Listen back') : 'Still recording the tail…'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={13} />
        </button>
        <span className="flex-1 font-display text-[12.5px] text-ink">Take {take.number}</span>
        <button
          className="btn btn-ghost btn-icon shrink-0"
          style={{ width: 24, height: 24 }}
          disabled={!ready}
          onClick={e => { e.stopPropagation(); engine.saveTake(take.id); }}
          aria-label={`Save take ${take.number} as WAV`}
          title={take.saved ? 'Saved. Click to save again.' : 'Save as WAV'}
        >
          <Icon name={take.saved ? 'check' : 'export'} size={14} />
        </button>
        <button
          className="btn btn-ghost btn-icon shrink-0"
          style={{ width: 24, height: 24 }}
          onClick={e => {
            e.stopPropagation();
            engine.takeToNotes(take.id);
            setMode('prepare');
          }}
          aria-label={`Edit take ${take.number} in Prepare`}
          title="Edit these chords in Prepare (replaces the prepared notes; undo to go back)"
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          className="btn btn-ghost btn-icon shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          style={{ width: 24, height: 24 }}
          onClick={e => { e.stopPropagation(); engine.discardTake(take.id); }}
          aria-label={`Discard take ${take.number}`}
          title="Discard"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <span className="font-type text-[10px] text-ink-3 truncate">
        {formatTime(take.start, false)}–{formatTime(take.end, false)} · {chords} {chords === 1 ? 'chord' : 'chords'} · ✦ {levels.join('→')}
      </span>
      <SongBar take={take} duration={state.duration} />
    </li>
  );
}

/** The pass being played right now: it becomes a take when the pass ends. */
function RecordingRow({ number, start }: { number: number; start: number }) {
  const time = useRef<HTMLSpanElement>(null);
  usePlayhead(t => {
    if (time.current) time.current.textContent = `${formatTime(start, false)}–${formatTime(Math.max(start, t), false)}`;
  });
  return (
    <li className="flex flex-col gap-1.5 px-2 py-2 rounded-[8px] bg-accent-soft" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="grid place-items-center w-[26px] h-[26px] shrink-0">
          <span className="w-[9px] h-[9px] rounded-full bg-accent animate-pulse" />
        </span>
        <span className="flex-1 font-display text-[12.5px] text-ink">Take {number}</span>
        <span className="label text-accent" style={{ fontSize: 9.5 }}>recording</span>
      </div>
      <span ref={time} className="font-type text-[10px] text-ink-3">{formatTime(start, false)}</span>
    </li>
  );
}

/** Where in the song the take sits, shaded by the intensity you played it at. */
function SongBar({ take, duration }: { take: Take; duration: number }) {
  const d = duration || 1;
  const segments = take.levels.map((l, i) => {
    const end = take.levels[i + 1]?.time ?? take.end;
    return { from: Math.max(take.start, l.time), to: Math.min(take.end, end), level: l.level };
  });
  return (
    <div className="relative h-[4px] rounded-full bg-paper-3 overflow-hidden" aria-hidden="true">
      {segments.map((s, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0"
          style={{ left: `${(s.from / d) * 100}%`, width: `${(Math.max(0, s.to - s.from) / d) * 100}%`, background: HEAT[s.level] }}
        />
      ))}
    </div>
  );
}
