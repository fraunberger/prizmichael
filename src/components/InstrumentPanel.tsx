'use client';

import React from 'react';
import { useAudio } from '@/context/AudioContext';
import { NOTE_NAMES, NoteName, ScaleType, DEFAULT_FX, DEFAULT_VOICING, INTENSITY, Intensity, KnobId } from '@/engine/types';
import { keyName } from '@/lib/music';
import Icon from './ui/Icon';
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
  // Lock toggle props for a knob intensity can turn
  const lock = (id: KnobId) => {
    const locked = state.locks.includes(id);
    return { locked, onToggleLock: () => engine.setLocked([id], !locked) };
  };
  const detectedDiffers =
    state.detectedKey !== null && (state.detectedKey !== state.key || state.detectedScale !== state.scale);

  return (
    <section className="flex items-stretch border-b border-rule bg-paper-2 overflow-x-auto">
      <Group glyph="✦" title="Intensity" hint="One move that turns the knobs it owns, from clean to falling apart (keys 1–4)">
        <IntensityPicker />
      </Group>

      <Group glyph="∆" title="Tune" hint="Pitch correction for the lead" knobs={['retune']}>
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
          {...lock('retune')}
        />
      </Group>

      <Group glyph="Σ" title="Voices" hint="How the harmony voices sing" knobs={['glide', 'humanize', 'double', 'width', 'vary', 'glitch']}>
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
          {...lock('glide')}
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
          {...lock('humanize')}
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
          {...lock('double')}
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
          {...lock('width')}
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
        <Knob
          label="Vary"
          value={voicing.vary}
          min={0}
          max={1}
          defaultValue={DEFAULT_VOICING.vary}
          onChange={v => engine.setVoicing({ vary: v })}
          format={v => (v < 0.01 ? 'off' : v > 0.99 ? 'all' : pct(v))}
          color="var(--ink-2)"
          hint="Every time you hit a chord, re-voice this share of its notes, so the same chord comes out different"
          {...lock('vary')}
        />
        <Knob
          label="Glitch"
          value={voicing.glitch}
          min={0}
          max={1}
          defaultValue={DEFAULT_VOICING.glitch}
          onChange={v => engine.setVoicing({ glitch: v })}
          format={v => (v < 0.01 ? 'off' : pct(v))}
          color="var(--accent)"
          hint="The Prismizer coming apart: octave leaps, throat flips, warble and stutters"
          {...lock('glitch')}
        />
      </Group>

      <Group glyph="∞" title="Space" hint="Mix bus: applies live and on export" knobs={['space', 'warmth']}>
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
          {...lock('space')}
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
          {...lock('warmth')}
        />
      </Group>

      <Group glyph="◊" title="Bass" hint="The lead an octave down, with a sine sub" knobs={['drive']}>
        <Knob
          label="Drive"
          value={fx.drive}
          min={0}
          max={1}
          defaultValue={DEFAULT_FX.drive}
          onChange={v => engine.setFx({ drive: v })}
          format={v => (v < 0.01 ? 'clean' : pct(v))}
          color="var(--bass)"
          hint="Fuzz on the bass: warm at first, then an octave-up rectifier and a hard clip"
          {...lock('drive')}
        />
        <Knob
          label="Gate"
          value={fx.gate}
          min={0}
          max={1}
          defaultValue={DEFAULT_FX.gate}
          onChange={v => engine.setFx({ gate: v })}
          format={v => (v < 0.01 ? 'open' : v > 0.99 ? 'chords' : `${Math.round(-36 * v)} dB`)}
          color="var(--bass)"
          hint="Live: how far the bass drops while you're not holding a chord. All the way up, it only plays with the chords."
        />
      </Group>
    </section>
  );
}

const LEVELS: Intensity[] = [1, 2, 3, 4];

function IntensityPicker() {
  const { engine, state } = useAudio();
  return (
    <div role="radiogroup" aria-label="Intensity" className="flex items-end gap-1.5 pb-[3px]">
      {LEVELS.map(level => {
        const on = state.intensity === level;
        const hot = level === 4;
        return (
          <button
            key={level}
            role="radio"
            aria-checked={on}
            onClick={() => engine.setIntensity(level)}
            title={`${INTENSITY[level].name} (${level})`}
            className={`flex flex-col items-center justify-center w-[46px] h-[50px] rounded-[9px] leading-none transition-colors ${
              on
                ? hot ? 'bg-accent text-white' : 'bg-ink text-paper'
                : 'bg-card shadow-[var(--shadow-raised)] text-ink hover:bg-paper'
            }`}
          >
            <span className="font-display text-[19px]">{level}</span>
            <span className={`font-type text-[9.5px] mt-[5px] ${on ? '' : 'text-ink-3'}`}>{INTENSITY[level].name}</span>
          </button>
        );
      })}
    </div>
  );
}

function Group({ glyph, title, hint, knobs, children }: {
  glyph: string; title: string; hint: string; knobs?: KnobId[]; children: React.ReactNode;
}) {
  return (
    <div className="group/section flex flex-col gap-2 px-5 pt-2.5 pb-3 border-r border-rule last:border-r-0 shrink-0" title={hint}>
      <div className="label flex items-center gap-1.5 h-[15px]">
        <span className="font-type text-[12px] text-ink-2 tracking-normal normal-case">{glyph}</span>
        {title}
        {knobs && <SectionLock title={title} knobs={knobs} />}
      </div>
      <div className="flex items-end gap-4">{children}</div>
    </div>
  );
}

/** Lock or unlock every knob in a section at once. */
function SectionLock({ title, knobs }: { title: string; knobs: KnobId[] }) {
  const { engine, state } = useAudio();
  const count = knobs.filter(k => state.locks.includes(k)).length;
  const all = count === knobs.length;
  return (
    <button
      onClick={() => engine.setLocked(knobs, !all)}
      aria-pressed={all}
      aria-label={`${all ? 'Unlock' : 'Lock'} the ${title} section`}
      title={all ? `${title} is locked: intensity leaves it alone. Click to unlock.` : `Lock ${title} so intensity leaves it alone`}
      className={`ml-0.5 grid place-items-center w-[17px] h-[17px] rounded-full normal-case tracking-normal transition-opacity hover:text-ink ${
        all ? 'text-ink-2 opacity-100' : count ? 'text-ink-3 opacity-70' : 'text-ink-3 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100'
      }`}
    >
      <Icon name={all ? 'lock' : 'unlock'} size={11} />
    </button>
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
