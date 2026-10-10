/**
 * Harmony helpers: diatonic chords for the current key (Justin Vernon plays the
 * Messina on white keys only), voicings that wrap around the sung melody, and
 * auto-harmonization that writes parallel diatonic parts from the melody.
 */
import {
  CorrectedPitchFrame,
  MidiNote,
  NoteName,
  NOTE_NAMES,
  SCALE_INTERVALS,
  ScaleType,
  VoiceIndex,
  freqToMidi,
  uid,
} from './types';

export type ChordQuality = 'major' | 'minor' | 'dim' | 'aug';

export interface DiatonicChord {
  degree: number;      // 0–6
  numeral: string;     // I, ii, vii°…
  root: number;        // pitch class
  pitchClasses: number[];
  quality: ChordQuality;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function diatonicChords(key: NoteName, scale: ScaleType): DiatonicChord[] {
  const tonic = NOTE_NAMES.indexOf(key);
  const steps = SCALE_INTERVALS[scale];
  return steps.map((_, degree) => {
    const pcs = [0, 2, 4].map(o => {
      const idx = degree + o;
      return (tonic + steps[idx % 7] + 12 * Math.floor(idx / 7)) % 12;
    });
    const third = (pcs[1] - pcs[0] + 12) % 12;
    const fifth = (pcs[2] - pcs[0] + 12) % 12;
    const quality: ChordQuality =
      third === 4 ? (fifth === 8 ? 'aug' : 'major') : fifth === 6 ? 'dim' : 'minor';
    const roman = quality === 'major' || quality === 'aug' ? ROMAN[degree] : ROMAN[degree].toLowerCase();
    return {
      degree,
      numeral: roman + (quality === 'dim' ? '°' : quality === 'aug' ? '+' : ''),
      root: pcs[0],
      pitchClasses: pcs,
      quality,
    };
  });
}

export function chordName(chord: DiatonicChord, spell: (pc: number) => string = pc => NOTE_NAMES[pc]): string {
  const suffix = chord.quality === 'minor' ? 'm' : chord.quality === 'dim' ? '°' : chord.quality === 'aug' ? '+' : '';
  return spell(chord.root) + suffix;
}

const SHAPES: { suffix: string; intervals: number[] }[] = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '°', intervals: [0, 3, 6] },
  { suffix: '+', intervals: [0, 4, 8] },
  { suffix: 'sus2', intervals: [0, 2, 7] },
  { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: 'ø7', intervals: [0, 3, 6, 10] },
];

/** Name the chord a set of sounding pitches spells, e.g. "B♭", "Dm7", "F/A". */
export function nameChord(pitches: number[], spell: (pc: number) => string): string | null {
  if (pitches.length < 3) return null;
  const bass = Math.min(...pitches);
  const pcs = new Set(pitches.map(p => ((p % 12) + 12) % 12));
  const bassPc = ((bass % 12) + 12) % 12;
  const roots = [bassPc, ...[...pcs].filter(pc => pc !== bassPc)];
  for (const root of roots) {
    for (const shape of SHAPES) {
      const chord = new Set(shape.intervals.map(i => (root + i) % 12));
      if (chord.size === pcs.size && [...pcs].every(pc => chord.has(pc))) {
        return spell(root) + shape.suffix + (root === bassPc ? '' : `/${spell(bassPc)}`);
      }
    }
  }
  return null;
}

export type Voicing = 'choir' | 'close' | 'high' | 'low';

export const VOICINGS: { id: Voicing; label: string; hint: string }[] = [
  { id: 'choir', label: 'Choir', hint: 'the full triad wrapped around the melody, with the root underneath' },
  { id: 'close', label: 'Close', hint: 'a tight triad hugging the melody' },
  { id: 'high', label: 'High', hint: 'two voices above, one below' },
  { id: 'low', label: 'Low', hint: 'everything under the melody' },
];

// Resynthesized voices sound most natural within about an octave of the singer,
// and nothing should drop below a baritone's floor. Register shifts (the rows
// above and below the home row) may reach further.
const VOICE_FLOOR = 43;      // G2
const VOICE_CEILING = 81;    // A5
const ROOT_FLOOR = 38;       // D2, for the low root of the choir voicing
const REGISTER_FLOOR = 36;   // C2
const REGISTER_CEILING = 88; // E6
const MAX_REACH = 12;        // semitones from the melody

const ABOVE_TARGET: Record<Voicing, number> = { choir: 1, close: 1, high: 2, low: 0 };

/**
 * Place chord tones around a melody pitch. Every candidate voicing spells the
 * whole triad by itself (no hollow fifths), stays out of the melody's way, and
 * is scored for closeness to the singer, compactness, and how many voices sit
 * above the melody. Voice I is the top line. "Choir" adds the root underneath.
 */
