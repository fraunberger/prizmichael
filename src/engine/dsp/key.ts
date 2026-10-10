/**
 * Key detection: Krumhansl–Kessler profile correlation over a duration- and
 * confidence-weighted pitch-class histogram. The singer's overall tuning offset
 * is estimated first (plenty of a cappella takes sit a quarter-tone sharp or
 * flat), so notes land in the right bins.
 */
import { NoteName, ScaleType, NOTE_NAMES } from '../types';
import { PitchTrack } from './pitch';

const PROFILES: Record<ScaleType, number[]> = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

export interface KeyEstimate {
  key: NoteName;
  scale: ScaleType;
  confidence: number;  // 0–1
  tuningCents: number; // singer's average offset from A440
}

export function detectKey(track: PitchTrack): KeyEstimate {
  let sx = 0, sy = 0;
  for (let k = 0; k < track.f0.length; k++) {
    if (track.f0[k] <= 0) continue;
    const m = 69 + 12 * Math.log2(track.f0[k] / 440);
    const w = track.confidence[k];
    sx += w * Math.cos(2 * Math.PI * m);
    sy += w * Math.sin(2 * Math.PI * m);
  }
  const offset = Math.atan2(sy, sx) / (2 * Math.PI); // semitones, −0.5…0.5

  const hist = new Float64Array(12);
  let total = 0;
  for (let k = 0; k < track.f0.length; k++) {
    if (track.f0[k] <= 0) continue;
    const m = 69 + 12 * Math.log2(track.f0[k] / 440) - offset;
    const pc = ((Math.round(m) % 12) + 12) % 12;
    hist[pc] += track.confidence[k];
    total += track.confidence[k];
  }
  if (total === 0) return { key: 'C', scale: 'major', confidence: 0, tuningCents: 0 };

  const results: { key: NoteName; scale: ScaleType; r: number }[] = [];
  for (const scale of ['major', 'minor'] as ScaleType[]) {
    for (let root = 0; root < 12; root++) {
      const profile = Array.from({ length: 12 }, (_, i) => PROFILES[scale][(i - root + 12) % 12]);
      results.push({ key: NOTE_NAMES[root], scale, r: pearson(hist, profile) });
    }
  }
  results.sort((a, b) => b.r - a.r);
  const [best, second] = results;
  const margin = best.r - second.r;
  return {
    key: best.key,
    scale: best.scale,
    confidence: Math.max(0, Math.min(1, best.r)) * Math.min(1, 0.4 + margin * 6),
    tuningCents: Math.round(offset * 100),
  };
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db + 1e-12);
}
