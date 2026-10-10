/**
 * Pitch tracking: YIN candidates on a decimated copy of the signal (fast),
 * linked across frames with a Viterbi search (pYIN-style, so octave and fifth
 * errors lose to continuity), refined at the full sample rate (accurate), then
 * cleaned of short blips and dropouts. A clean contour matters a lot here
 * because every downstream voice is resynthesized from it.
 */
import { filtfilt, lowpass } from './filters';

export const ANALYSIS_HOP = 0.005; // seconds

const MIN_F0 = 60;
const MAX_F0 = 1100;
const MAX_CANDIDATES = 6;
const CANDIDATE_CEILING = 0.5;  // CMND above this isn't considered periodic at all
const UNVOICED_COST = 0.3;      // a voiced candidate must beat this aperiodicity
const VOICING_SWITCH_COST = 0.12;
const JUMP_COST = 0.035;        // per semitone of frame-to-frame movement
const JUMP_FREE = 0.35;         // semitones of movement per frame that cost nothing
const LOW_PITCH_BIAS = 0.06;    // per octave below the first periodic candidate

export interface PitchTrack {
  hop: number;              // seconds between frames
  f0: Float32Array;         // Hz, 0 = unvoiced
  confidence: Float32Array; // 0–1
  rms: Float32Array;        // linear frame loudness
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return new Float32Array(channels[0]);
  const out = new Float32Array(channels[0].length);
  const g = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) out[i] += ch[i] * g;
  }
  return out;
}

