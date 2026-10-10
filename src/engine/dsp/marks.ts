/**
 * Pitch marks (one per glottal pulse) for PSOLA resynthesis.
 *
 * Candidate peaks of a low-passed copy of the signal are linked with a Viterbi
 * search that rewards prominent peaks and penalizes spacing that disagrees with
 * the tracked period. Consistent marks are what make PSOLA sound smooth rather
 * than rough, so this trades a little CPU for a lot of stability.
 */
import { filtfilt, lowpass } from './filters';
import { PitchTrack } from './pitch';

export interface VoicedRun {
  start: number; // sample bounds of the voiced region
  end: number;
  first: number; // index range into PitchMarks.pos (inclusive)
  last: number;
}

export interface PitchMarks {
  pos: Float64Array; // fractional sample positions, ascending
  runs: VoicedRun[];
}

const SPACING_PENALTY = 25;
const MIN_GAP = 0.6;
const MAX_GAP = 1.6;

export function findPitchMarks(x: Float32Array, sampleRate: number, track: PitchTrack): PitchMarks {
  const e = new Float32Array(x);
  filtfilt(e, lowpass(1400, sampleRate));

  const hopSamples = track.hop * sampleRate;
  const positions: number[] = [];
  const runs: VoicedRun[] = [];

  let k = 0;
  const n = track.f0.length;
  while (k < n) {
    if (track.f0[k] <= 0) { k++; continue; }
    const k0 = k;
    while (k < n && track.f0[k] > 0) k++;
    const k1 = k; // exclusive

    const start = Math.max(0, Math.round((k0 - 0.5) * hopSamples));
    const end = Math.min(x.length - 2, Math.round((k1 - 0.5) * hopSamples));
    const periodAt = (sample: number) => {
      const fk = Math.min(k1 - 1, Math.max(k0, Math.round(sample / hopSamples)));
      return sampleRate / track.f0[fk];
    };

    for (const sub of markRun(e, start, end, periodAt)) {
      if (sub.length < 3) continue;
      const first = positions.length;
      positions.push(...sub);
      runs.push({
        start: Math.max(start, Math.floor(sub[0] - periodAt(sub[0]))),
        end: Math.min(end, Math.ceil(sub[sub.length - 1] + periodAt(sub[sub.length - 1]))),
        first,
        last: positions.length - 1,
      });
    }
  }

  return { pos: Float64Array.from(positions), runs };
}

/** Returns one or more contiguous mark sequences for a voiced run. */
function markRun(
  e: Float32Array,
  start: number,
  end: number,
  periodAt: (n: number) => number,
): number[][] {
  // Pick the dominant polarity so marks land on the main excitation peak
  let posSum = 0, negSum = 0;
  for (let i = start; i <= end; i++) {
    if (e[i] > 0) posSum += e[i] * e[i] * e[i];
    else negSum -= e[i] * e[i] * e[i];
  }
  const sign = posSum >= negSum ? 1 : -1;

  // Candidates: positive local maxima of the polarity-corrected signal
  const cand: number[] = [];
  for (let i = Math.max(1, start); i < end; i++) {
    const v = sign * e[i];
    if (v > 0 && v > sign * e[i - 1] && v >= sign * e[i + 1]) cand.push(i);
  }
  const C = cand.length;
  if (C < 3) return [];

  // Prominence relative to the local envelope (±half a period)
  const amp = new Float64Array(C);
  for (let j = 0; j < C; j++) {
    const half = Math.round(periodAt(cand[j]) / 2);
    let env = 1e-9;
    for (let i = Math.max(0, cand[j] - half); i <= Math.min(e.length - 1, cand[j] + half); i++) {
      const a = Math.abs(e[i]);
      if (a > env) env = a;
    }
    amp[j] = (sign * e[cand[j]]) / env;
  }

  // Viterbi: score = Σ(prominence − 0.5) − penalty · ln(gap / period)²
  const score = new Float64Array(C).fill(-Infinity);
  const prev = new Int32Array(C).fill(-1);
  const restart = new Uint8Array(C);
  let bestBefore = -1; // best-scoring candidate that can no longer link forward
  let frontier = 0;
  for (let j = 0; j < C; j++) {
    const P = periodAt(cand[j]);
    const base = amp[j] - 0.5;
    if (cand[j] - start < 1.25 * P) score[j] = base;

    for (let i = j - 1; i >= 0; i--) {
      const gap = cand[j] - cand[i];
      if (gap < MIN_GAP * P) continue;
      if (gap > MAX_GAP * P) break;
      if (score[i] === -Infinity) continue;
      const r = Math.log(gap / P);
      const s = score[i] + base - SPACING_PENALTY * r * r;
      if (s > score[j]) { score[j] = s; prev[j] = i; }
    }

    // Keep track of candidates too far back to link to j; allow a penalized restart
    while (frontier < j && cand[j] - cand[frontier] > MAX_GAP * P) {
      if (score[frontier] > -Infinity && (bestBefore < 0 || score[frontier] > score[bestBefore])) bestBefore = frontier;
      frontier++;
    }
    if (score[j] === -Infinity && bestBefore >= 0) {
      score[j] = score[bestBefore] + base - 3;
      prev[j] = bestBefore;
      restart[j] = 1;
    }
  }

  // Best terminal candidate near the end of the run
  let last = -1;
  for (let j = C - 1; j >= 0; j--) {
    if (end - cand[j] > 1.25 * periodAt(cand[j])) break;
    if (score[j] > -Infinity && (last < 0 || score[j] > score[last])) last = j;
  }
  if (last < 0) {
    for (let j = 0; j < C; j++) if (score[j] > -Infinity && (last < 0 || score[j] > score[last])) last = j;
  }
  if (last < 0) return [];

  // Backtrack, splitting wherever the path restarted
  const sequences: number[][] = [];
  let current: number[] = [];
  for (let j = last; j >= 0; j = prev[j]) {
    current.push(refinePeak(e, cand[j], sign));
    if (restart[j]) { sequences.push(current.reverse()); current = []; }
  }
  if (current.length) sequences.push(current.reverse());
  return sequences.reverse();
}

function refinePeak(e: Float32Array, i: number, sign: number): number {
  const a = sign * e[i - 1], b = sign * e[i], c = sign * e[i + 1];
  const den = a - 2 * b + c;
  if (den >= 0) return i;
  return i + 0.5 * (a - c) / den;
}
