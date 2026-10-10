'use client';

import { useEffect, useRef } from 'react';
import { useAudio } from '@/context/AudioContext';

/**
 * Calls `onFrame(time)` every animation frame while playing (or listening to
 * a take), and once whenever
 * the engine state changes while paused (seek, stop). Use it to move DOM
 * playheads and time readouts without re-rendering React every frame.
 */
export function usePlayhead(onFrame: (time: number) => void): void {
  const { engine, state } = useAudio();
  const cb = useRef(onFrame);
  useEffect(() => { cb.current = onFrame; });

  useEffect(() => {
    if (!state.playing && !state.auditioning) {
      cb.current(engine.getPlaybackTime());
      return;
    }
    let raf = 0;
    const tick = () => {
      cb.current(engine.getPlaybackTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, state]);
}