export function trackPitch(x: Float32Array, sampleRate: number): PitchTrack {
  const hop = ANALYSIS_HOP;
  const nFrames = Math.max(1, Math.floor(x.length / (hop * sampleRate)));

  // --- Decimate to ~11 kHz for the coarse YIN search ---
  const D = Math.max(1, Math.round(sampleRate / 11025));
  const srd = sampleRate / D;
  const aa = new Float32Array(x);
  if (D > 1) {
    const f = lowpass(0.42 * srd, sampleRate);
    filtfilt(aa, f);
    filtfilt(aa, f);
  }
  const xd = new Float32Array(Math.floor(x.length / D));
  for (let i = 0; i < xd.length; i++) xd[i] = aa[i * D];

  const maxLag = Math.ceil(srd / MIN_F0);
  const minLag = Math.max(2, Math.floor(srd / MAX_F0));
  const W = maxLag;
  const seg = new Float32Array(W + maxLag + 2);
  const diff = new Float32Array(maxLag + 1);
  const cmnd = new Float32Array(maxLag + 1);

  // Prefix sum of squares for RMS
  const sq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];

  const f0 = new Float32Array(nFrames);
  const confidence = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);

  const hopFull = hop * sampleRate;
  for (let k = 0; k < nFrames; k++) {
    const centerFull = k * hopFull;
    const r0 = Math.max(0, Math.round(centerFull - hopFull));
    const r1 = Math.min(x.length, Math.round(centerFull + hopFull));
    rms[k] = r1 > r0 ? Math.sqrt((sq[r1] - sq[r0]) / (r1 - r0)) : 0;
  }

  // Silence gate: relative to the loudest frame, with an absolute floor
  let maxRms = 0;
  for (let k = 0; k < nFrames; k++) if (rms[k] > maxRms) maxRms = rms[k];
  const gate = Math.max(maxRms * 0.01, 2e-4);

  // --- Per-frame candidates: local minima of the YIN CMND function ---
  const candTau = new Float32Array(nFrames * MAX_CANDIDATES);
  const candCost = new Float32Array(nFrames * MAX_CANDIDATES);
  const candCount = new Uint8Array(nFrames);
  const found: { tau: number; cost: number }[] = [];

  for (let k = 0; k < nFrames; k++) {
    if (rms[k] < gate) continue;
    const centerFull = k * hopFull;

    // Copy the (decimated) analysis segment, zero-padded at the edges
    const start = Math.round(centerFull / D - (W + maxLag) / 2);
    for (let j = 0; j < seg.length; j++) {
      const idx = start + j;
      seg[j] = idx >= 0 && idx < xd.length ? xd[idx] : 0;
    }

    // YIN difference function + cumulative mean normalization
    let running = 0;
    cmnd[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const d = seg[j] - seg[j + tau];
        sum += d * d;
      }
      diff[tau] = sum;
      running += sum;
      cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    found.length = 0;
    for (let tau = minLag; tau < maxLag; tau++) {
      const v = cmnd[tau];
      if (v < CANDIDATE_CEILING && v <= cmnd[tau - 1] && v <= cmnd[tau + 1]) {
        const a = cmnd[tau - 1], c = cmnd[tau + 1];
        const den = a - 2 * v + c;
        const shift = den > 0 ? 0.5 * (a - c) / den : 0;
        found.push({ tau: tau + shift, cost: v });
      }
    }
    if (found.length === 0) continue;
    found.sort((p, q) => p.cost - q.cost);
    found.length = Math.min(found.length, MAX_CANDIDATES);

    // Mild preference for the shortest clearly-periodic lag (YIN's first-dip rule)
    let firstPeriodic = Infinity;
    for (const c of found) if (c.cost < UNVOICED_COST && c.tau < firstPeriodic) firstPeriodic = c.tau;
    candCount[k] = found.length;
    for (let i = 0; i < found.length; i++) {
      const c = found[i];
      const bias = isFinite(firstPeriodic) && c.tau > firstPeriodic
        ? LOW_PITCH_BIAS * Math.log2(c.tau / firstPeriodic)
        : 0;
      candTau[k * MAX_CANDIDATES + i] = c.tau;
      candCost[k * MAX_CANDIDATES + i] = c.cost + bias;
    }
  }

  // --- Viterbi across frames. State 0 = unvoiced, 1..n = candidates ---
  const S = MAX_CANDIDATES + 1;
  let prevScore = new Float64Array(S).fill(Infinity);
  let curScore = new Float64Array(S);
  const back = new Uint8Array(nFrames * S);
  prevScore[0] = 0;
  const semis = (tauA: number, tauB: number) => Math.abs(12 * Math.log2(tauA / tauB));

  for (let k = 0; k < nFrames; k++) {
    curScore.fill(Infinity);
    const n = candCount[k];
    const prevN = k > 0 ? candCount[k - 1] : 0;

    // Unvoiced state
    const uvEmit = rms[k] < gate ? 0 : UNVOICED_COST;
    for (let j = 0; j <= prevN; j++) {
      if (prevScore[j] === Infinity) continue;
      const s = prevScore[j] + uvEmit + (j > 0 ? VOICING_SWITCH_COST : 0);
      if (s < curScore[0]) { curScore[0] = s; back[k * S] = j; }
    }
    // Voiced candidates
    for (let i = 1; i <= n; i++) {
      const tau = candTau[k * MAX_CANDIDATES + i - 1];
      const emit = candCost[k * MAX_CANDIDATES + i - 1];
      for (let j = 0; j <= prevN; j++) {
        if (prevScore[j] === Infinity) continue;
        let trans = VOICING_SWITCH_COST;
        if (j > 0) {
          const jump = semis(tau, candTau[(k - 1) * MAX_CANDIDATES + j - 1]);
          trans = JUMP_COST * Math.max(0, jump - JUMP_FREE);
        }
        const s = prevScore[j] + emit + trans;
        if (s < curScore[i]) { curScore[i] = s; back[k * S + i] = j; }
      }
    }
    [prevScore, curScore] = [curScore, prevScore];
  }

  let state = 0;
  for (let i = 1; i < S; i++) if (prevScore[i] < prevScore[state]) state = i;
  for (let k = nFrames - 1; k >= 0; k--) {
    if (state > 0) {
      const tau = candTau[k * MAX_CANDIDATES + state - 1];
      const cost = candCost[k * MAX_CANDIDATES + state - 1];
      // Refine the period at the full sample rate around the coarse estimate
      const lagFull = refineLag(x, k * hopFull, tau * D, D, W * D);
      f0[k] = sampleRate / lagFull;
      confidence[k] = Math.max(0, Math.min(1, 1 - cost));
    }
    state = back[k * S + state];
  }

  const track: PitchTrack = { hop, f0, confidence, rms };
  cleanTrack(track);
  return track;
}