export function voiceChord(pitchClasses: number[], melody: number, voicing: Voicing): number[] {
  const m = Math.round(melody);
  const pcOf = (n: number) => ((n % 12) + 12) % 12;
  const needed = new Set(pitchClasses.slice(0, 3));

  const search = (reach: number): number[] => {
    const tones: number[] = [];
    for (let n = Math.max(VOICE_FLOOR, m - reach); n <= Math.min(VOICE_CEILING, m + reach); n++) {
      if (Math.abs(n - m) >= 2 && pitchClasses.includes(pcOf(n))) tones.push(n);
    }
    let best: number[] = [];
    let bestCost = Infinity;
    for (let a = 0; a < tones.length; a++) {
      for (let b = a + 1; b < tones.length; b++) {
        for (let c = b + 1; c < tones.length; c++) {
          const set = [tones[a], tones[b], tones[c]];
          const pcs = new Set(set.map(pcOf));
          if (![...needed].every(pc => pcs.has(pc))) continue;
          const above = set.filter(n => n > m).length;
          const span = set[2] - set[0];
          const distance = set.reduce((s, n) => s + Math.abs(n - m), 0);
          const cost =
            distance * 0.15 +
            span * (voicing === 'close' ? 0.35 : 0.12) +
            Math.abs(above - ABOVE_TARGET[voicing]) * 3;
          if (cost < bestCost) { bestCost = cost; best = set; }
        }
      }
    }
    return best;
  };

  // Reach further from the melody only when the chord can't be spelled nearby
  let best: number[] = [];
  for (const reach of [MAX_REACH, MAX_REACH + 5, 24]) {
    best = search(reach);
    if (best.length) break;
  }
  const upper = best.sort((p, q) => q - p);

  if (voicing === 'choir' && upper.length) {
    // The root sits under everything, including the melody
    const floor = Math.min(upper[upper.length - 1], m);
    for (let n = floor - 3; n >= Math.max(ROOT_FLOOR, m - 19); n--) {
      if (pcOf(n) === pitchClasses[0]) return [...upper, n];
    }
  }
  return upper;
}

/**
 * Re-voice a share of a chord's notes, so a chord hit again sounds different
 * (the higher the intensity, the more of it moves). A moved note jumps an
 * octave or slides to a neighbouring chord tone; with everything moving, the
 * whole chord is redrawn somewhere around the melody. The chord stays fully
 * spelled, out of the melody's way, and sorted so voice I is the top line.
 */
export function varyVoicing(
  pitches: number[],
  pitchClasses: number[],
  melody: number,
  amount: number,
  rand: () => number = Math.random,
): number[] {
  const n = pitches.length;
  const moves = Math.min(n, Math.round(amount * n));
  if (moves === 0 || n === 0) return pitches;
  const m = Math.round(melody);
  const pcOf = (p: number) => ((p % 12) + 12) % 12;
  const fits = (p: number) => p >= VOICE_FLOOR && p <= VOICE_CEILING && Math.abs(p - m) >= 2 && pitchClasses.includes(pcOf(p));
  const spelled = (set: number[]) => set.length < 3 || pitchClasses.slice(0, 3).every(pc => set.some(p => pcOf(p) === pc));
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

  if (moves >= n) {
    // Redraw the whole chord, from close to wide, keeping as few of the old notes as possible
    const reach = 9 + Math.floor(rand() * 10);
    const pool: number[] = [];
    for (let p = m - reach; p <= m + reach; p++) if (fits(p)) pool.push(p);
    let best = pitches, bestKept = n;
    for (let tries = 0; tries < 80 && pool.length >= n && bestKept > 0; tries++) {
      const set = new Set<number>();
      while (set.size < n) set.add(pick(pool));
      const out = [...set];
      const kept = out.filter(p => pitches.includes(p)).length;
      if (spelled(out) && kept < bestKept) { best = out; bestKept = kept; }
    }
    return [...best].sort((a, b) => b - a);
  }

  const out = [...pitches];
  const order = out.map((_, i) => i).sort(() => rand() - 0.5).slice(0, moves);
  for (const i of order) {
    const p = out[i];
    const tones: number[] = [];
    for (let q = p - 12; q <= p + 12; q++) if (q !== p && fits(q)) tones.push(q);
    // Octave jumps keep the chord as it is; neighbouring tones change its shape
    const candidates = [p + 12, p - 12, ...tones.filter(q => Math.abs(q - p) <= 7)]
      .filter(q => fits(q) && !out.includes(q))
      .filter(q => spelled(out.map((x, j) => (j === i ? q : x))));
    if (candidates.length) out[i] = pick(candidates);
  }
  return out.sort((a, b) => b - a);
}

/**
 * Move a voiced chord up or down by octaves. A note that would land on the
 * melody moves a further octave away, notes past the range fold back, and a
 * note that would double another is moved apart (or dropped).
 */
export function shiftRegister(pitches: number[], octaves: number, melody: number): number[] {
  if (octaves === 0) return pitches;
  const m = Math.round(melody);
  const dir = Math.sign(octaves);
  const out: number[] = [];
  for (const p0 of pitches) {
    let p = p0 + 12 * octaves;
    if (Math.abs(p - m) < 2) p += 12 * dir;
    while (p > REGISTER_CEILING) p -= 12;
    while (p < REGISTER_FLOOR) p += 12;
    for (const q of [p, p + 12 * dir, p - 12 * dir]) {
      if (q >= REGISTER_FLOOR && q <= REGISTER_CEILING && Math.abs(q - m) >= 2 && !out.includes(q)) {
        out.push(q);
        break;
      }
    }
  }
  return out.sort((a, b) => b - a);
}

