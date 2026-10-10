'use client';

import React, { useEffect, useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { DEFAULT_ENGINE_STATE, TrackName } from '@/engine/types';
import Fader, { gainToDb } from './ui/Fader';
import TakesList from './TakesList';

const STRIPS: { track: TrackName; label: string; color: string; hint: string }[] = [
  { track: 'dry', label: 'Dry', color: 'var(--dry)', hint: 'The untouched recording. Blending it with Lead causes phasing, so it starts at zero.' },
  { track: 'corrected', label: 'Lead', color: 'var(--lead)', hint: 'The tuned lead vocal' },
  { track: 'harmony', label: 'Voices', color: 'linear-gradient(to top, var(--v1), var(--v2), var(--v3), var(--v4))', hint: 'All harmony voices and their doubles' },
  { track: 'bass', label: 'Bass', color: 'var(--bass)', hint: 'The lead an octave down, with a sine sub' },
];

type MeterKey = TrackName | 'master';
const KEYS: MeterKey[] = ['dry', 'corrected', 'harmony', 'bass', 'master'];
const FLOOR_DB = -54;

export default function MixerPanel() {
  const { engine, state } = useAudio();
  const { mode } = useStudio();
  const ms = state.mixerState;
  const moving = state.playing || state.auditioning !== null;
  const meterEls = useRef<Partial<Record<MeterKey, HTMLDivElement | null>>>({});
  const holdEls = useRef<Partial<Record<MeterKey, HTMLDivElement | null>>>({});
  const clipEl = useRef<HTMLDivElement>(null);

  // One animation loop drives every meter while audio is moving
  useEffect(() => {
    if (!moving) {
      for (const k of KEYS) {
        const m = meterEls.current[k], h = holdEls.current[k];
        if (m) m.style.transform = 'scaleY(0)';
        if (h) h.style.opacity = '0';
      }
      return;
    }
    const buf = new Float32Array(1024);
    const level: Record<string, number> = {};
    const hold: Record<string, { v: number; at: number }> = {};
    let clipUntil = 0;
    let raf = 0;
    const tick = (now: number) => {
      const meters = engine.getMeters();
      if (meters) {
        for (const k of KEYS) {
          meters[k].getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
          if (k === 'master' && peak > 0.985) clipUntil = now + 1500;
          const db = peak > 0 ? 20 * Math.log10(peak) : FLOOR_DB;
          const target = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
          level[k] = Math.max(target, (level[k] ?? 0) - 0.018);
          const h = hold[k];
          if (!h || target >= h.v || now - h.at > 900) hold[k] = { v: target, at: now };
          const m = meterEls.current[k], hEl = holdEls.current[k];
          if (m) m.style.transform = `scaleY(${level[k]})`;
          if (hEl) {
            hEl.style.bottom = `calc(${hold[k].v * 100}% - 2px)`;
            hEl.style.opacity = hold[k].v > 0.02 ? '1' : '0';
          }
        }
      }
      if (clipEl.current) clipEl.current.style.opacity = now < clipUntil ? '1' : '0.15';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moving, engine]);

  return (
    <aside className="flex flex-col w-[262px] shrink-0 border-l border-rule bg-paper-2">
      <div className="flex items-center justify-between px-4 h-[54px] shrink-0 border-b border-rule">
        <span className="label flex items-center gap-1.5">
          <span className="font-type text-[12px] text-ink-2 tracking-normal normal-case">⊕</span>Mix
        </span>
        {ms.solo && (
          <button className="font-type text-[11px] text-accent hover:text-ink" onClick={() => engine.setSolo(null)}>
            clear solo
          </button>
        )}
      </div>
      <div className="flex items-start justify-between px-3 pt-4 pb-3">
        {STRIPS.map(s => {
          const muted = ms.mute[s.track];
          const soloed = ms.solo === s.track;
          const silent = muted || (ms.solo !== null && !soloed);
          return (
            <div key={s.track} className="flex flex-col items-center gap-2 w-[44px]" title={s.hint}>
              <span className={`label ${silent ? 'opacity-40' : ''}`} style={{ fontSize: 9.5 }}>{s.label}</span>
              <span className="readout text-[10px]">{gainToDb(ms[s.track])}</span>
              <div className={silent ? 'opacity-45' : ''}>
                <Fader
                  label={s.label}
                  value={ms[s.track]}
                  defaultValue={DEFAULT_ENGINE_STATE.mixerState[s.track]}
                  onChange={v => engine.setMixerState({ [s.track]: v })}
                  color={s.color}
                  meterRef={el => { meterEls.current[s.track] = el; }}
                  holdRef={el => { holdEls.current[s.track] = el; }}
                />
              </div>
              <div className="flex gap-1">
                <ToggleChip on={muted} onClick={() => engine.toggleMute(s.track)} label={`Mute ${s.label}`} tone="ink">M</ToggleChip>
                <ToggleChip on={soloed} onClick={() => engine.setSolo(s.track)} label={`Solo ${s.label}`} tone="accent">S</ToggleChip>
              </div>
            </div>
          );
        })}
        <div className="w-px self-stretch bg-rule mx-0.5" />
        <div className="flex flex-col items-center gap-2 w-[30px]">
          <span className="label" style={{ fontSize: 9.5 }}>Out</span>
          <div ref={clipEl} className="w-[7px] h-[7px] rounded-full bg-accent transition-opacity" style={{ opacity: 0.15 }} title="Clip light" />
          <div className="relative w-[7px] rounded-full bg-paper-3 overflow-hidden mt-[3px]" style={{ height: 182 }}>
            <div
              ref={el => { meterEls.current.master = el; }}
              className="absolute inset-0 origin-bottom"
              style={{ transform: 'scaleY(0)', background: 'linear-gradient(to top, var(--ink-3) 0%, var(--ink-2) 72%, var(--accent) 100%)' }}
            />
            <div ref={el => { holdEls.current.master = el; }} className="absolute left-0 right-0 h-[2px] bg-ink" style={{ opacity: 0 }} />
          </div>
        </div>
      </div>
      {mode === 'live' ? <TakesList /> : <VoiceLegend />}
    </aside>
  );
}

function ToggleChip({ on, onClick, label, tone, children }: {
  on: boolean; onClick: () => void; label: string; tone: 'ink' | 'accent'; children: React.ReactNode;
}) {
  const active = tone === 'ink' ? 'bg-ink text-paper' : 'bg-accent text-white';
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`w-[20px] h-[20px] rounded-[5px] font-type text-[10px] font-bold transition-colors ${
        on ? active : 'bg-card text-ink-3 shadow-[var(--shadow-raised)] hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** What each harmony voice is doing right now, Messina-panel style. */
function VoiceLegend() {
  const { state } = useAudio();
  const counts = [0, 0, 0, 0];
  for (const n of state.midiNotes) counts[n.voice]++;
  const v = state.voicing;
  return (
    <div className="mt-auto border-t border-rule px-4 py-3 flex flex-col gap-2">
      <span className="label">Voices</span>
      <div className="grid grid-cols-4 gap-1.5">
        {['I', 'II', 'III', 'IV'].map((n, i) => (
          <div key={n} className="flex flex-col items-center gap-1 py-1.5 rounded-[7px] bg-card shadow-[var(--shadow-raised)]">
            <span className="w-2 h-2 rounded-full" style={{ background: `var(--v${i + 1})`, opacity: counts[i] ? 1 : 0.3 }} />
            <span className="font-display text-[11px] text-ink-2">{n}</span>
            <span className="font-type text-[10px] text-ink-3">{counts[i]}</span>
          </div>
        ))}
      </div>
      <p className="font-type text-[10.5px] leading-[1.45] text-ink-3">
        {v.double > 0.01 ? 'each voice double-tracked' : 'single takes'} · {Math.round(v.width * 100)}% wide · glide {Math.round(v.glide * 1000)} ms
      </p>
    </div>
  );
}
