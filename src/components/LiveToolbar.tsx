'use client';

import React, { useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { useHarmonyActions } from '@/hooks/useHarmonyActions';
import { chordName, Voicing, VOICINGS } from '@/engine/chords';
import { pcName, prefersFlats } from '@/lib/music';
import { CHORD_KEYS, MAX_OCTAVE } from '@/lib/chordKeys';

/** Chord pads for playing the voices over the track, the Messina way. */
export default function LiveToolbar() {
  const { engine, state } = useAudio();
  const { chordVoicing, setChordVoicing, heldChord, octave } = useStudio();
  const { chords, liveChordDown, liveChordUp, changeOctave } = useHarmonyActions();
  const flats = prefersFlats(state.key, state.scale);
  const ready = !!state.audioBuffer && state.status === 'ready';
  const pressing = useRef<number | null>(null);

  // A pad pressed while stopped starts the track, then sings
  const press = async (degree: number) => {
    pressing.current = degree;
    if (!engine.getIsPlaying()) await engine.play();
    if (pressing.current === degree) liveChordDown(degree);
  };
  const release = () => {
    if (pressing.current === null) return;
    pressing.current = null;
    liveChordUp();
  };

  return (
    <div className="flex items-center gap-3 h-[58px] px-3 border-b border-rule bg-paper-2 overflow-x-auto shrink-0">
      <div className="flex items-center gap-1.5" role="group" aria-label="Chords">
        {chords.map((c, i) => {
          const held = heldChord?.degree === i;
          const shift = held ? heldChord.octaves : 0;
          const name = chordName(c, pc => pcName(pc, flats));
          return (
            <button
              key={c.degree}
              disabled={!ready}
              onPointerDown={e => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                void press(i);
              }}
              onPointerUp={release}
              onPointerCancel={release}
              onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                  e.preventDefault();
                  e.stopPropagation();
                  void press(i);
                }
              }}
              onKeyUp={e => {
                if (e.key === 'Enter' || e.key === ' ') release();
              }}
              title={`${name}: hold to sing it over the track (${CHORD_KEYS[i].toUpperCase()}; ↑ / ↓ move it by octaves)`}
              aria-pressed={held}
              className={`relative flex flex-col items-center justify-center w-[54px] h-[42px] rounded-[9px] leading-none touch-none transition-colors disabled:opacity-35 ${
                held ? 'bg-ink text-paper' : 'bg-card shadow-[var(--shadow-raised)] text-ink hover:bg-paper'
              }`}
            >
              <span className={`absolute top-[4px] right-[6px] font-type text-[8.5px] uppercase ${held ? 'text-paper' : 'text-ink-4'}`}>
                {CHORD_KEYS[i]}
              </span>
              {shift !== 0 && (
                <span className="absolute top-[3px] left-[6px] font-type text-[10px] text-accent" aria-hidden="true">
                  {(shift > 0 ? '↑' : '↓').repeat(Math.abs(shift))}
                </span>
              )}
              <span className="font-display text-[15px]">{c.numeral}</span>
              <span className={`font-type text-[10px] mt-[4px] ${held ? 'text-paper' : 'text-ink-3'}`}>{name}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label="Octave">
        <span className="label">Octave</span>
        <div className="flex items-center h-7 p-[2px] rounded-[8px] bg-paper-3">
          <button
            className="w-6 h-6 rounded-[6px] text-[14px] text-ink-2 hover:bg-card hover:text-ink disabled:opacity-30"
            onClick={() => changeOctave(-1)}
            disabled={octave <= -MAX_OCTAVE}
            aria-label="Octave down"
            title="Sing the chords an octave lower (↓)"
          >
            −
          </button>
          <span className="w-7 text-center font-type text-[11.5px] text-ink tabular-nums" aria-live="polite">
            {octave > 0 ? `+${octave}` : octave}
          </span>
          <button
            className="w-6 h-6 rounded-[6px] text-[14px] text-ink-2 hover:bg-card hover:text-ink disabled:opacity-30"
            onClick={() => changeOctave(1)}
            disabled={octave >= MAX_OCTAVE}
            aria-label="Octave up"
            title="Sing the chords an octave higher (↑)"
          >
            +
          </button>
        </div>
      </div>

      <label className="flex items-center gap-1.5">
        <span className="label">Voicing</span>
        <select
          aria-label="Chord voicing"
          value={chordVoicing}
          onChange={e => setChordVoicing(e.target.value as Voicing)}
          className="select"
          title={VOICINGS.find(v => v.id === chordVoicing)?.hint}
        >
          {VOICINGS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>

      <div className="flex-1" />
      <Status />
    </div>
  );
}

function Status() {
  const { state } = useAudio();
  if (!state.audioBuffer || state.status !== 'ready') return null;
  const take = state.takes.find(t => t.id === state.auditioning);
  const capturing = state.playing && (state.held !== null || state.passNotes.length > 0);
  let text: React.ReactNode;
  if (take) text = `listening to take ${take.number}`;
  else if (capturing) {
    text = (
      <>
        <span className="inline-block w-[7px] h-[7px] rounded-full bg-accent mr-1.5 align-[1px] animate-pulse" />
        recording this pass
      </>
    );
  } else if (state.playing) text = 'hold A–J to sing · ↑ ↓ octave · 1–4 intensity';
  else text = 'hold a chord to start · every pass you play becomes a take';
  return <span className="font-type text-[11px] text-ink-3 whitespace-nowrap" aria-live="polite">{text}</span>;
}
