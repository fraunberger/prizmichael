'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { prepareCanvas, useElementSize } from '@/hooks/useElementSize';
import { GUTTER, timeToX, xToTime } from '@/lib/timeline';
import { alpha, readTokens, useTheme } from '@/lib/theme';
import PlayheadLine from './PlayheadLine';

const HEIGHT = 54;
const BUCKETS = 1600;

/** Per-bucket peak magnitude across channels. */
function peaks(buffer: AudioBuffer | null): Float32Array | null {
  if (!buffer) return null;
  const out = new Float32Array(BUCKETS);
  const per = buffer.length / BUCKETS;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let b = 0; b < BUCKETS; b++) {
      const s0 = Math.floor(b * per), s1 = Math.min(d.length, Math.floor((b + 1) * per));
      let m = out[b];
      for (let i = s0; i < s1; i += 2) {
        const v = d[i] < 0 ? -d[i] : d[i];
        if (v > m) m = v;
      }
      out[b] = m;
    }
  }
  return out;
}

type Drag = { mode: 'pan' | 'left' | 'right'; grab: number; moved: boolean; x0: number } | null;

export default function Overview() {
  const { engine, state } = useAudio();
  const { view, setView } = useStudio();
  const theme = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrap);
  const drag = useRef<Drag>(null);

  const duration = state.duration || 10;
  const full = useMemo(() => ({ start: 0, end: duration }), [duration]);
  const lead = useMemo(() => peaks(state.correctedBuffer ?? state.audioBuffer), [state.correctedBuffer, state.audioBuffer]);
  const voices = useMemo(() => peaks(state.harmonyBuffer), [state.harmonyBuffer]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const ctx = prepareCanvas(c, width, HEIGHT);
    if (!ctx) return;
    const tk = readTokens();
    const mid = HEIGHT / 2;
    const span = width - GUTTER;

    // Normalize to the louder of the two layers
    let top = 1e-6;
    if (lead) for (const v of lead) if (v > top) top = v;
    const amp = (mid - 4) / top;

    const drawLayer = (p: Float32Array, fill: string | CanvasGradient, scale: number) => {
      ctx.beginPath();
      ctx.moveTo(GUTTER, mid);
      for (let x = 0; x < span; x++) ctx.lineTo(GUTTER + x, mid - p[Math.floor((x / span) * BUCKETS)] * amp * scale);
      for (let x = span - 1; x >= 0; x--) ctx.lineTo(GUTTER + x, mid + p[Math.floor((x / span) * BUCKETS)] * amp * scale);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    if (voices) {
      const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      g.addColorStop(0, alpha(tk.voices[3], 0.4));
      g.addColorStop(0.35, alpha(tk.voices[2], 0.4));
      g.addColorStop(0.65, alpha(tk.voices[1], 0.4));
      g.addColorStop(1, alpha(tk.voices[0], 0.4));
      drawLayer(voices, g, 1.25);
    }
    if (lead) drawLayer(lead, alpha(tk.ink, 0.62), 1);
    ctx.fillStyle = tk.rule;
    ctx.fillRect(GUTTER, mid, span, 1);

    // Loop band
    if (state.loop) {
      const x0 = timeToX(state.loop.start, full, width), x1 = timeToX(state.loop.end, full, width);
      ctx.fillStyle = tk.accentSoft;
      ctx.fillRect(x0, 0, x1 - x0, HEIGHT);
      ctx.fillStyle = tk.accent;
      ctx.fillRect(x0, 0, x1 - x0, 2);
    }

    // Dim what's outside the visible window, outline the window
    const vx0 = timeToX(view.start, full, width), vx1 = timeToX(view.end, full, width);
    if (vx0 > GUTTER + 0.5 || vx1 < width - 0.5) {
      ctx.fillStyle = alpha(tk.paper, 0.62);
      ctx.fillRect(GUTTER, 0, vx0 - GUTTER, HEIGHT);
      ctx.fillRect(vx1, 0, width - vx1, HEIGHT);
      ctx.strokeStyle = tk.ink3;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(vx0) + 0.5, 0.5, Math.max(2, vx1 - vx0 - 1), HEIGHT - 1);
      ctx.fillStyle = tk.ink3;
      for (const x of [vx0, vx1]) ctx.fillRect(Math.round(x) - 1, mid - 7, 2, 14);
    }
  }, [width, lead, voices, view, full, state.loop, theme]);

  const hit = (x: number) => {
    const vx0 = timeToX(view.start, full, width), vx1 = timeToX(view.end, full, width);
    if (Math.abs(x - vx0) < 6) return 'left';
    if (Math.abs(x - vx1) < 6) return 'right';
    if (x > vx0 && x < vx1) return 'pan';
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.audioBuffer || e.button !== 0) return;
    const x = e.nativeEvent.offsetX;
    if (x < GUTTER) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = xToTime(x, full, width);
    const mode = hit(x);
    if (mode) {
      drag.current = { mode, grab: t - view.start, moved: false, x0: x };
    } else {
      // Jump the window here and keep dragging it
      const span = view.end - view.start;
      setView({ start: t - span / 2, end: t + span / 2 });
      engine.seek(t);
      drag.current = { mode: 'pan', grab: span / 2, moved: true, x0: x };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX;
    const d = drag.current;
    if (!d) {
      const mode = hit(x);
      e.currentTarget.style.cursor = mode === 'left' || mode === 'right' ? 'ew-resize' : mode === 'pan' ? 'grab' : 'pointer';
      return;
    }
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    d.moved = true;
    const t = xToTime(x, full, width);
    const span = view.end - view.start;
    if (d.mode === 'pan') setView({ start: t - d.grab, end: t - d.grab + span });
    else if (d.mode === 'left') setView({ start: Math.min(t, view.end - 0.4), end: view.end });
    else setView({ start: view.start, end: Math.max(t, view.start + 0.4) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) engine.seek(xToTime(e.nativeEvent.offsetX, full, width));
  };

  return (
    <div ref={wrap} className="relative shrink-0 border-b border-rule bg-paper" style={{ height: HEIGHT }}>
      <div className="absolute left-0 top-0 bottom-0 flex items-center pl-3" style={{ width: GUTTER }}>
        <span className="label leading-tight">Whole<br />song</span>
      </div>
      <canvas
        ref={canvas}
        className="absolute inset-0 touch-none"
        style={{ width: '100%', height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Song overview. Click to seek, drag the window to scroll."
      />
      {state.audioBuffer && <PlayheadLine view={full} width={width} />}
    </div>
  );
}
