'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { prepareCanvas, useElementSize } from '@/hooks/useElementSize';
import { useTimelineWheel } from '@/hooks/useTimelineWheel';
import { GUTTER, forEachTick, tickStep, timeToX, xToTime } from '@/lib/timeline';
import { alpha, readTokens, useTheme } from '@/lib/theme';
import { noteLabel, prefersFlats } from '@/lib/music';
import { MidiNote, NOTE_NAMES, SCALE_INTERVALS, freqToMidi, uid } from '@/engine/types';
import PlayheadLine from './PlayheadLine';

export const KEY_H = 13;
export const HIGH = 86; // D6
export const LOW = 33;  // A1
const ROWS = HIGH - LOW + 1;
const HEIGHT = ROWS * KEY_H;
const SNAP_PX = 7;
const MIN_NOTE = 0.05;
const BLACK = new Set([1, 3, 6, 8, 10]);

type Drag =
  | { kind: 'move'; anchorT: number; anchorP: number; x0: number; ids: Set<string>; base: MidiNote[]; lead: MidiNote; started: boolean; dup: boolean }
  | { kind: 'resize'; id: string; base: MidiNote[]; started: boolean }
  | { kind: 'draw'; t0: number; x0: number; pitch: number; id: string | null; base: MidiNote[] };

