/**
 * Split-band de-esser. Sibilants are found where the pitch tracker hears no
 * voice and the top band dominates; only that band is turned down there, so
 * vowels and their air are untouched. Zero-phase filtering keeps the bands
 * exact complements (low + high = original).
 */
import { PitchTrack } from './pitch';
import { gainAt } from './psola';
import { filtfilt, highpass, smoothingCoeff } from './filters';

const SPLIT_HZ = 5000;
const SIBILANT_RATIO = 0.15; // share of frame energy above the split

export function deEss(y: Float32Array, sampleRate: number, track: PitchTrack, reductionDb = 7): void {
  const hp = new Float32Array(y);
  const f = highpass(SPLIT_HZ, sampleRate);
  filtfilt(hp, f);
  filtfilt(hp, f);

  const spf = track.hop * sampleRate;
  const frames = track.f0.length;
  const cut = 1 - Math.pow(10, -reductionDb / 20);
  const gain = new Float32Array(frames);
  const atk = 1 - smoothingCoeff(0.003, track.hop);
  const rel = 1 - smoothingCoeff(0.03, track.hop);
  let g = 0;
  for (let k = 0; k < frames; k++) {
    const s0 = Math.round(k * spf), s1 = Math.min(y.length, Math.round((k + 1) * spf));
    let eAll = 1e-12, eHigh = 0;
    for (let i = s0; i < s1; i++) {
      eAll += y[i] * y[i];
      eHigh += hp[i] * hp[i];
    }
    const sibilant = track.f0[k] <= 0 && eHigh / eAll > SIBILANT_RATIO;
    const target = sibilant ? cut * Math.min(1, (eHigh / eAll - SIBILANT_RATIO) / 0.25 + 0.3) : 0;
    g += (target - g) * (target > g ? atk : rel);
    gain[k] = g;
  }
  for (let i = 0; i < y.length; i++) {
    const r = gainAt(gain, i, spf);
    if (r > 1e-4) y[i] -= hp[i] * r;
  }
}