/** Median of the corrected melody over a time range, in MIDI. */
export function melodyCenter(contour: CorrectedPitchFrame[], start: number, end: number, fallback = 57): number {
  const vals: number[] = [];
  for (const f of contour) {
    if (f.time >= start && f.time < end && f.targetFreq > 0) vals.push(freqToMidi(f.targetFreq));
  }
  if (vals.length === 0) return fallback;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

export function chordNotes(
  chord: DiatonicChord,
  start: number,
  end: number,
  contour: CorrectedPitchFrame[],
  voicing: Voicing,
  octaves = 0,
): MidiNote[] {
  const center = melodyCenter(contour, start, end);
  return shiftRegister(voiceChord(chord.pitchClasses, center, voicing), octaves, center).map((pitch, i) => ({
    id: uid(),
    pitch,
    startTime: start,
    duration: end - start,
    voice: i as VoiceIndex,
  }));
}

// --- Auto-harmonize -------------------------------------------------------

export type HarmonyStyle = 'thirds' | 'triad' | 'choir';

// Scale steps from the melody, highest voice first (voice I is the top line)
export const HARMONY_STYLES: { id: HarmonyStyle; label: string; hint: string; steps: number[] }[] = [
  { id: 'thirds', label: '3rds above', hint: 'one voice a diatonic third above the melody', steps: [2] },
  { id: 'triad', label: 'Triad', hint: 'a third above and a fourth below: the melody sits inside a triad', steps: [2, -3] },
  { id: 'choir', label: 'Choir', hint: 'a third and fifth above, a fourth below', steps: [4, 2, -3] },
];

/** Move a MIDI note by a number of scale steps (diatonic transposition). */
export function scaleStep(note: number, steps: number, key: NoteName, scale: ScaleType): number {
  const tonic = NOTE_NAMES.indexOf(key);
  const iv = SCALE_INTERVALS[scale];
  const rel = note - tonic;
  const octave = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  // Nearest scale degree (out-of-scale notes snap down)
  let degree = 0;
  for (let i = 0; i < iv.length; i++) if (iv[i] <= pc) degree = i;
  const total = octave * 7 + degree + steps;
  const o = Math.floor(total / 7);
  const d = ((total % 7) + 7) % 7;
  return tonic + o * 12 + iv[d];
}

/**
 * Split the corrected melody into notes, then write parallel diatonic parts.
 * Short wobbles are absorbed so the harmonies don't twitch.
 */
export function autoHarmonize(
  contour: CorrectedPitchFrame[],
  key: NoteName,
  scale: ScaleType,
  style: HarmonyStyle,
): MidiNote[] {
  const steps = HARMONY_STYLES.find(s => s.id === style)?.steps ?? [2];
  const segments = segmentMelody(contour);
  const notes: MidiNote[] = [];
  steps.forEach((step, voice) => {
    let last: MidiNote | null = null;
    for (const seg of segments) {
      let pitch = scaleStep(seg.pitch, step, key, scale);
      while (pitch < VOICE_FLOOR) pitch += 12;
      while (pitch > VOICE_CEILING) pitch -= 12;
      const gap = last ? seg.start - (last.startTime + last.duration) : Infinity;
      if (last && last.pitch === pitch && gap < 0.2) {
        last.duration = seg.end - last.startTime;
        continue;
      }
      // Bridge short breaths so the part sings legato instead of stuttering
      if (last && gap > 0 && gap < 0.15) last.duration += gap;
      last = { id: uid(), pitch, startTime: seg.start, duration: seg.end - seg.start, voice: voice as VoiceIndex };
      notes.push(last);
    }
  });
  return notes;
}

interface Segment { pitch: number; start: number; end: number }

function segmentMelody(contour: CorrectedPitchFrame[]): Segment[] {
  const MIN_NOTE = 0.14;
  const raw: Segment[] = [];
  let cur: Segment | null = null;
  for (let i = 0; i < contour.length; i++) {
    const f = contour[i];
    const next = contour[i + 1]?.time ?? f.time + 0.005;
    if (f.targetFreq <= 0) { cur = null; continue; }
    const p = Math.round(freqToMidi(f.targetFreq));
    if (cur && cur.pitch === p && f.time - cur.end < 0.03) {
      cur.end = next;
    } else {
      cur = { pitch: p, start: f.time, end: next };
      raw.push(cur);
    }
  }
  // Absorb short notes into their longer neighbour
  const out: Segment[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (s.end - s.start < MIN_NOTE) {
      if (prev && s.start - prev.end < 0.03) prev.end = s.end;
      continue;
    }
    if (prev && prev.pitch === s.pitch && s.start - prev.end < 0.05) prev.end = s.end;
    else out.push({ ...s });
  }
  return out;
}
