'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { prepareCanvas, useElementSize } from '@/hooks/useElementSize';
import { useTimelineWheel } from '@/hooks/useTimelineWheel';
import { GUTTER, forEachTick, tickLabel, tickStep, timeToX, xToTime } from '@/lib/timeline';
import { readTokens, useTheme } from '@/lib/theme';
import PlayheadLine from './PlayheadLine';

const HEIGHT = 24;

/** Time ruler: click to seek, drag to set a loop, wheel to zoom. */
export default function Ruler() {
  const { engine, state } = useAudio();
  const { view } = useStudio();
  const theme = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrap);
  const drag = useRef<{ t0: number; x0: number } | null>(null);
  const [sweep, setSweep] = useState<[number, number] | null>(null);
  useTimelineWheel(wrap, width, true);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const ctx = prepareCanvas(c, width, HEIGHT);
    if (!ctx) return;
    const tk = readTokens();
    const { major, minor } = tickStep(view, width);

    const loop = sweep ? { start: Math.min(...sweep), end: Math.max(...sweep) } : state.loop;
    if (loop) {
      const x0 = Math.max(GUTTER, timeToX(loop.start, view, width));
      const x1 = Math.min(width, timeToX(loop.end, view, width));
      if (x1 > x0) {
        ctx.fillStyle = tk.accentSoft;
        ctx.fillRect(x0, 0, x1 - x0, HEIGHT);
        ctx.fillStyle = tk.accent;
        ctx.fillRect(x0, HEIGHT - 3, x1 - x0, 3);
      }
    }

    ctx.fillStyle = tk.ink4;
    forEachTick(view, minor, t => {
      const x = Math.round(timeToX(t, view, width));
      if (x >= GUTTER) ctx.fillRect(x, HEIGHT - 4, 1, 4);
    });
    ctx.fillStyle = tk.ink3;
    ctx.font = `10.5px ${tk.fontType}`;
    ctx.textBaseline = 'middle';
    forEachTick(view, major, t => {
      const x = Math.round(timeToX(t, view, width));
      if (x < GUTTER) return;
      ctx.fillRect(x, HEIGHT - 9, 1, 9);
      ctx.fillText(tickLabel(t, major), x + 4, 9);
    });
  }, [width, view, state.loop, sweep, theme]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.audioBuffer || e.button !== 0 || e.nativeEvent.offsetX < GUTTER) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { t0: xToTime(e.nativeEvent.offsetX, view, width), x0: e.nativeEvent.offsetX };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || Math.abs(e.nativeEvent.offsetX - d.x0) < 4) return;
    setSweep([d.t0, xToTime(e.nativeEvent.offsetX, view, width)]);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (sweep) {
      const [a, b] = sweep;
      engine.setLoop({ start: Math.max(0, Math.min(a, b)), end: Math.min(state.duration, Math.max(a, b)) });
      setSweep(null);
    } else {
      engine.seek(xToTime(e.nativeEvent.offsetX, view, width));
    }
  };

  return (
    <div ref={wrap} className="relative shrink-0 border-b border-rule bg-paper-2" style={{ height: HEIGHT }}>
      <canvas
        ref={canvas}
        className="absolute inset-0 touch-none cursor-text"
        style={{ width: '100%', height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setSweep(null); }}
        aria-label="Time ruler. Click to seek, drag to set a loop."
        title="Click to seek · drag to loop · scroll to zoom"
      />
      {state.audioBuffer && <PlayheadLine view={view} width={width} head />}
    </div>
  );
}
