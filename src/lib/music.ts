import { NoteName, ScaleType, NOTE_NAMES } from '@/engine/types';

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

// Keys conventionally written with flats
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);   // F B♭ E♭ A♭ D♭ G♭
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);   // D G C F B♭ E♭

export function prefersFlats(key: NoteName, scale: ScaleType): boolean {
  const pc = NOTE_NAMES.indexOf(key);
  return scale === 'major' ? FLAT_MAJOR.has(pc) : FLAT_MINOR.has(pc);
}

/** Pitch-class name as a musician would write it in this key. */
export function pcName(pc: number, flats: boolean): string {
  return (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];
}

/** Key names for the key picker: the common spelling of each tonic. */
export function keyName(key: NoteName, scale: ScaleType): string {
  return pcName(NOTE_NAMES.indexOf(key), prefersFlats(key, scale));
}

export function noteLabel(midi: number, flats: boolean): string {
  return `${pcName(midi, flats)}${Math.floor(midi / 12) - 1}`;
}

export function formatTime(t: number, fine = true): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${m}:${s.toString().padStart(2, '0')}`;
  return fine ? `${base}.${Math.floor((t % 1) * 100).toString().padStart(2, '0')}` : base;
}
