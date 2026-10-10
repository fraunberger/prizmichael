/**
 * Bass: the tuned lead an octave down, plus a sine sub that follows it.
 *
 * The octave voice is PSOLA with grains stretched 2× (formants down an octave
 * as well, like slowing tape), which keeps its body without the buzz you get
 * from a formant-preserving octave drop. The sub adds a round fundamental under
 * it. A drive envelope (the automation lane) pushes both into warm, asymmetric
 * saturation.
 */
import { AutomationPoint } from '../types';
import { PitchTrack } from './pitch';
import { PitchMarks } from './marks';
import { psola, voicingMask, gainAt } from './psola';
import { applyBiquad, filtfilt, lowpass, smoothingCoeff } from './filters';

const VOICE_LEVEL = 0.6;
const SUB_LEVEL = 0.8;

export function renderBass(
  x: Float32Array,
  sampleRate: number,
  track: PitchTrack,
  marks: PitchMarks,
  correctedHz: Float32Array,
  automation: AutomationPoint[],
): Float32Array {
  const { hop } = track;
  const frames = track.f0.length;
  const spf = hop * sampleRate;

  const hz = new Float32Array(frames);
  for (let k = 0; k < frames; k++) hz[k] = correctedHz[k] / 2;
  const voice = psola(x, sampleRate, marks, { hop, hz, formant: new Float32Array(frames).fill(0.5) });

  // Loudness envelope of the source, for the voice gate and the sub's level
  const vmask = voicingMask(marks, frames, hop, sampleRate);
  const env = new Float32Array(frames);
  const atk = 1 - smoothingCoeff(0.01, hop), rel = 1 - smoothingCoeff(0.08, hop);
  let e = 0;
  for (let k = 0; k < frames; k++) {
    const target = track.rms[k] * vmask[k] * Math.SQRT2;
    e += (target - e) * (target > e ? atk : rel);
    env[k] = e;
  }

  const out = new Float32Array(x.length);
  let phase = 0;
  let freq = 0;
  for (let i = 0; i < x.length; i++) {
    const p = i / spf;
    const k = Math.min(frames - 1, Math.floor(p));
    const f = hz[k] > 0 ? hz[k] : freq;
    freq += (f - freq) * 0.002; // ~10 ms glide, avoids steps between frames
    phase += 2 * Math.PI * freq / sampleRate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    const sub = Math.sin(phase) + 0.22 * Math.sin(2 * phase);
    out[i] = voice[i] * gainAt(vmask, i, spf) * VOICE_LEVEL + sub * gainAt(env, i, spf) * SUB_LEVEL;
  }

  const lp = lowpass(600, sampleRate);
  filtfilt(out, lp);

  // Drive envelope from the automation lane (bypassed when flat at zero)
  const points = [...automation].sort((a, b) => a.time - b.time);
  if (points.some(pt => pt.value > 0.01)) {
    for (let i = 0; i < out.length; i++) {
      const amount = automationAt(points, i / sampleRate);
      if (amount > 0.01) out[i] = saturate(out[i], amount);
    }
    applyBiquad(out, lowpass(3000, sampleRate));
  }

  normalize(out, 0.9);
  return out;
}

/** Asymmetric soft clip: adds even harmonics (warm) rather than odd ones (fizzy). */
function saturate(s: number, amount: number): number {
  const drive = 1 + amount * 24;
  const bias = 0.2 * amount;
  const shaped = (Math.tanh(drive * (s + bias)) - Math.tanh(drive * bias)) / Math.tanh(drive);
  return s * (1 - amount) + shaped * amount;
}

export function automationAt(points: AutomationPoint[], time: number): number {
  if (points.length === 0) return 0;
  if (time <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (time >= last.time) return last.value;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const t = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
  return a.value + t * (b.value - a.value);
}

function normalize(data: Float32Array, ceiling: number): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > ceiling) {
    const g = ceiling / peak;
    for (let i = 0; i < data.length; i++) data[i] *= g;
  }
}
