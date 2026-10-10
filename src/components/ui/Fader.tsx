'use client';

import React, { useEffect, useRef } from 'react';

interface FaderProps {
  label: string;
  value: number; // linear gain 0–1
  defaultValue: number;
  onChange: (v: number) => void;
  color: string;
  height?: number;
  meterRef?: React.Ref<HTMLDivElement>;
  holdRef?: React.Ref<HTMLDivElement>;
}

const PAD = 7;

export const gainToDb = (g: number) => (g <= 0.0001 ? '−∞' : (20 * Math.log10(g)).toFixed(1).replace('-', '−'));

/**
 * Vertical fader with a meter alongside. Position follows a square law
 * (half travel ≈ −12 dB) so the useful range gets most of the throw.
 */
export default function Fader({ label, value, defaultValue, onChange, color, height = 196, meterRef, holdRef }: FaderProps) {
  const track = useRef<HTMLDivElement>(null);
  const pos = Math.sqrt(Math.max(0, Math.min(1, value)));
  const fromPos = (p: number) => Math.pow(Math.max(0, Math.min(1, p)), 2);

  const latest = useRef({ pos, onChange });
  useEffect(() => { latest.current = { pos, onChange }; });
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { pos: p, onChange: oc } = latest.current;
      oc(fromPos(p - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.025)));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const setFromY = (clientY: number) => {
    const r = track.current!.getBoundingClientRect();
    onChange(fromPos(1 - (clientY - r.top - PAD) / (r.height - 2 * PAD)));
  };

  return (
    <div className="flex items-stretch gap-[5px]" style={{ height }}>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={`${label} level`}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={`${gainToDb(value)} dB`}
        className="relative w-[22px] cursor-ns-resize touch-none"
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromY(e.clientY);
        }}
        onPointerMove={e => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromY(e.clientY);
        }}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={e => {
          const step = e.shiftKey ? 0.01 : 0.04;
          if (e.key === 'ArrowUp') onChange(fromPos(pos + step));
          else if (e.key === 'ArrowDown') onChange(fromPos(pos - step));
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* Scale ticks at 0, −6, −12, −24 dB */}
        {[1, 0.5, 0.25, 0.063].map(g => (
          <div
            key={g}
            className="absolute left-0 w-[4px] h-px bg-ink-4"
            style={{ bottom: `calc(${PAD}px + (100% - ${2 * PAD}px) * ${Math.sqrt(g)})` }}
          />
        ))}
        <div className="absolute left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-paper-3" style={{ top: PAD, bottom: PAD }} />
        <div
          className="absolute left-1/2 -translate-x-1/2 w-[3px] rounded-full"
          style={{ bottom: PAD, height: `calc((100% - ${2 * PAD}px) * ${pos})`, background: color }}
        />
        <div
          className="absolute left-0 right-0 h-[12px] rounded-[4px] bg-card shadow-[var(--shadow-raised)] flex items-center justify-center"
          style={{ bottom: `calc(${PAD - 6}px + (100% - ${2 * PAD}px) * ${pos})` }}
        >
          <div className="w-[12px] h-px bg-ink-2" />
        </div>
      </div>
      <div className="relative w-[5px] rounded-full bg-paper-3 overflow-hidden" style={{ marginTop: PAD, marginBottom: PAD }}>
        <div
          ref={meterRef}
          className="absolute inset-0 origin-bottom"
          style={{ transform: 'scaleY(0)', background: 'linear-gradient(to top, var(--ink-3) 0%, var(--ink-2) 70%, var(--accent) 100%)' }}
        />
        <div ref={holdRef} className="absolute left-0 right-0 h-[2px] bg-ink" style={{ bottom: '0%', opacity: 0 }} />
      </div>
    </div>
  );
}
