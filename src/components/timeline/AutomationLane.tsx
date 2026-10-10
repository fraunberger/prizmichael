'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { prepareCanvas, useElementSize } from '@/hooks/useElementSize';
import { useTimelineWheel } from '@/hooks/useTimelineWheel';
import { GUTTER, forEachTick, tickStep, timeToX, xToTime } from '@/lib/timeline';
import { alpha, readTokens, useTheme } from '@/lib/theme';
import { AutomationPoint, uid } from '@/engine/types';
import PlayheadLine from './PlayheadLine';

const HEIGHT = 74;
const PAD = 9;

/** Bass drive envelope: click to add, drag to shape, right-click or double-click to remove. */
export default function AutomationLane() {
  const { engine, state } = useAudio();
  const { view } = useStudio();
  const theme = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrap);
  const drag = useRef<{ id: string; started: boolean } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  useTimelineWheel(wrap, width);

  const points = state.automationPoints;
  const yOf = (v: number) => PAD + (1 - v) * (HEIGHT - 2 * PAD);
  const vOf = (y: number) => Math.max(0, Math.min(1, 1 - (y - PAD) / (HEIGHT - 2 * PAD)));

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const ctx = prepareCanvas(c, width, HEIGHT);
    if (!ctx) return;
    const tk = readTokens();
    const color = tk.bass;

    ctx.fillStyle = tk.rule;
    forEachTick(view, tickStep(view, width).major, t => ctx.fillRect(Math.round(timeToX(t, view, width)), 0, 1, HEIGHT));
    ctx.strokeStyle = tk.rule2;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(GUTTER, Math.round(yOf(0.5)) + 0.5);
    ctx.lineTo(width, Math.round(yOf(0.5)) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    const sorted = [...points].sort((a, b) => a.time - b.time);
    if (sorted.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(GUTTER, 0, width - GUTTER, HEIGHT);
      ctx.clip();
      // Hold the first/last value out to the edges, like the renderer does
      const xs = [GUTTER - 10, ...sorted.map(p => timeToX(p.time, view, width)), width + 10];
      const ys = [sorted[0].value, ...sorted.map(p => p.value), sorted[sorted.length - 1].value].map(yOf);
      ctx.beginPath();
      ctx.moveTo(xs[0], HEIGHT);
      xs.forEach((x, i) => ctx.lineTo(x, ys[i]));
      ctx.lineTo(xs[xs.length - 1], HEIGHT);
      ctx.closePath();
      ctx.fillStyle = alpha(color, 0.14);
      ctx.fill();
      ctx.beginPath();
      xs.forEach((x, i) => (i ? ctx.lineTo(x, ys[i]) : ctx.moveTo(x, ys[i])));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.stroke();
      for (const p of sorted) {
        const x = timeToX(p.time, view, width);
        ctx.beginPath();
        ctx.arc(x, yOf(p.value), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = p.id === active ? color : tk.card;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = tk.rule2;
    ctx.fillRect(GUTTER - 0.5, 0, 1, HEIGHT);
  }, [width, view, points, active, theme]);

  const hit = (x: number, y: number): AutomationPoint | null => {
    for (const p of points) {
      if (Math.hypot(timeToX(p.time, view, width) - x, yOf(p.value) - y) < 8) return p;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.audioBuffer || e.button !== 0) return;
    const x = e.nativeEvent.offsetX, y = e.nativeEvent.offsetY;
    if (x < GUTTER) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = hit(x, y);
    if (p) {
      drag.current = { id: p.id, started: false };
      setActive(p.id);
      return;
    }
    const point = { id: uid(), time: Math.max(0, xToTime(x, view, width)), value: vOf(y) };
    engine.setAutomationPoints([...points, point]);
    drag.current = { id: point.id, started: true };
    setActive(point.id);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX, y = e.nativeEvent.offsetY;
    const d = drag.current;
    if (!d) {
      e.currentTarget.style.cursor = x >= GUTTER && hit(x, y) ? 'grab' : 'crosshair';
      return;
    }
    if (!d.started) { engine.checkpoint(); d.started = true; }
    const time = Math.max(0, Math.min(state.duration, xToTime(x, view, width)));
    engine.setAutomationPoints(points.map(p => (p.id === d.id ? { ...p, time, value: vOf(y) } : p)), { record: false });
  };

  const onPointerUp = () => {
    drag.current = null;
    setActive(null);
  };

  const remove = (x: number, y: number) => {
    const p = hit(x, y);
    if (p && points.length > 1) engine.setAutomationPoints(points.filter(q => q.id !== p.id));
  };

  return (
    <div ref={wrap} className="relative shrink-0 border-t border-rule bg-paper" style={{ height: HEIGHT }}>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-center pl-3 gap-1 bg-paper-2" style={{ width: GUTTER }}>
        <span className="label flex items-center gap-1"><span className="font-type text-[12px] text-ink-2">◊</span>Drive</span>
        <span className="font-type text-[10px] text-ink-4">bass</span>
      </div>
      <canvas
        ref={canvas}
        className="absolute inset-0 touch-none"
        style={{ width: '100%', height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={e => remove(e.nativeEvent.offsetX, e.nativeEvent.offsetY)}
        onContextMenu={e => { e.preventDefault(); remove(e.nativeEvent.offsetX, e.nativeEvent.offsetY); }}
        aria-label="Bass drive automation"
        title="Bass drive: click to add a point, drag to shape, right-click to remove"
      />
      {state.audioBuffer && <PlayheadLine view={view} width={width} />}
    </div>
  );
}
