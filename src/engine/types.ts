// --- Musical Types ---

export type NoteName = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type ScaleType = 'major' | 'minor';

export const NOTE_NAMES: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Semitone intervals from root
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// Common chord qualities as semitone offsets from root
export const CHORD_QUALITIES: Record<string, { label: string; intervals: number[] }> = {
  major:    { label: 'Major',       intervals: [0, 4, 7] },
  minor:    { label: 'Minor',       intervals: [0, 3, 7] },
  dim:      { label: 'Diminished',  intervals: [0, 3, 6] },
  aug:      { label: 'Augmented',   intervals: [0, 4, 8] },
  maj7:     { label: 'Major 7th',   intervals: [0, 4, 7, 11] },
  min7:     { label: 'Minor 7th',   intervals: [0, 3, 7, 10] },
  dom7:     { label: 'Dominant 7th', intervals: [0, 4, 7, 10] },
};

// --- Pitch / Detection Types ---

export interface PitchFrame {
  time: number;      // seconds
  freq: number;      // Hz, 0 = unvoiced
  confidence: number; // 0–1
}

export type PitchContour = PitchFrame[];

export interface CorrectedPitchFrame {
  time: number;
  origFreq: number;
  targetFreq: number;
}

// --- MIDI Types ---

// Four harmony voices, like the Eventide H8000 program inside Bon Iver's Messina
export type VoiceIndex = 0 | 1 | 2 | 3;
export const VOICE_COUNT = 4;

export interface MidiNote {
  id: string;
  pitch: number;      // MIDI note number 0–127
  startTime: number;  // seconds
  duration: number;   // seconds
  voice: VoiceIndex;
}

// --- Voicing (how the harmony voices are sung) ---

export interface VoicingParams {
  glide: number;    // seconds of portamento between connected notes (0–0.5)
  humanize: number; // 0–1: detune, drift, staggered entrances, per-voice timbre
  double: number;   // 0–1: level of a second, double-tracked take of every voice
  width: number;    // 0–1: stereo spread
  throat: number;   // semitones of formant shift for every voice (−4…+4)
}

// --- Space (mix-bus effects, applied live and on export) ---

export interface FxParams {
  space: number;  // 0–1 reverb amount
  warmth: number; // 0–1 tape-style saturation and low-mid warmth
}

// --- Automation ---

export interface AutomationPoint {
  id: string;
  time: number;  // seconds
  value: number; // 0–1 normalized
}

// --- Mixer ---

export type TrackName = 'dry' | 'corrected' | 'harmony' | 'bass';

export interface MixerState {
  dry: number;       // 0–1
  corrected: number; // 0–1
  harmony: number;   // 0–1
  bass: number;      // 0–1
  solo: TrackName | null; // null = no solo, otherwise only that track plays
  mute: Record<TrackName, boolean>;
}

// --- Engine State ---

export type EngineStatus = 'idle' | 'loading' | 'analyzing' | 'ready' | 'error';

export interface LoopRegion {
  start: number; // seconds
  end: number;
}

export interface EngineState {
  status: EngineStatus;
  error?: string;
  fileName: string | null;
  audioBuffer: AudioBuffer | null; // the original recording (also the dry track)
  duration: number; // seconds
  // Analysis
  pitchContour: PitchContour;
  correctedContour: CorrectedPitchFrame[];
  detectedKey: NoteName | null;
  detectedScale: ScaleType | null;
  detectedKeyConfidence: number;
  tuningCents: number; // singer's average offset from A440
  // What to sing
  key: NoteName;
  scale: ScaleType;
  retuneSpeed: number; // ms, 0 = hard tune
  voicing: VoicingParams;
  fx: FxParams;
  midiNotes: MidiNote[];
  automationPoints: AutomationPoint[];
  mixerState: MixerState;
  // Rendered tracks (re-rendered in the background whenever inputs change)
  correctedBuffer: AudioBuffer | null;
  harmonyBuffer: AudioBuffer | null; // stereo
  bassBuffer: AudioBuffer | null;
  rendering: boolean;
  renderStage: string;
  lastRenderMs: number;
  // Transport
  playing: boolean;
  loop: LoopRegion | null;
  // Edit history
  canUndo: boolean;
  canRedo: boolean;
}

export const DEFAULT_VOICING: VoicingParams = {
  glide: 0.09,
  humanize: 0.45,
  double: 0.55,
  width: 0.8,
  throat: 0,
};

export const DEFAULT_FX: FxParams = { space: 0.42, warmth: 0.3 };

export const DEFAULT_ENGINE_STATE: EngineState = {
  status: 'idle',
  fileName: null,
  audioBuffer: null,
  duration: 0,
  pitchContour: [],
  correctedContour: [],
  detectedKey: null,
  detectedScale: null,
  detectedKeyConfidence: 0,
  tuningCents: 0,
  key: 'C',
  scale: 'major',
  retuneSpeed: 20,
  voicing: DEFAULT_VOICING,
  fx: DEFAULT_FX,
  midiNotes: [],
  automationPoints: [
    { id: 'start', time: 0, value: 0 },
  ],
  // Dry starts at zero: dry + tuned lead together comb-filter into phasiness
  mixerState: {
    dry: 0,
    corrected: 0.9,
    harmony: 0.85,
    bass: 0.45,
    solo: null,
    mute: { dry: false, corrected: false, harmony: false, bass: false },
  },
  correctedBuffer: null,
  harmonyBuffer: null,
  bassBuffer: null,
  rendering: false,
  renderStage: '',
  lastRenderMs: 0,
  playing: false,
  loop: null,
  canUndo: false,
  canRedo: false,
};

// --- Utility Functions ---

/** Convert MIDI note number to frequency in Hz */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Convert frequency in Hz to MIDI note number (fractional) */
export function freqToMidi(freq: number): number {
  if (freq <= 0) return 0;
  return 69 + 12 * Math.log2(freq / 440);
}

/** Get the MIDI note number for a named note at a given octave */
export function noteToMidi(note: NoteName, octave: number): number {
  return NOTE_NAMES.indexOf(note) + (octave + 1) * 12;
}

/** Get all MIDI note numbers in a given key/scale across all octaves */
export function getScaleNotes(key: NoteName, scale: ScaleType): Set<number> {
  const rootIndex = NOTE_NAMES.indexOf(key);
  const intervals = SCALE_INTERVALS[scale];
  const notes = new Set<number>();
  for (let octave = 0; octave < 10; octave++) {
    for (const interval of intervals) {
      const midi = (octave * 12) + rootIndex + interval;
      if (midi <= 127) notes.add(midi);
    }
  }
  return notes;
}

/** Snap a frequency to the nearest note in the given scale, return target freq */
export function snapToScale(freq: number, key: NoteName, scale: ScaleType): number {
  if (freq <= 0) return 0;
  const midi = freqToMidi(freq);
  const scaleNotes = getScaleNotes(key, scale);

  let nearest = 0;
  let minDist = Infinity;
  for (const note of scaleNotes) {
    const dist = Math.abs(midi - note);
    if (dist < minDist) {
      minDist = dist;
      nearest = note;
    }
  }
  return midiToFreq(nearest);
}

/** Generate a unique ID */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
