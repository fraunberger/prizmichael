'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { prepareCanvas, useElementSize } from '@/hooks/useElementSize';
import { useTimelineWheel } from '@/hooks/useTimelineWheel';
import { GUTTER, timeToX, xToTime } from '@/lib/timeline';
import { alpha, readTokens, useTheme } from '@/lib/theme';
import { pcName, prefersFlats } from '@/lib/music';
import { nameChord } from '@/engine/chords';

const HEIGHT = 26;

/**
 * Regions between split points, and the chord each one spells. Click to
 * select a region, double-click to split, drag a split to move it,
 * right-click a split to remove it.
 */
export default function ChordLane() {
  const { state } = useAudio();
  const { view, splits, setSplits, region, setRegion, regionAt } = useStudio();
  const theme = useTheme();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrap);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  useTimelineWheel(wrap, width);

  const duration = state.duration || 10;
  const flats = prefersFlats(state.key, state.scale);

  const regions = useMemo(() => {
    const bounds = [0, ...splits, duration];
    return bounds.slice(0, -1).map((start, i) => {
      const end = bounds[i + 1];
      const span = end - start;
      const sounding = state.midiNotes.filter(n => {
        const overlap = Math.min(end, n.startTime + n.duration) - Math.max(start, n.startTime);
        return overlap > span * 0.6;
      });
      return { start, end, name: nameChord(sounding.map(n => n.pitch), pc => pcName(pc, flats)) };
    });
  }, [splits, duration, state.midiNotes, flats]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const ctx = prepareCanvas(c, width, HEIGHT);
    if (!ctx) return;
    const tk = readTokens();
    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, 0, width - GUTTER, HEIGHT);
    ctx.clip();
    ctx.textBaseline = 'middle';
    for (const r of regions) {
      const x0 = timeToX(r.start, view, width);
      const x1 = timeToX(r.end, view, width);
      if (x1 < GUTTER || x0 > width) continue;
      const isSel = region && Math.abs(region[0] - r.start) < 1e-6 && Math.abs(region[1] - r.end) < 1e-6;
      if (isSel) {
        ctx.fillStyle = alpha(tk.ink, 0.08);
        ctx.fillRect(x0, 0, x1 - x0, HEIGHT);
        ctx.fillStyle = tk.ink;
        ctx.fillRect(x0, HEIGHT - 2, x1 - x0, 2);
      }
      if (r.name && x1 - x0 > 24) {
        ctx.font = `13px ${tk.fontDisplay}`;
        ctx.fillStyle = isSel ? tk.ink : tk.ink2;
        // Stick to the left edge when the region starts off-screen
        const lx = Math.max(x0 + 8, Math.min(GUTTER + 8, x1 - 40));
        ctx.fillText(r.name, lx, HEIGHT / 2 + 0.5);
      }
    }
    for (const s of splits) {
      const x = Math.round(timeToX(s, view, width));
      if (x < GUTTER || x > width) continue;
      ctx.fillStyle = tk.ink3;
      ctx.fillRect(x, 3, 1, HEIGHT - 6);
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x + 0.5, 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }, [width, view, regions, region, splits, theme]);

  const splitNear = (x: number) => splits.findIndex(s => Math.abs(timeToX(s, view, width) - x) < 6);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.audioBuffer || e.button !== 0) return;
    const x = e.nativeEvent.offsetX;
    if (x < GUTTER) return;
    const i = splitNear(x);
    if (e.shiftKey) {
      setSplits(i >= 0 ? splits.filter((_, j) => j !== i) : [...splits, xToTime(x, view, width)]);
      setRegion(null);
      return;
    }
    if (i >= 0) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { index: i, moved: false };
      return;
    }
    const r = regionAt(xToTime(x, view, width));
    const same = region && region[0] === r[0] && region[1] === r[1];
    setRegion(same ? null : r);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX;
    const d = drag.current;
    if (!d) {
      e.currentTarget.style.cursor = splitNear(x) >= 0 ? 'ew-resize' : 'pointer';
      return;
    }
    d.moved = true;
    const t = Math.max(0.05, Math.min(duration - 0.05, xToTime(x, view, width)));
    const next = splits.slice();
    next[d.index] = t;
    setSplits(next);
    setRegion(null);
  };
  const onPointerUp = () => { drag.current = null; };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX;
    if (x < GUTTER || splitNear(x) >= 0) return;
    setSplits([...splits, xToTime(x, view, width)]);
    setRegion(null);
  };
  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const i = splitNear(e.nativeEvent.offsetX);
    if (i >= 0) {
      setSplits(splits.filter((_, j) => j !== i));
      setRegion(null);
    }
  };

  return (
    <div ref={wrap} className="relative shrink-0 border-b border-rule bg-paper" style={{ height: HEIGHT }}>
      <div className="absolute left-0 top-0 bottom-0 flex items-center pl-3 bg-paper-2" style={{ width: GUTTER }}>
        <span className="label">Chords</span>
      </div>
      <canvas
        ref={canvas}
        className="absolute inset-0 touch-none"
        style={{ width: '100%', height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        aria-label="Chord regions"
        title="Click a region to select it · double-click or ⇧-click to split · drag a split to move it · right-click a split to remove it"
      />
    </div>
  );
}
