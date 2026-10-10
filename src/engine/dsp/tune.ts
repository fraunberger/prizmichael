/**
 * Pitch-correction target curve.
 *
 * Like Auto-Tune, retune speed smooths the *correction* (target − sung), not
 * the target itself: fast settings flatten everything onto the scale (the hard
 * Prismizer sound), slow settings let vibrato and scoops through while still
 * pulling sustained notes into tune. A little hysteresis keeps the snapped note
 * from flip-flopping when the singer sits between two scale tones.
 */
import { NoteName, ScaleType, NOTE_NAMES, SCALE_INTERVALS } from '../types';
import { PitchTrack } from './pitch';

const HYSTERESIS = 0.15; // semitones

export function correctionTarget(
  track: PitchTrack,
  key: NoteName,
  scale: ScaleType,
  retuneMs: number,
): Float32Array {
  const { f0, hop } = track;
  const out = new Float32Array(f0.length);
  const root = NOTE_NAMES.indexOf(key);
  const allowed = new Set(SCALE_INTERVALS[scale].map(i => (root + i) % 12));
  const nearest = (m: number) => {
    const base = Math.round(m);
    let best = base, bestDist = Infinity;
    for (let d = -2; d <= 2; d++) {
      const note = base + d;
      if (!allowed.has(((note % 12) + 12) % 12)) continue;
      const dist = Math.abs(m - note);
      if (dist < bestDist) { bestDist = dist; best = note; }
    }
    return best;
  };

  // Time constant: retune "speed" is roughly the time to land on the note
  const tau = Math.max(0, retuneMs) / 1000 / 2.5;
  const alpha = tau > 0 ? Math.exp(-hop / tau) : 0;

  let inRun = false;
  let note = 0;
  let correction = 0;
  for (let k = 0; k < f0.length; k++) {
    if (f0[k] <= 0) { inRun = false; continue; }
    const m = 69 + 12 * Math.log2(f0[k] / 440);
    const candidate = nearest(m);
    if (!inRun) {
      note = candidate;
      correction = note - m;
      inRun = true;
    } else if (candidate !== note && Math.abs(m - note) > Math.abs(m - candidate) + HYSTERESIS) {
      note = candidate;
    }
    correction = alpha * correction + (1 - alpha) * (note - m);
    out[k] = 440 * Math.pow(2, (m + correction - 69) / 12);
  }
  return out;
}
