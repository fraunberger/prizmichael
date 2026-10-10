/**
 * Messina-style harmony voices.
 *
 * Every voice is pitch-locked to its MIDI notes (not shifted in parallel with
 * the melody), so a held chord stays a held chord while the lead moves, the
 * way Bon Iver's Messina rig and the Prismizer work. On top of that:
 *  - glide: portamento between connected notes (the Harmony Engine "glide")
 *  - throat: formants follow part of the pitch shift, so high voices get a
 *    shorter throat and low voices a longer one, like different singers
 *  - humanize: per-voice detune, slow pitch drift, staggered entrances and a
 *    distinct timbre per voice (the Messina's deliberate randomization)
 *  - double: a second, independently humanized take of every voice, delayed
 *    and panned opposite. This is most of the "creamy" width.
 *  - glitch: leaps, formant flips, warble and stutters (see glitch.ts)
 */
import { MidiNote, VOICE_COUNT, VoicingParams } from '../types';
import { PitchTrack } from './pitch';
import { PitchMarks } from './marks';
import { psola, voicingMask, gainAt, SampleRange } from './psola';
import { rng, smoothingCoeff } from './filters';
import { Glitch, makeGlitch } from './glitch';

// Outer voices go wide, inner voices half-way; each double mirrors its voice
const VOICE_PAN = [-0.95, 0.95, -0.55, 0.55];
const VOICE_DETUNE = [4, -5, 6, -3];             // cents at full humanize
const VOICE_CHARACTER = [0.35, -0.45, 0.6, -0.3]; // formant semitones at full humanize
const LEGATO_GAP = 0.08;   // notes closer than this glide instead of re-attacking
const ATTACK = 0.018;
const RELEASE = 0.09;
const AUTO_THROAT = 0.22;  // fraction of the pitch shift the formants follow
const MAX_AUTO_THROAT = 4;
const MAX_FORMANT = 9;     // semitones, all sources combined
const PITCH_CEILING = 86;  // glitch leaps fold back an octave past these (D6, G1)
const PITCH_FLOOR = 31;

interface Placed { pitch: number; start: number; end: number }

export function renderHarmony(
  x: Float32Array,
  sampleRate: number,
  track: PitchTrack,
  marks: PitchMarks,
  notes: MidiNote[],
  params: VoicingParams,
  range: SampleRange = { start: 0, end: x.length },
): [Float32Array, Float32Array] {
  const len = range.end - range.start;
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const { hop } = track;
  const frames = track.f0.length;
  const spf = hop * sampleRate;
  const vmask = voicingMask(marks, frames, hop, sampleRate);

  const byVoice: MidiNote[][] = Array.from({ length: VOICE_COUNT }, () => []);
  for (const n of notes) byVoice[n.voice]?.push(n);
  const active = byVoice.filter(v => v.length > 0).length;
  if (active === 0) return [left, right];
  const norm = 1 / Math.sqrt(active);
  const h = clamp(params.humanize, 0, 1);

  for (let v = 0; v < VOICE_COUNT; v++) {
    if (byVoice[v].length === 0) continue;
    const takes = params.double > 0.01 ? 2 : 1;

    for (let take = 0; take < takes; take++) {
      const rand = rng(1013 * (v + 1) + 7919 * take);
      const isDouble = take === 1;
      const detune = isDouble
        ? -Math.sign(VOICE_DETUNE[v]) * (6 + 6 * h)
        : VOICE_DETUNE[v] * h;
      const character = VOICE_CHARACTER[v] * h + (isDouble ? (rand() - 0.5) * 0.8 : 0);
      const driftAmt = 3.5 * h + (isDouble ? 2 : 0);
      const df1 = 0.13 + rand() * 0.18, df2 = 0.37 + rand() * 0.34;
      const dp1 = rand() * Math.PI * 2, dp2 = rand() * Math.PI * 2;
      const drift = (t: number) => driftAmt * (0.6 * Math.sin(2 * Math.PI * df1 * t + dp1) + 0.4 * Math.sin(2 * Math.PI * df2 * t + dp2));

      const placed = placeNotes(byVoice[v], () => rand() * 0.022 * h + (isDouble ? rand() * 0.01 : 0));
      const glitch = makeGlitch(params.glitch, 7919 * (v + 1) + 104729 * take);
      const { hz, gain, formant } = buildCurves(placed, track, vmask, params, detune, character, drift, glitch);

      const g = norm * (isDouble ? params.double * 0.85 : 1);
      const pan = clamp(VOICE_PAN[v] * params.width * (isDouble ? -0.9 : 1), -1, 1);
      const theta = (pan + 1) * Math.PI / 4;
      const gl = g * Math.cos(theta), gr = g * Math.sin(theta);
      // The double sits a few ms late, like a second pass at the mic (ADT)
      const delay = isDouble ? Math.round((0.011 + 0.006 * rand()) * sampleRate) : 0;
      // Stutters repeat audio from earlier in their slot, so render a little before the window
      const pre = glitch ? Math.min(range.start, Math.ceil(glitch.preroll * sampleRate)) : 0;
      const from = range.start - pre; // output sample at sig[0]
      const src = { start: Math.max(0, from - delay), end: Math.max(0, range.end - delay) };
      if (src.end <= src.start) continue;
      const y = psola(x, sampleRate, marks, { hop, hz, formant }, src);

      const sig = new Float32Array(len + pre);
      for (let j = 0; j < y.length; j++) {
        if (y[j] === 0) continue;
        const i = src.start + j;      // source sample
        const o = i + delay - from;   // output index
        if (o < 0 || o >= sig.length) continue;
        sig[o] = y[j] * gainAt(gain, i, spf);
      }
      glitch?.apply(sig, from, sampleRate);
      for (let o = 0; o < len; o++) {
        const s = sig[o + pre];
        if (s === 0) continue;
        left[o] += s * gl;
        right[o] += s * gr;
      }
    }
  }
  return [left, right];
}

