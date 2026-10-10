/** Shared geometry for the timeline lanes so they all line up. */
import { TimeView } from '@/context/StudioContext';

export const GUTTER = 66; // px, left column for keys / lane labels

export function timeToX(t: number, view: TimeView, width: number): number {
  return GUTTER + ((t - view.start) / (view.end - view.start)) * (width - GUTTER);
}

export function xToTime(x: number, view: TimeView, width: number): number {
  return view.start + ((x - GUTTER) / Math.max(1, width - GUTTER)) * (view.end - view.start);
}

const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];

/** Tick spacing that keeps labels at least ~70px apart. */
export function tickStep(view: TimeView, width: number, minPx = 70): { major: number; minor: number } {
  const pxPerSec = (width - GUTTER) / (view.end - view.start);
  const major = STEPS.find(s => s * pxPerSec >= minPx) ?? 300;
  const minor = major >= 1 && major <= 2 ? major / 4 : major / 5;
  return { major, minor };
}

export function tickLabel(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const sec = s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0');
  return `${m}:${sec}`;
}

/** Visit tick times within the view. */
export function forEachTick(view: TimeView, step: number, fn: (t: number) => void): void {
  const first = Math.ceil(view.start / step - 1e-9) * step;
  for (let t = first; t <= view.end + 1e-9; t += step) fn(Math.round(t / step) * step);
}
