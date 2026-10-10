'use client';

import React, { useEffect, useRef, useState } from 'react';

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
}

const SWEEP = 270; // degrees
const START = -135;

export default function Knob({
  label, value, min, max, defaultValue, onChange, format,
  toNorm, fromNorm, bipolar = false, color = 'var(--ink)', hint, size = 42,
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

  // Wheel needs a non-passive listener to stop the page from scrolling
  const latest = useRef({ n, denorm, onChange });
  useEffect(() => { latest.current = { n, denorm, onChange }; });
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { n: cur, denorm: dn, onChange: oc } = latest.current;
      const step = (e.shiftKey ? 0.004 : 0.02) * Math.sign(-e.deltaY || e.deltaX);
      oc(dn(cur + step));
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
    onChange(denorm(next));
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
      onChange(denorm(next));
    }
  };

  const r = size / 2 - 3;
  const c = size / 2;
  const angle = START + n * SWEEP;
  const from = bipolar ? 0 : START;
  const arcPath = (a0: number, a1: number) => {
    const [s, e] = a0 <= a1 ? [a0, a1] : [a1, a0];
    const p0 = polar(c, c, r, s), p1 = polar(c, c, r, e);
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
  };
  const tip = polar(c, c, r - 6, angle);
  const base = polar(c, c, 3, angle);

  return (
    <div className="flex flex-col items-center gap-1 select-none" title={hint}>
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
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={onKeyDown}
        className="relative rounded-full cursor-ns-resize touch-none"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="block overflow-visible">
          <path d={arcPath(START, START + SWEEP)} fill="none" stroke="var(--rule-2)" strokeWidth={2} strokeLinecap="round" />
          {Math.abs(angle - from) > 0.5 && (
            <path d={arcPath(from, angle)} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          )}
          <circle cx={c} cy={c} r={r - 4.5} fill="var(--card)" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(31,28,23,0.18))' }} />
          <circle cx={c} cy={c} r={r - 4.5} fill="none" stroke="var(--rule)" />
          <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke="var(--ink)" strokeWidth={1.75} strokeLinecap="round" />
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
