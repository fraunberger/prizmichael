'use client';

import React, { useRef } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { useHarmonyActions } from '@/hooks/useHarmonyActions';
import { chordName, HARMONY_STYLES, HarmonyStyle, Voicing, VOICINGS } from '@/engine/chords';
import { importMidiFile } from '@/engine/midiImporter';
import { VoiceIndex } from '@/engine/types';
import { formatTime, pcName, prefersFlats } from '@/lib/music';
import Icon from './ui/Icon';

export const CHORD_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j'];
const NUMERALS = ['I', 'II', 'III', 'IV'];

export default function HarmonyToolbar() {
  const { engine, state } = useAudio();
  const { activeVoice, setActiveVoice, chordVoicing, setChordVoicing, heldChord, region, selected } = useStudio();
  const { chords, fillChord, harmonize, revoiceSelected } = useHarmonyActions();
  const midiInput = useRef<HTMLInputElement>(null);
  const flats = prefersFlats(state.key, state.scale);
  const ready = !!state.audioBuffer && state.status === 'ready';

  return (
    <div className="flex items-center gap-3 h-[46px] px-3 border-b border-rule bg-paper-2 overflow-x-auto shrink-0">
      {/* Voices */}
      <div role="radiogroup" aria-label="Voice to draw with" className="flex items-center gap-1">
        {NUMERALS.map((numeral, i) => {
          const on = activeVoice === i;
          return (
            <button
              key={numeral}
              role="radio"
              aria-checked={on}
              onClick={() => {
                setActiveVoice(i as VoiceIndex);
                if (selected.size) revoiceSelected(i as VoiceIndex);
              }}
              title={`Draw with voice ${numeral} (${i + 1})${selected.size ? ' · moves the selected notes to this voice' : ''}`}
              className={`flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-[8px] text-[12px] transition-colors ${
                on ? 'bg-card shadow-[var(--shadow-raised)] text-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: `var(--v${i + 1})`, opacity: on ? 1 : 0.7 }} />
              <span className="font-display tracking-[0.08em]">{numeral}</span>
            </button>
          );
        })}
      </div>

      <Divider />

      {/* Diatonic chords: the Messina is played on white keys */}
      <div className="flex items-center gap-1.5">
        <span className="label mr-0.5">Fill</span>
        {chords.map((c, i) => {
          const held = heldChord === i;
          return (
            <button
              key={c.degree}
              disabled={!ready}
              onClick={() => fillChord(i)}
              title={`${chordName(c, pc => pcName(pc, flats))}: fill ${region ? 'the selected region' : 'the region under the playhead'} (${CHORD_KEYS[i].toUpperCase()}). Hold the key while playing to sing it live.`}
              className={`flex flex-col items-center justify-center w-[40px] h-[34px] rounded-[8px] leading-none transition-colors disabled:opacity-35 ${
                held ? 'bg-ink text-paper' : 'bg-card shadow-[var(--shadow-raised)] text-ink hover:bg-paper'
              }`}
            >
              <span className="font-display text-[13px]">{c.numeral}</span>
              <span className={`font-type text-[9.5px] mt-[3px] ${held ? 'text-paper' : 'text-ink-3'}`}>
                {chordName(c, pc => pcName(pc, flats))}
              </span>
            </button>
          );
        })}
        <select
          aria-label="Chord voicing"
          value={chordVoicing}
          onChange={e => setChordVoicing(e.target.value as Voicing)}
          className="select ml-1"
          title={VOICINGS.find(v => v.id === chordVoicing)?.hint}
        >
          {VOICINGS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>

      <Divider />

      <div className="flex items-center gap-1.5">
        <select
          aria-label="Auto-harmonize"
          value=""
          disabled={!ready}
          onChange={e => {
            if (e.target.value) harmonize(e.target.value as HarmonyStyle);
          }}
          className="select"
          title="Write parallel diatonic harmonies from the melody (replaces the current notes; undo to go back)"
        >
          <option value="">✦ Auto-harmonize</option>
          {HARMONY_STYLES.map(s => <option key={s.id} value={s.id} title={s.hint}>{s.label}</option>)}
        </select>
        <input
          ref={midiInput}
          type="file"
          accept=".mid,.midi"
          className="hidden"
          onChange={async e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) engine.setMidiNotes([...state.midiNotes, ...(await importMidiFile(f))]);
          }}
        />
        <button className="btn" disabled={!ready} onClick={() => midiInput.current?.click()} title="Import a MIDI file: one track per voice, or one chord track">
          <Icon name="midi" /> MIDI
        </button>
      </div>

      <Divider />

      <div className="flex items-center gap-0.5">
        <button className="btn btn-ghost btn-icon" disabled={!state.canUndo} onClick={() => engine.undo()} title="Undo (⌘Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="btn btn-ghost btn-icon" disabled={!state.canRedo} onClick={() => engine.redo()} title="Redo (⇧⌘Z)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          disabled={state.midiNotes.length === 0}
          onClick={() => engine.setMidiNotes([])}
          title="Clear all notes"
          aria-label="Clear all notes"
        >
          <Icon name="trash" />
        </button>
      </div>

      <div className="flex-1" />
      <span className="font-type text-[11px] text-ink-3 whitespace-nowrap">
        {state.midiNotes.length} {state.midiNotes.length === 1 ? 'note' : 'notes'}
        {region ? ` · region ${formatTime(region[0], false)}–${formatTime(region[1], false)}` : ''}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-rule shrink-0" />;
}
