'use client';

import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import {
  HarmonyStyle,
  autoHarmonize,
  chordNotes,
  diatonicChords,
  melodyCenter,
  shiftRegister,
  varyVoicing,
  voiceChord,
} from '@/engine/chords';
import { VoiceIndex, uid } from '@/engine/types';
import { MAX_OCTAVE } from '@/lib/chordKeys';

/** Note-editing actions shared by the toolbar and keyboard shortcuts. */
export function useHarmonyActions() {
  const { engine, state } = useAudio();
  const studio = useStudio();
  const { region, regionAt, setRegion, selected, setSelected, chordVoicing, octave, setOctave, heldChord, setHeldChord } = studio;
  const chords = diatonicChords(state.key, state.scale);

  /** Fill the selected region (or the one under the playhead) with a diatonic chord. */
  const fillChord = (degree: number) => {
    const chord = chords[degree];
    if (!chord || !state.audioBuffer) return;
    const [start, end] = region ?? regionAt(engine.getPlaybackTime());
    const keep = state.midiNotes.filter(n => !(n.startTime >= start - 1e-3 && n.startTime + n.duration <= end + 1e-3));
    const added = chordNotes(chord, start, end, state.correctedContour, chordVoicing);
    engine.setMidiNotes([...keep, ...added]);
    setRegion([start, end]);
  };

  /** Hold a chord over the playing track (the Messina way). Vary re-voices part of it on every press. */
  const liveChordDown = (degree: number) => {
    const chord = chords[degree];
    if (!chord) return;
    const t = engine.getPlaybackTime();
    const center = melodyCenter(state.correctedContour, t - 0.3, t + 1.2);
    const { vary } = engine.getState().voicing;
    const voiced = varyVoicing(voiceChord(chord.pitchClasses, center, chordVoicing), chord.pitchClasses, center, vary);
    const pitches = shiftRegister(voiced, octave, center);
    engine.startLiveChord(pitches.map((pitch, i) => ({ pitch, voice: i as VoiceIndex })));
    setHeldChord({ degree, octaves: octave });
  };

  /** Move the chord row by octaves (↑ / ↓). A chord being held jumps with it. */
  const changeOctave = (delta: number) => {
    const next = Math.max(-MAX_OCTAVE, Math.min(MAX_OCTAVE, octave + delta));
    if (next === octave) return;
    setOctave(next);
    const held = engine.getState().held;
    if (!held || !heldChord) return;
    const t = engine.getPlaybackTime();
    const center = melodyCenter(state.correctedContour, t - 0.3, t + 1.2);
    const pitches = shiftRegister(held.notes.map(n => n.pitch), next - octave, center);
    engine.startLiveChord(pitches.map((pitch, i) => ({ pitch, voice: i as VoiceIndex })));
    setHeldChord({ degree: heldChord.degree, octaves: next });
  };

  /** Hold exact pitches (from a MIDI keyboard): highest note is voice I. */
  const liveNotesDown = (pitches: number[]) => {
    const voices = [...pitches].sort((a, b) => b - a).slice(0, 4);
    engine.startLiveChord(voices.map((pitch, i) => ({ pitch, voice: i as VoiceIndex })));
  };

  /** Write exact pitches into the selected region (or the one under the playhead). */
  const fillNotes = (pitches: number[]) => {
    if (!state.audioBuffer || pitches.length === 0) return;
    const [start, end] = region ?? regionAt(engine.getPlaybackTime());
    const keep = state.midiNotes.filter(n => !(n.startTime >= start - 1e-3 && n.startTime + n.duration <= end + 1e-3));
    const voices = [...pitches].sort((a, b) => b - a).slice(0, 4);
    engine.setMidiNotes([
      ...keep,
      ...voices.map((pitch, i) => ({ id: uid(), pitch, startTime: start, duration: end - start, voice: i as VoiceIndex })),
    ]);
    setRegion([start, end]);
  };

  const liveChordUp = () => {
    engine.stopLiveChord();
    setHeldChord(null);
  };

  const harmonize = (style: HarmonyStyle) => {
    if (!state.correctedContour.length) return;
    engine.setMidiNotes(autoHarmonize(state.correctedContour, state.key, state.scale, style));
    setSelected(new Set());
  };

  const deleteSelected = () => {
    if (selected.size === 0) return;
    engine.removeMidiNotes([...selected]);
    setSelected(new Set());
  };

  const transposeSelected = (semitones: number) => {
    if (selected.size === 0) return;
    engine.setMidiNotes(state.midiNotes.map(n =>
      selected.has(n.id) ? { ...n, pitch: Math.max(24, Math.min(96, n.pitch + semitones)) } : n,
    ));
  };

  const revoiceSelected = (voice: VoiceIndex) => {
    if (selected.size === 0) return;
    engine.setMidiNotes(state.midiNotes.map(n => (selected.has(n.id) ? { ...n, voice } : n)));
  };

  const selectAll = () => setSelected(new Set(state.midiNotes.map(n => n.id)));

  return { chords, fillChord, fillNotes, liveChordDown, changeOctave, liveNotesDown, liveChordUp, harmonize, deleteSelected, transposeSelected, revoiceSelected, selectAll };
}