/** Sort, humanize timing, and stretch near-touching notes into legato phrases. */
function placeNotes(notes: MidiNote[], offset: () => number): Placed[] {
  const placed = notes
    .map(n => {
      const o = offset();
      return { pitch: n.pitch, start: n.startTime + o, end: n.startTime + n.duration + o };
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < placed.length; i++) {
    const gap = placed[i + 1].start - placed[i].end;
    if (gap > 0 && gap < LEGATO_GAP) placed[i].end = placed[i + 1].start;
  }
  return placed;
}

function buildCurves(
  notes: Placed[],
  track: PitchTrack,
  vmask: Float32Array,
  params: VoicingParams,
  detuneCents: number,
  character: number,
  drift: (t: number) => number,
  glitch: Glitch | null,
) {
  const { hop } = track;
  const frames = track.f0.length;
  const hz = new Float32Array(frames);
  const gain = new Float32Array(frames);
  const formant = new Float32Array(frames);

  const glideK = 1 - smoothingCoeff(Math.max(params.glide, 0.006) / 3, hop);
  const attackK = 1 - smoothingCoeff(ATTACK, hop);
  const releaseK = 1 - smoothingCoeff(RELEASE, hop);
  const formantK = 1 - smoothingCoeff(0.12, hop);

  let next = 0;
  let current = -1;
  let pitch = NaN;
  let env = 0;
  let form = NaN;
  let source = NaN;

  for (let k = 0; k < frames; k++) {
    const t = k * hop;
    while (next < notes.length && notes[next].start <= t) next++;
    let note = -1;
    for (let j = next - 1; j >= Math.max(0, next - 8); j--) {
      if (t < notes[j].end) { note = j; break; }
    }

    if (note >= 0) {
      const target = notes[note].pitch + (detuneCents + drift(t)) / 100;
      if (note !== current) {
        if (isNaN(pitch) || env < 0.05) pitch = target; // from silence: no scoop
        current = note;
      }
      pitch += (target - pitch) * glideK;
      env += (1 - env) * attackK;
    } else {
      env += (0 - env) * releaseK;
      if (env < 1e-3) current = -1;
    }

    // Glitch leaps snap rather than glide, and fold back inside a singable range
    let sung = pitch;
    if (glitch && !isNaN(pitch)) {
      sung = pitch + glitch.pitch(t);
      while (sung > PITCH_CEILING) sung -= 12;
      while (sung < PITCH_FLOOR) sung += 12;
    }

    if (track.f0[k] > 0) source = 69 + 12 * Math.log2(track.f0[k] / 440);
    const shift = isNaN(source) || isNaN(sung) ? 0 : sung - source;
    const formTarget = params.throat + clamp(AUTO_THROAT * shift, -MAX_AUTO_THROAT, MAX_AUTO_THROAT) + character;
    form = isNaN(form) ? formTarget : form + (formTarget - form) * formantK;
    const flip = glitch ? glitch.formant(t) : 0;
    formant[k] = Math.pow(2, clamp(form + flip, -MAX_FORMANT, MAX_FORMANT) / 12);

    if (env > 1e-3 && !isNaN(sung)) {
      hz[k] = 440 * Math.pow(2, (sung - 69) / 12);
      gain[k] = env * vmask[k];
    }
  }
  return { hz, gain, formant };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
