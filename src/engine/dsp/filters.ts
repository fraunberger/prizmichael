/**
 * Small filter toolkit for offline DSP: RBJ biquads, zero-phase filtering,
 * and one-pole smoothing. Everything operates in place on Float32Arrays.
 */

export interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

export function lowpass(freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.49) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: -2 * cos / a0,
    a2: (1 - alpha) / a0,
  };
}

export function highpass(freq: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.49) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: -2 * cos / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Run a biquad over the data in place (Direct Form II transposed). */
export function applyBiquad(data: Float32Array, f: Biquad, reverse = false): void {
  let z1 = 0, z2 = 0;
  const n = data.length;
  for (let k = 0; k < n; k++) {
    const i = reverse ? n - 1 - k : k;
    const x = data[i];
    const y = f.b0 * x + z1;
    z1 = f.b1 * x - f.a1 * y + z2;
    z2 = f.b2 * x - f.a2 * y;
    data[i] = y;
  }
}

/** Forward-backward filtering: zero phase, squared magnitude response. */
export function filtfilt(data: Float32Array, f: Biquad): void {
  applyBiquad(data, f, false);
  applyBiquad(data, f, true);
}

/** Exponential smoothing coefficient for a time constant, given the step size. */
export function smoothingCoeff(timeConstantSec: number, stepSec: number): number {
  return timeConstantSec > 0 ? Math.exp(-stepSec / timeConstantSec) : 0;
}

/** Deterministic PRNG (mulberry32) so humanization is repeatable between renders. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