export default function PianoRoll() {
  const { engine, state } = useAudio();
  const studio = useStudio();
  const { view, splits, setSplits, region, setRegion, regionAt, selected, setSelected, activeVoice } = studio;
  const theme = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(content);
  const drag = useRef<Drag | null>(null);
  useTimelineWheel(scroller, width);

  const notes = state.midiNotes;
  const flats = prefersFlats(state.key, state.scale);
  const tonic = NOTE_NAMES.indexOf(state.key);
  const scalePcs = useMemo(
    () => new Set(SCALE_INTERVALS[state.scale].map(i => (tonic + i) % 12)),
    [tonic, state.scale],
  );

  // Center the singer's range when a new take is analyzed
  useEffect(() => {
    const el = scroller.current;
    const voiced = state.pitchContour.filter(f => f.freq > 0);
    if (!el || voiced.length === 0) return;
    const sorted = voiced.map(f => freqToMidi(f.freq)).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    el.scrollTop = (HIGH - median) * KEY_H - el.clientHeight / 2;
  }, [state.pitchContour]);

  // --- Drawing ---------------------------------------------------------------
  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const ctx = prepareCanvas(c, width, HEIGHT);
    if (!ctx) return;
    const tk = readTokens();
    const gridW = width - GUTTER;
    const yOf = (m: number) => (HIGH - m) * KEY_H + KEY_H / 2;

    // Rows: in-key rows are lighter, like white keys for this song
    for (let p = HIGH; p >= LOW; p--) {
      const y = (HIGH - p) * KEY_H;
      const pc = ((p % 12) + 12) % 12;
      ctx.fillStyle = scalePcs.has(pc) ? tk.rowIn : tk.rowOut;
      ctx.fillRect(GUTTER, y, gridW, KEY_H);
      if (pc === tonic) {
        ctx.fillStyle = tk.accentSoft;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(GUTTER, y, gridW, KEY_H);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pc === 0 ? tk.rule2 : tk.rule;
      ctx.fillRect(GUTTER, y + KEY_H - (pc === 0 ? 1 : 0.5), gridW, pc === 0 ? 1 : 0.5);
    }

    // Time grid
    const { major, minor } = tickStep(view, width);
    ctx.fillStyle = tk.rule;
    forEachTick(view, minor, t => ctx.fillRect(Math.round(timeToX(t, view, width)), 0, 1, HEIGHT));
    ctx.fillStyle = tk.rule2;
    forEachTick(view, major, t => ctx.fillRect(Math.round(timeToX(t, view, width)), 0, 1, HEIGHT));

    // Selected region + splits
    if (region) {
      const x0 = Math.max(GUTTER, timeToX(region[0], view, width));
      const x1 = Math.min(width, timeToX(region[1], view, width));
      if (x1 > x0) {
        ctx.fillStyle = alpha(tk.ink, 0.06);
        ctx.fillRect(x0, 0, x1 - x0, HEIGHT);
      }
    }
    ctx.strokeStyle = tk.ink3;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    for (const s of splits) {
      const x = Math.round(timeToX(s, view, width)) + 0.5;
      if (x < GUTTER || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Sung pitch (faint) and tuned pitch (ink)
    const drawContour = <F extends { time: number }>(frames: F[], hz: (f: F) => number, color: string, lw: number) => {
      if (frames.length < 2) return;
      const hop = frames[1].time - frames[0].time;
      const k0 = Math.max(0, Math.floor(view.start / hop) - 1);
      const k1 = Math.min(frames.length - 1, Math.ceil(view.end / hop) + 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (let k = k0; k <= k1; k++) {
        const f = hz(frames[k]);
        if (!(f > 0)) { pen = false; continue; }
        const x = timeToX(frames[k].time, view, width);
        const y = yOf(freqToMidi(f));
        if (pen) ctx.lineTo(x, y);
        else { ctx.moveTo(x, y); pen = true; }
      }
      ctx.stroke();
    };
    drawContour(state.pitchContour, f => f.freq, alpha(tk.ink, 0.13), 2.5);
    drawContour(state.correctedContour, f => f.targetFreq, alpha(tk.ink, 0.55), 1.25);

    // Notes: voice I on top
    ctx.font = `9.5px ${tk.fontType}`;
    ctx.textBaseline = 'middle';
    const order = [...notes].sort((a, b) => b.voice - a.voice);
    for (const n of order) {
      const x0 = timeToX(n.startTime, view, width);
      const x1 = timeToX(n.startTime + n.duration, view, width);
      if (x1 < GUTTER || x0 > width || n.pitch > HIGH || n.pitch < LOW) continue;
      const y = (HIGH - n.pitch) * KEY_H;
      const w = Math.max(3, x1 - x0);
      const color = tk.voices[n.voice];
      const isSel = selected.has(n.id);
      ctx.beginPath();
      ctx.roundRect(x0, y + 1, w, KEY_H - 2, 3);
      ctx.fillStyle = alpha(color, isSel ? 1 : 0.86);
      ctx.fill();
      if (isSel) {
        ctx.strokeStyle = tk.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (w > 34) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(x0, GUTTER), y, w, KEY_H);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(noteLabel(n.pitch, flats), Math.max(x0, GUTTER) + 4, y + KEY_H / 2 + 0.5);
        ctx.restore();
      }
    }

    // Keys
    ctx.fillStyle = tk.paper2;
    ctx.fillRect(0, 0, GUTTER, HEIGHT);
    ctx.font = `9px ${tk.fontType}`;
    for (let p = HIGH; p >= LOW; p--) {
      const y = (HIGH - p) * KEY_H;
      const pc = ((p % 12) + 12) % 12;
      const black = BLACK.has(pc);
      ctx.fillStyle = black ? tk.keyBlack : tk.keyWhite;
      ctx.fillRect(GUTTER - 30, y + 0.5, 30, KEY_H - 1);
      if (pc === tonic) {
        ctx.fillStyle = tk.accent;
        ctx.fillRect(GUTTER - 4, y + 2, 2, KEY_H - 4);
      }
      if (pc === 0 || pc === tonic) {
        ctx.fillStyle = pc === tonic ? tk.accent : tk.ink3;
        ctx.fillText(noteLabel(p, flats), 6, y + KEY_H / 2 + 0.5);
      }
    }
    ctx.fillStyle = tk.rule2;
    ctx.fillRect(GUTTER - 0.5, 0, 1, HEIGHT);
  }, [width, view, notes, selected, region, splits, scalePcs, tonic, flats, state.pitchContour, state.correctedContour, theme]);

  // --- Interaction -------------------------------------------------------------
  const local = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pitchAt = (y: number) => Math.max(LOW, Math.min(HIGH, HIGH - Math.floor(y / KEY_H)));
  const timeAt = (x: number) => Math.max(0, xToTime(x, view, width));

  const hitNote = (x: number, y: number): { note: MidiNote; edge: boolean } | null => {
    const p = pitchAt(y);
    // Topmost first: voice I is drawn last
    const order = [...notes].sort((a, b) => a.voice - b.voice);
    for (const n of order) {
      if (n.pitch !== p) continue;
      const x0 = timeToX(n.startTime, view, width);
      const x1 = Math.max(x0 + 4, timeToX(n.startTime + n.duration, view, width));
      if (x >= x0 - 1 && x <= x1 + 1) return { note: n, edge: x1 - x0 > 14 && x > x1 - 7 };
    }
    return null;
  };

  const snap = (t: number, exclude: Set<string>, bypass: boolean) => {
    if (bypass) return t;
    const cands = [0, state.duration, ...splits];
    if (region) cands.push(region[0], region[1]);
    for (const n of notes) {
      if (exclude.has(n.id)) continue;
      cands.push(n.startTime, n.startTime + n.duration);
    }
    const px = (width - GUTTER) / (view.end - view.start);
    let best = t, bestD = SNAP_PX / px;
    for (const c of cands) {
      const d = Math.abs(c - t);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.audioBuffer || e.button !== 0) return;
    const { x, y } = local(e);
    if (x < GUTTER) return;
    const t = timeAt(x);
    const hit = hitNote(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (hit) {
      let sel = new Set(selected);
      if (e.shiftKey) {
        if (sel.has(hit.note.id)) sel.delete(hit.note.id);
        else sel.add(hit.note.id);
      } else if (!sel.has(hit.note.id)) {
        sel = new Set([hit.note.id]);
      }
      setSelected(sel);
      if (!sel.has(hit.note.id)) return;
      drag.current = hit.edge
        ? { kind: 'resize', id: hit.note.id, base: notes, started: false }
        : { kind: 'move', anchorT: t, anchorP: pitchAt(y), x0: x, ids: sel, base: notes, lead: hit.note, started: false, dup: e.altKey };
      return;
    }

    if (e.shiftKey) {
      // Toggle a region split here
      const px = (width - GUTTER) / (view.end - view.start);
      const near = splits.findIndex(s => Math.abs(s - t) * px < 8);
      setSplits(near >= 0 ? splits.filter((_, i) => i !== near) : [...splits, t]);
      setRegion(null);
      return;
    }
    drag.current = { kind: 'draw', t0: snap(t, new Set(), e.altKey), x0: x, pitch: pitchAt(y), id: null, base: notes };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const d = drag.current;
    if (!d) {
      const hit = x >= GUTTER ? hitNote(x, y) : null;
      e.currentTarget.style.cursor = !hit ? (x < GUTTER ? 'default' : 'crosshair') : hit.edge ? 'ew-resize' : 'grab';
      return;
    }
    const t = timeAt(x);

    if (d.kind === 'move') {
      const dp = pitchAt(y) - d.anchorP;
      if (!d.started && Math.abs(x - d.x0) < 3 && dp === 0) return;
      if (!d.started) {
        engine.checkpoint();
        d.started = true;
        if (d.dup) d.base = [...d.base, ...d.base.filter(n => d.ids.has(n.id)).map(n => ({ ...n, id: uid() }))];
      }
      e.currentTarget.style.cursor = 'grabbing';
      const leadStart = Math.max(0, d.lead.startTime + (t - d.anchorT));
      const dt = snap(leadStart, d.ids, e.altKey) - d.lead.startTime;
      const updated = d.base.map(n =>
        d.ids.has(n.id)
          ? { ...n, startTime: Math.max(0, n.startTime + dt), pitch: Math.max(LOW, Math.min(HIGH, n.pitch + dp)) }
          : n,
      );
      engine.setMidiNotes(updated, { record: false });
    } else if (d.kind === 'resize') {
      if (!d.started) { engine.checkpoint(); d.started = true; }
      const n = d.base.find(m => m.id === d.id);
      if (!n) return;
      const end = snap(t, new Set([d.id]), e.altKey);
      const duration = Math.max(MIN_NOTE, end - n.startTime);
      engine.setMidiNotes(d.base.map(m => (m.id === d.id ? { ...m, duration } : m)), { record: false });
    } else {
      if (!d.id && Math.abs(x - d.x0) < 4) return;
      if (!d.id) {
        engine.checkpoint();
        d.id = uid();
        setSelected(new Set([d.id]));
      }
      const t1 = snap(t, new Set([d.id]), e.altKey);
      const start = Math.min(d.t0, t1);
      const duration = Math.max(MIN_NOTE, Math.abs(t1 - d.t0));
      const note: MidiNote = { id: d.id, pitch: d.pitch, startTime: start, duration, voice: activeVoice };
      engine.setMidiNotes([...d.base, note], { record: false });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw' && !d.id) {
      // A plain click on the grid selects the region under it
      const r = regionAt(d.t0);
      const same = region && region[0] === r[0] && region[1] === r[1];
      setRegion(same ? null : r);
      setSelected(new Set());
    } else if (d.kind === 'move' && !d.started && !e.shiftKey) {
      setSelected(new Set([d.lead.id]));
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = local(e);
    const hit = hitNote(x, y);
    if (!hit) return;
    engine.removeMidiNotes([hit.note.id]);
    if (selected.has(hit.note.id)) {
      const sel = new Set(selected);
      sel.delete(hit.note.id);
      setSelected(sel);
    }
  };

  return (
    <div ref={scroller} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <div ref={content} className="relative" style={{ height: HEIGHT }}>
        <canvas
          ref={canvas}
          className="absolute inset-0 touch-none"
          style={{ width: '100%', height: HEIGHT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onContextMenu={onContextMenu}
          aria-label="Harmony piano roll"
        />
        {state.audioBuffer && <PlayheadLine view={view} width={width} />}
      </div>
    </div>
  );
}
