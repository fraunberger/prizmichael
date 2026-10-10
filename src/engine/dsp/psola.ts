/**
 * Time-varying TD-PSOLA pitch shifter.
 *
 * Grains are cut two pitch periods wide around each analysis mark and laid
 * back down at the *target* period, so the output pitch follows the target
 * curve exactly (that's what makes harmonies lock to their notes, the way the
 * Messina/Prismizer voices do). Formants are moved independently by resampling
 * each grain ("throat length"). Grains are placed with sub-sample precision and
 * read with cubic interpolation, which keeps high voices free of jitter.
 */
import { PitchMarks } from './marks';

export interface PsolaTarget {
  hop: number;              // seconds per frame of the arrays below
  hz: Float32Array;         // target f0 per frame; 0 = silent
  formant?: Float32Array;   // formant ratio per frame (>1 raises formants)
}

const HANN_SIZE = 4096;
const HANN = (() => {
  const t = new Float32Array(HANN_SIZE + 2);
  for (let i = 0; i <= HANN_SIZE + 1; i++) {
    t[i] = i > HANN_SIZE ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * i) / HANN_SIZE);
  }
  return t;
})();

export interface SampleRange {
  start: number;
  end: number;
}

/**
 * Resynthesize the voiced parts of `x` at the target pitch. Unvoiced regions
 * (and frames whose target is 0) come back silent; callers blend in whatever
 * should be heard there. With a range, only that window is synthesized and the
 * result is range-length (index 0 = range.start).
 */
export function psola(
  x: Float32Array,
  sampleRate: number,
  marks: PitchMarks,
  target: PsolaTarget,
  range: SampleRange = { start: 0, end: x.length },
): Float32Array {
  const len = range.end - range.start;
  const y = new Float32Array(len);
  const wsum = new Float32Array(len);
  const { pos } = marks;
  const frames = target.hz.length;
  const framePerSample = 1 / (target.hop * sampleRate);

  for (const run of marks.runs) {
    const k0 = run.first;
    const k1 = run.last;
    if (k1 - k0 < 1) continue;
    if (run.end < range.start || run.start > range.end) continue;

    let k = k0;
    let s = pos[k0];
    const stop = pos[k1];
    while (s <= stop) {
      const fpos = s * framePerSample;
      const fi = Math.min(frames - 1, Math.floor(fpos));
      const hz = interp(target.hz, fi, fpos - fi);

      // Nearest analysis mark to the synthesis position (no time stretch)
      while (k < k1 && Math.abs(pos[k + 1] - s) <= Math.abs(pos[k] - s)) k++;
      const left = k > k0 ? pos[k] - pos[k - 1] : pos[k + 1] - pos[k];
      const right = k < k1 ? pos[k + 1] - pos[k] : left;

      if (hz <= 0) {
        s += (left + right) / 2;
        continue;
      }

      const phi = target.formant ? interp(target.formant, fi, fpos - fi) || 1 : 1;
      if (s + right / phi >= range.start && s - left / phi < range.end) {
        addGrain(x, y, wsum, range.start, pos[k], s, left, right, phi);
      }
      s += sampleRate / hz;
    }
  }

  // Normalize overlap gain where grains pile up (upward shifts) so level stays even
  for (let i = 0; i < len; i++) {
    if (wsum[i] > 1) y[i] /= wsum[i];
  }
  return y;
}

function interp(arr: Float32Array, i: number, frac: number): number {
  const a = arr[i];
  const b = i + 1 < arr.length ? arr[i + 1] : a;
  if (a <= 0 || b <= 0) return frac < 0.5 ? a : b;
  return a + (b - a) * frac;
}

function addGrain(
  x: Float32Array,
  y: Float32Array,
  wsum: Float32Array,
  offset: number,
  centerIn: number,
  centerOut: number,
  leftIn: number,
  rightIn: number,
  phi: number,
): void {
  const N = x.length;
  const leftOut = leftIn / phi;
  const rightOut = rightIn / phi;
  const n0 = Math.max(offset, Math.ceil(centerOut - leftOut));
  const n1 = Math.min(offset + y.length - 1, Math.floor(centerOut + rightOut));
  const scaleL = HANN_SIZE / leftOut;
  const scaleR = HANN_SIZE / rightOut;

  for (let n = n0; n <= n1; n++) {
    const d = n - centerOut;
    const w = d < 0 ? HANN[(-d * scaleL) | 0] : HANN[(d * scaleR) | 0];
    if (w <= 0) continue;

    const u = centerIn + d * phi;
    const i = Math.floor(u);
    if (i < 1 || i + 2 >= N) continue;
    const f = u - i;
    const xm1 = x[i - 1], x0 = x[i], x1 = x[i + 1], x2 = x[i + 2];
    // Catmull-Rom cubic
    const v = x0 + 0.5 * f * (x1 - xm1 + f * (2 * xm1 - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - xm1)));

    y[n - offset] += w * v;
    wsum[n - offset] += w;
  }
}

/**
 * Per-frame voicing gain (0–1) with short attack/release ramps, used to
 * crossfade PSOLA output against the dry signal (or silence) at voiced edges.
 */
export function voicingMask(marks: PitchMarks, frames: number, hop: number, sampleRate: number): Float32Array {
  const raw = new Float32Array(frames);
  for (const run of marks.runs) {
    const a = Math.max(0, Math.ceil(run.start / sampleRate / hop));
    const b = Math.min(frames - 1, Math.floor(run.end / sampleRate / hop));
    for (let k = a; k <= b; k++) raw[k] = 1;
  }
  // Ramp in over ~10 ms after onset, out over ~10 ms before offset (stays inside the run)
  const ramp = Math.max(1, Math.round(0.01 / hop));
  const mask = new Float32Array(frames);
  for (let k = 0; k < frames; k++) {
    if (!raw[k]) continue;
    let distIn = 0, distOut = 0;
    while (distIn < ramp && k - distIn - 1 >= 0 && raw[k - distIn - 1]) distIn++;
    while (distOut < ramp && k + distOut + 1 < frames && raw[k + distOut + 1]) distOut++;
    const g = Math.min(distIn + 1, distOut + 1, ramp) / ramp;
    mask[k] = 0.5 - 0.5 * Math.cos(Math.PI * g);
  }
  return mask;
}

/** Linear interpolation of a per-frame gain curve at a sample index. */
export function gainAt(curve: Float32Array, sample: number, samplesPerFrame: number): number {
  const p = sample / samplesPerFrame;
  const i = Math.floor(p);
  if (i >= curve.length - 1) return curve[curve.length - 1] ?? 0;
  return curve[i] + (curve[i + 1] - curve[i]) * (p - i);
}
