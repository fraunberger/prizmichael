'use client';

/**
 * UI-only state shared across the studio: live or prepare mode, the visible
 * slice of the timeline, region splits and selection, and the voice being drawn.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { VoiceIndex } from '@/engine/types';
import { Voicing } from '@/engine/chords';
import { useAudio } from './AudioContext';

export interface TimeView {
  start: number;
  end: number;
}

/** Live: play chords over the track, every pass kept as a take. Prepare: write notes. */
export type Mode = 'live' | 'prepare';

interface StudioValue {
  mode: Mode;
  setMode: (m: Mode) => void;

  view: TimeView;
  setView: (v: TimeView) => void;
  zoom: (factor: number, anchor: number) => void;
  pan: (seconds: number) => void;

  splits: number[];
  setSplits: (s: number[]) => void;
  region: [number, number] | null;
  setRegion: (r: [number, number] | null) => void;
  regionAt: (t: number) => [number, number];

  selected: ReadonlySet<string>;
  setSelected: (s: ReadonlySet<string>) => void;

  activeVoice: VoiceIndex;
  setActiveVoice: (v: VoiceIndex) => void;
  chordVoicing: Voicing;
  setChordVoicing: (v: Voicing) => void;

  octave: number;            // register of the chord row in live mode (−2…+2, ↑ / ↓)
  setOctave: (o: number) => void;
  heldChord: { degree: number; octaves: number } | null; // chord held right now (live playing)
  setHeldChord: (c: { degree: number; octaves: number } | null) => void;
}

const StudioCtx = createContext<StudioValue | null>(null);

const MIN_SPAN = 0.4;

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const { engine, state } = useAudio();
  const duration = state.duration || 10;

  const [mode, setMode] = useState<Mode>('live');
  useEffect(() => { engine.setCapture(mode === 'live'); }, [engine, mode]);

  // The view remembers which file it belongs to; a new file resets it to "fit"
  const [raw, setRaw] = useState<TimeView & { for: number }>({ start: 0, end: 10, for: -1 });
  const view = useMemo<TimeView>(
    () => (raw.for === duration ? { start: raw.start, end: raw.end } : { start: 0, end: duration }),
    [raw, duration],
  );

  const setView = useCallback((v: TimeView) => {
    const span = Math.min(duration, Math.max(MIN_SPAN, v.end - v.start));
    const start = Math.min(Math.max(0, v.start), duration - span);
    setRaw({ start, end: start + span, for: duration });
  }, [duration]);

  const zoom = useCallback((factor: number, anchor: number) => {
    const span = view.end - view.start;
    const next = Math.min(duration, Math.max(MIN_SPAN, span * factor));
    const start = anchor - (anchor - view.start) * (next / span);
    setView({ start, end: start + next });
  }, [view, duration, setView]);

  const pan = useCallback((seconds: number) => {
    setView({ start: view.start + seconds, end: view.end + seconds });
  }, [view, setView]);

  const [splitState, setSplitState] = useState<{ splits: number[]; for: number }>({ splits: [], for: -1 });
  const splits = useMemo(() => (splitState.for === duration ? splitState.splits : []), [splitState, duration]);
  const setSplits = useCallback(
    (s: number[]) => setSplitState({ splits: [...s].sort((a, b) => a - b), for: duration }),
    [duration],
  );
  const [regionState, setRegionState] = useState<{ r: [number, number] | null; for: number }>({ r: null, for: -1 });
  const region = regionState.for === duration ? regionState.r : null;
  const setRegion = useCallback((r: [number, number] | null) => setRegionState({ r, for: duration }), [duration]);
  const regionAt = useCallback((t: number): [number, number] => {
    const bounds = [0, ...splits, duration];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (t >= bounds[i] && t < bounds[i + 1]) return [bounds[i], bounds[i + 1]];
    }
    return [bounds[bounds.length - 2], duration];
  }, [splits, duration]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [activeVoice, setActiveVoice] = useState<VoiceIndex>(0);
  const [chordVoicing, setChordVoicing] = useState<Voicing>('choir');
  const [octave, setOctave] = useState(0);
  const [heldChord, setHeldChord] = useState<{ degree: number; octaves: number } | null>(null);

  const value: StudioValue = {
    mode, setMode,
    view, setView, zoom, pan,
    splits, setSplits, region, setRegion, regionAt,
    selected, setSelected,
    activeVoice, setActiveVoice, chordVoicing, setChordVoicing,
    octave, setOctave, heldChord, setHeldChord,
  };
  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

export function useStudio(): StudioValue {
  const ctx = useContext(StudioCtx);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
}
