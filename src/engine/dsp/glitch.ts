/**
 * Glitch: the Prismizer coming apart at the end of a song.
 *
 * Time is cut into short slots, and every slot of every voice independently
 * rolls for:
 *  - a leap (octave, fifth or twelfth) that snaps instead of gliding
 *  - a formant flip: the throat suddenly much shorter or longer
 *  - a stutter (a sliver of the slot repeated, beat-repeat style) or a chop
 * on top of a faint warble that deepens with the amount. Every decision is keyed on
 * the slot index, so the short windows rendered for live chords and the full
 * render of the arrangement glitch in exactly the same places.
 */

export interface Glitch {
  /** Semitones to add to the voice's pitch at time t. */
  pitch(t: number): number;
  /** Semitones to add to the voice's formant shift at time t. */
  formant(t: number): number;
  /** Stutter and chop `sig` in place; sig[0] is absolute sample `start`. */
  apply(sig: Float32Array, start: number, sampleRate: number): void;
  /** Seconds of audio a window needs before its start, so stutters can reach back. */
  preroll: number;
}

const LEAPS = [12, 12, 12, -12, -12, 7, 7, 19, -5, 24];
const STUTTER_DIVISIONS = [2, 3, 4, 6];
const EDGE = 0.0025; // seconds of fade at every stutter/chop edge (no clicks)

export function makeGlitch(amount: number, seed: number): Glitch | null {
  const g = Math.min(1, Math.max(0, amount));
  if (g < 0.005) return null;

  const slot = 0.16 - 0.07 * g;
  const pLeap = 0.22 * g ** 1.6;
  const pFlip = 0.2 * g ** 1.5;
  const pStutter = 0.3 * g ** 1.8;
  const warble = 0.12 * g * g; // semitones: a shimmer, never a wobble
  const warbleHz = 5.5 + 2.5 * hash(seed, 0, 90);
  const warblePhase = 2 * Math.PI * hash(seed, 0, 91);

  const roll = (j: number, salt: number) => hash(seed, j, salt);

  // An event that starts in slot j and lasts `len` slots, or null
  const leapAt = (j: number) =>
    roll(j, 1) < pLeap
      ? { len: 1 + Math.floor(roll(j, 2) * 3), value: LEAPS[Math.floor(roll(j, 3) * LEAPS.length)] }
      : null;
  const flipAt = (j: number) =>
    roll(j, 4) < pFlip
      ? { len: 1 + Math.floor(roll(j, 5) * 2), value: (roll(j, 6) < 0.5 ? -1 : 1) * (3 + 4 * roll(j, 7)) }
      : null;
  const active = (t: number, at: (j: number) => { len: number; value: number } | null) => {
    const j = Math.floor(t / slot);
    for (let k = j; k >= j - 2; k--) {
      const e = at(k);
      if (e && j < k + e.len) return e.value;
    }
    return 0;
  };

  return {
    // Stutters only touch their own slots but may copy from one an earlier
    // stutter rewrote, so a window needs three slots of history
    preroll: 3 * slot,
    pitch: t => active(t, leapAt) + warble * Math.sin(2 * Math.PI * warbleHz * t + warblePhase),
    formant: t => active(t, flipAt),
    apply(sig, start, sampleRate) {
      const edge = Math.max(1, Math.round(EDGE * sampleRate));
      const end = start + sig.length;
      const j0 = Math.floor(start / sampleRate / slot) - 2;
      const j1 = Math.floor(end / sampleRate / slot);
      for (let j = j0; j <= j1; j++) {
        if (roll(j, 8) >= pStutter) continue;
        const span = roll(j, 10) < 0.35 ? 2 : 1;
        const s0 = Math.round(j * slot * sampleRate);
        const s1 = Math.round((j + span) * slot * sampleRate);
        // Slots that begin before the buffer end before the window the caller keeps
        if (s0 < start || s0 >= end) continue;
        const stop = Math.min(s1, end);

        if (roll(j, 9) < 0.7) {
          // Repeat the first sliver of the slot, then crossfade back to the voice
          const division = STUTTER_DIVISIONS[Math.floor(roll(j, 11) * STUTTER_DIVISIONS.length)];
          const frag = Math.max(4 * edge, Math.round((slot * sampleRate) / division));
          if (s0 + frag + edge >= s1 || s0 + frag >= end) continue;
          const piece = sig.slice(s0 - start, s0 - start + frag);
          for (let i = 0; i < frag; i++) piece[i] *= fade(i, frag, edge);
          for (let n = s0 + frag - edge; n < stop; n++) {
            const i = n - start;
            if (n < s0 + frag) sig[i] *= (s0 + frag - 1 - n) / edge;
            else {
              const rep = piece[(n - s0) % frag];
              const back = n >= s1 - edge ? (n - (s1 - edge)) / edge : 0;
              sig[i] = rep * (1 - back) + sig[i] * back;
            }
          }
        } else {
          // Chop: cut the back half of the slot
          const mid = s0 + Math.round((s1 - s0) / 2);
          for (let n = mid - edge; n < stop; n++) {
            sig[n - start] *= n < mid ? (mid - n) / edge : n >= s1 - edge ? (n - (s1 - edge)) / edge : 0;
          }
        }
      }
    },
  };
}

function fade(i: number, n: number, edge: number): number {
  if (i < edge) return i / edge;
  if (i >= n - edge) return (n - 1 - i) / edge;
  return 1;
}

/** Stateless hash to [0, 1): the same (seed, slot, salt) always rolls the same. */
function hash(seed: number, j: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(j + 0x632be5ab, 0xc2b2ae35);
  h ^= Math.imul(salt + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
