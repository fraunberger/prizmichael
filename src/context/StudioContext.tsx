'use client';

/**
 * UI-only state shared across the studio: the visible slice of the timeline,
 * region splits and selection, the voice being drawn, and record arming.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { VoiceIndex } from '@/engine/types';
import { Voicing } from '@/engine/chords';
import { useAudio } from './AudioContext';

export interface TimeView {
  start: number;
  end: number;
}

interface StudioValue {
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

  recArmed: boolean;
  setRecArmed: (b: boolean) => void;
  heldChord: number | null; // diatonic degree currently held (live playing)
  setHeldChord: (d: number | null) => void;
}

const StudioCtx = createContext<StudioValue | null>(null);

const MIN_SPAN = 0.4;

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAudio();
  const duration = state.duration || 10;

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
  const [recArmed, setRecArmed] = useState(false);
  const [heldChord, setHeldChord] = useState<number | null>(null);

  const value: StudioValue = {
    view, setView, zoom, pan,
    splits, setSplits, region, setRegion, regionAt,
    selected, setSelected,
    activeVoice, setActiveVoice, chordVoicing, setChordVoicing,
    recArmed, setRecArmed, heldChord, setHeldChord,
  };
  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

export function useStudio(): StudioValue {
  const ctx = useContext(StudioCtx);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
}
