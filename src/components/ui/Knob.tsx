'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  /** Map value → 0–1 knob position (default linear). */
  toNorm?: (v: number) => number;
  fromNorm?: (n: number) => number;
  /** Draw the value arc from 12 o'clock (for ± controls). */
  bipolar?: boolean;
  color?: string;
  hint?: string;
  size?: number;
  /** Shows a lock toggle: locked knobs are left alone by intensity. */
  locked?: boolean;
  onToggleLock?: () => void;
}

const SWEEP = 270; // degrees
const START = -135;
const GLIDE_MS = 320;   // how long a knob takes to travel when something else turns it
const OWN_MS = 300;     // changes this soon after touching the knob are the knob's own

/**
 * A rotary control. Drag, scroll or use the arrow keys; double-click resets.
 * When something else moves it (an intensity level), it glides to the new
 * value and flashes, so you can see what changed.
 */
export default function Knob({
  label, value, min, max, defaultValue, onChange, format,
  toNorm, fromNorm, bipolar = false, color = 'var(--ink)', hint, size = 42, locked = false, onToggleLock,
}: KnobProps) {
  const norm = (v: number) => (toNorm ? toNorm(v) : (v - min) / (max - min));
  const denorm = (n: number) => {
    const c = Math.min(1, Math.max(0, n));
    return fromNorm ? fromNorm(c) : min + c * (max - min);
  };
  const n = Math.min(1, Math.max(0, norm(value)));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; n: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGPathElement>(null);
  const pointer = useRef<SVGLineElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(null);
  const own = useRef(0);
  const change = (v: number) => {
    own.current = performance.now();
    onChange(v);
  };

  const r = size / 2 - 3;
  const c = size / 2;
  const from = bipolar ? 0 : START;
  const arcPath = (a0: number, a1: number) => {
    const [s, e] = a0 <= a1 ? [a0, a1] : [a1, a0];
    const p0 = polar(c, c, r, s), p1 = polar(c, c, r, e);
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
  };
  const paint = (pos: number) => {
    const angle = START + pos * SWEEP;
    arc.current?.setAttribute('d', Math.abs(angle - from) > 0.5 ? arcPath(from, angle) : '');
    const tip = polar(c, c, r - 6, angle), base = polar(c, c, 3, angle);
    const line = pointer.current;
    if (line) {
      line.setAttribute('x1', String(base.x)); line.setAttribute('y1', String(base.y));
      line.setAttribute('x2', String(tip.x)); line.setAttribute('y2', String(tip.y));
    }
  };

  // The dial is painted here rather than in JSX, so a glide isn't undone by a re-render
  const latestPaint = useRef(paint);
  useLayoutEffect(() => { latestPaint.current = paint; });
  useLayoutEffect(() => {
    const start = shown.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (start === null || Math.abs(start - n) < 1e-4 || performance.now() - own.current < OWN_MS || reduce) {
      shown.current = n;
      latestPaint.current(n);
      return;
    }
    ring.current?.animate(
      [{ opacity: 0.95, transform: 'scale(0.86)' }, { opacity: 0, transform: 'scale(1.22)' }],
      { duration: 900, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / GLIDE_MS);
      shown.current = start + (n - start) * (1 - (1 - k) ** 3);
      latestPaint.current(shown.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  useLayoutEffect(() => { if (shown.current !== null) latestPaint.current(shown.current); }, [size, bipolar]);

  // Wheel needs a non-passive listener to stop the page from scrolling
  const latest = useRef({ n, denorm, change });
  useEffect(() => { latest.current = { n, denorm, change }; });
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { n: cur, denorm: dn, change: ch } = latest.current;
      const step = (e.shiftKey ? 0.004 : 0.02) * Math.sign(-e.deltaY || e.deltaX);
      ch(dn(cur + step));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, n };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const range = e.shiftKey ? 700 : 170;
    const next = drag.current.n + (drag.current.y - e.clientY) / range;
    change(denorm(next));
    if (e.shiftKey) drag.current = { y: e.clientY, n: Math.min(1, Math.max(0, next)) };
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = n + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = n - step;
    else if (e.key === 'PageUp') next = n + 0.2;
    else if (e.key === 'PageDown') next = n - 0.2;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next !== null) {
      e.preventDefault();
      e.stopPropagation();
      change(denorm(next));
    }
  };

  return (
    <div className="group/knob relative flex flex-col items-center gap-1 select-none" title={hint}>
      {onToggleLock && (
        <button
          onClick={onToggleLock}
          aria-pressed={locked}
          aria-label={`${locked ? 'Unlock' : 'Lock'} ${label}`}
          title={locked ? `${label} is locked: intensity leaves it alone. Click to unlock.` : `Lock ${label} so intensity leaves it alone`}
          className={`absolute -top-[5px] -right-[9px] z-10 grid place-items-center w-[17px] h-[17px] rounded-full transition-opacity ${
            locked ? 'text-ink-2 opacity-100' : 'text-ink-3 opacity-0 group-hover/knob:opacity-100 focus-visible:opacity-100 hover:text-ink'
          }`}
        >
          <Icon name={locked ? 'lock' : 'unlock'} size={11} />
        </button>
      )}
      <div
        ref={el}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={format(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => change(defaultValue)}
        onKeyDown={onKeyDown}
        className="relative rounded-full cursor-ns-resize touch-none"
        style={{ width: size, height: size }}
      >
        <div ref={ring} className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-accent" style={{ opacity: 0 }} />
        <svg width={size} height={size} className="block overflow-visible">
          <path d={arcPath(START, START + SWEEP)} fill="none" stroke="var(--rule-2)" strokeWidth={2} strokeLinecap="round" />
          <path ref={arc} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={c} cy={c} r={r - 4.5} fill="var(--card)" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(31,28,23,0.18))' }} />
          <circle cx={c} cy={c} r={r - 4.5} fill="none" stroke="var(--rule)" />
          <line ref={pointer} stroke="var(--ink)" strokeWidth={1.75} strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex flex-col items-center leading-none gap-[3px]">
        <span className="label" style={{ fontSize: 9.5 }}>{label}</span>
        <span className={`readout transition-colors ${dragging ? 'text-ink' : 'text-ink-3'}`} style={{ fontSize: 10.5 }}>
          {format(value)}
        </span>
      </div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