function refineLag(x: Float32Array, center: number, approx: number, radius: number, W: number): number {
  const lo = Math.max(2, Math.floor(approx) - radius);
  const hi = Math.ceil(approx) + radius;
  const start = Math.round(center - (W + hi) / 2);
  const scores = new Float64Array(hi - lo + 1);
  let bestIdx = -1;
  let best = Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const i0 = start + j;
      const i1 = i0 + lag;
      const a = i0 >= 0 && i0 < x.length ? x[i0] : 0;
      const b = i1 >= 0 && i1 < x.length ? x[i1] : 0;
      const d = a - b;
      sum += d * d;
    }
    scores[lag - lo] = sum;
    if (sum < best) { best = sum; bestIdx = lag - lo; }
  }
  if (bestIdx <= 0 || bestIdx >= scores.length - 1) return approx;
  const a = scores[bestIdx - 1], b = scores[bestIdx], c = scores[bestIdx + 1];
  const den = a - 2 * b + c;
  const shift = den > 0 ? 0.5 * (a - c) / den : 0;
  return lo + bestIdx + shift;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const toMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
const toHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function cleanTrack(track: PitchTrack): void {
  const { f0, confidence } = track;
  const n = f0.length;
  const midi = new Float64Array(n);
  for (let k = 0; k < n; k++) midi[k] = f0[k] > 0 ? toMidi(f0[k]) : NaN;

  // 1. Octave errors: fold frames that sit ~12 semitones away from the local median.
  const radius = 30; // ±150 ms
  const window: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const fixed = new Float64Array(midi);
    for (let k = 0; k < n; k++) {
      if (isNaN(midi[k])) continue;
      window.length = 0;
      for (let j = Math.max(0, k - radius); j <= Math.min(n - 1, k + radius); j++) {
        if (!isNaN(midi[j])) window.push(midi[j]);
      }
      const med = median(window);
      const m = midi[k];
      if (m - med > 8 && Math.abs(m - 12 - med) < Math.abs(m - med)) fixed[k] = m - 12;
      else if (med - m > 8 && Math.abs(m + 12 - med) < Math.abs(m - med)) fixed[k] = m + 12;
    }
    midi.set(fixed);
  }

  // 2. Drop voiced islands shorter than 30 ms
  forEachRun(midi, (s, e) => {
    if (e - s < 6) for (let k = s; k < e; k++) midi[k] = NaN;
  });

  // 3. Bridge dropouts up to 20 ms when both sides agree on pitch
  let lastVoiced = -1;
  for (let k = 0; k < n; k++) {
    if (isNaN(midi[k])) continue;
    const gap = k - lastVoiced - 1;
    if (lastVoiced >= 0 && gap > 0 && gap <= 4 && Math.abs(midi[k] - midi[lastVoiced]) < 2) {
      for (let j = 1; j <= gap; j++) {
        midi[lastVoiced + j] = midi[lastVoiced] + (midi[k] - midi[lastVoiced]) * (j / (gap + 1));
        confidence[lastVoiced + j] = Math.min(confidence[lastVoiced], confidence[k]) * 0.8;
      }
    }
    lastVoiced = k;
  }

  // 4. 5-point median within voiced runs (kills single-frame spikes)
  const smoothed = new Float64Array(midi);
  forEachRun(midi, (s, e) => {
    for (let k = s; k < e; k++) {
      window.length = 0;
      for (let j = Math.max(s, k - 2); j <= Math.min(e - 1, k + 2); j++) window.push(midi[j]);
      smoothed[k] = median(window);
    }
  });

  for (let k = 0; k < n; k++) {
    if (isNaN(smoothed[k])) { f0[k] = 0; confidence[k] = 0; }
    else f0[k] = toHz(smoothed[k]);
  }
}

function forEachRun(midi: Float64Array, fn: (start: number, end: number) => void): void {
  let k = 0;
  while (k < midi.length) {
    if (isNaN(midi[k])) { k++; continue; }
    const s = k;
    while (k < midi.length && !isNaN(midi[k])) k++;
    fn(s, k);
  }
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear interpolation of f0 at an arbitrary time; returns 0 if unvoiced. */
export function f0At(track: PitchTrack, timeSec: number): number {
  const pos = timeSec / track.hop;
  const k = Math.floor(pos);
  if (k < 0 || k >= track.f0.length) return 0;
  const a = track.f0[k];
  const b = k + 1 < track.f0.length ? track.f0[k + 1] : 0;
  if (a <= 0) return b > 0 && pos - k > 0.5 ? b : 0;
  if (b <= 0) return a;
  return a + (b - a) * (pos - k);
}
