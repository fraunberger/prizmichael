'use client';

import React from 'react';
import { useAudio } from '@/context/AudioContext';
import { NOTE_NAMES, NoteName, ScaleType, DEFAULT_FX, DEFAULT_VOICING } from '@/engine/types';
import { keyName } from '@/lib/music';
import Knob from './ui/Knob';
import Segmented from './ui/Segmented';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const RETUNE_MAX = 200;
const retuneToNorm = (ms: number) => Math.log1p(Math.max(0, ms)) / Math.log1p(RETUNE_MAX);
const normToRetune = (n: number) => Math.expm1(n * Math.log1p(RETUNE_MAX));
const GLIDE_MAX = 0.4;

export default function InstrumentPanel() {
  const { engine, state } = useAudio();
  const { voicing, fx } = state;
  const detectedDiffers =
    state.detectedKey !== null && (state.detectedKey !== state.key || state.detectedScale !== state.scale);

  return (
    <section className="flex items-stretch border-b border-rule bg-paper-2 overflow-x-auto">
      <Group glyph="∆" title="Tune" hint="Pitch correction for the lead">
        <div className="flex flex-col gap-2 justify-center">
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Key"
              value={state.key}
              onChange={e => engine.setKey(e.target.value as NoteName)}
              className="select w-[64px]"
            >
              {NOTE_NAMES.map(n => (
                <option key={n} value={n}>{keyName(n, state.scale)}</option>
              ))}
            </select>
            <Segmented<ScaleType>
              label="Scale"
              value={state.scale}
              onChange={s => engine.setScale(s)}
              options={[{ value: 'major', label: 'Major' }, { value: 'minor', label: 'Minor' }]}
            />
          </div>
          <DetectedKey
            onApply={detectedDiffers ? () => {
              engine.setKey(state.detectedKey!);
              engine.setScale(state.detectedScale!);
            } : undefined}
          />
        </div>
        <Knob
          label="Retune"
          value={state.retuneSpeed}
          min={0}
          max={RETUNE_MAX}
          defaultValue={20}
          toNorm={retuneToNorm}
          fromNorm={normToRetune}
          onChange={v => engine.setRetuneSpeed(v < 0.5 ? 0 : v)}
          format={v => (v < 0.5 ? 'hard' : `${Math.round(v)} ms`)}
          hint="How fast the lead snaps to the scale. Hard = the Prismizer robot; slower keeps vibrato and scoops."
        />
      </Group>

      <Group glyph="Σ" title="Voices" hint="How the harmony voices sing">
        <Knob
          label="Glide"
          value={voicing.glide}
          min={0}
          max={GLIDE_MAX}
          defaultValue={DEFAULT_VOICING.glide}
          toNorm={v => Math.sqrt(v / GLIDE_MAX)}
          fromNorm={n => n * n * GLIDE_MAX}
          onChange={v => engine.setVoicing({ glide: v })}
          format={v => `${Math.round(v * 1000)} ms`}
          color="var(--v1)"
          hint="Portamento when a voice moves between connected notes"
        />
        <Knob
          label="Humanize"
          value={voicing.humanize}
          min={0}
          max={1}
          defaultValue={DEFAULT_VOICING.humanize}
          onChange={v => engine.setVoicing({ humanize: v })}
          format={pct}
          color="var(--v2)"
          hint="Detune, slow drift, late entrances and a different throat per voice. The Messina's randomness."
        />
        <Knob
          label="Double"
          value={voicing.double}
          min={0}
          max={1}
          defaultValue={DEFAULT_VOICING.double}
          onChange={v => engine.setVoicing({ double: v })}
          format={v => (v < 0.01 ? 'off' : pct(v))}
          color="var(--v3)"
          hint="A second take of every voice, a few cents and milliseconds apart, panned opposite"
        />
        <Knob
          label="Width"
          value={voicing.width}
          min={0}
          max={1}
          defaultValue={DEFAULT_VOICING.width}
          onChange={v => engine.setVoicing({ width: v })}
          format={pct}
          color="var(--v4)"
          hint="Stereo spread of the voices"
        />
        <Knob
          label="Throat"
          value={voicing.throat}
          min={-4}
          max={4}
          defaultValue={0}
          bipolar
          onChange={v => engine.setVoicing({ throat: Math.round(v * 4) / 4 })}
          format={v => `${v > 0 ? '+' : ''}${v.toFixed(2).replace(/\.?0+$/, '') || '0'} st`}
          hint="Formant shift for all voices. Negative = longer throat, darker and bigger."
        />
      </Group>

      <Group glyph="∞" title="Space" hint="Mix bus: applies live and on export">
        <Knob
          label="Space"
          value={fx.space}
          min={0}
          max={1}
          defaultValue={DEFAULT_FX.space}
          onChange={v => engine.setFx({ space: v })}
          format={pct}
          color="var(--ink-2)"
          hint="A long, dark hall. Voices get the most of it, the lead the least."
        />
        <Knob
          label="Warmth"
          value={fx.warmth}
          min={0}
          max={1}
          defaultValue={DEFAULT_FX.warmth}
          onChange={v => engine.setFx({ warmth: v })}
          format={pct}
          color="var(--accent)"
          hint="Tape-style saturation, a little low-mid body and a softer top"
        />
      </Group>
    </section>
  );
}

function Group({ glyph, title, hint, children }: { glyph: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-5 pt-2.5 pb-3 border-r border-rule last:border-r-0 shrink-0" title={hint}>
      <div className="label flex items-center gap-1.5">
        <span className="font-type text-[12px] text-ink-2 tracking-normal normal-case">{glyph}</span>
        {title}
      </div>
      <div className="flex items-end gap-4">{children}</div>
    </div>
  );
}

function DetectedKey({ onApply }: { onApply?: () => void }) {
  const { state } = useAudio();
  if (!state.detectedKey || !state.detectedScale) {
    return <span className="font-type text-[11px] text-ink-4">key not yet heard</span>;
  }
  const name = `${keyName(state.detectedKey, state.detectedScale)} ${state.detectedScale}`;
  const cents = state.tuningCents;
  const tuning = cents === 0 ? 'in tune' : `${cents > 0 ? '+' : ''}${cents}¢`;
  return (
    <button
      onClick={onApply}
      disabled={!onApply}
      className={`font-type text-[11px] text-left ${onApply ? 'text-accent underline decoration-dotted underline-offset-2 hover:text-ink' : 'text-ink-3 cursor-default'}`}
      title={onApply ? 'Use the detected key' : `The singer sits ${tuning} from A440 on average`}
    >
      {onApply ? `use ${name}?` : `heard ${name} · ${tuning}`}
    </button>
  );
}
