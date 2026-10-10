'use client';

import { RefObject, useEffect, useRef } from 'react';
import { useStudio } from '@/context/StudioContext';
import { xToTime } from '@/lib/timeline';

/**
 * Wheel/trackpad navigation shared by every lane:
 * ⌘/ctrl + wheel (or pinch) zooms around the pointer, horizontal swipes and
 * shift + wheel scroll time. `plainZooms` makes a bare vertical wheel zoom too
 * (for the ruler); otherwise it's left alone so lanes can scroll vertically.
 */
export function useTimelineWheel(ref: RefObject<HTMLElement | null>, width: number, plainZooms = false): void {
  const { view, zoom, pan } = useStudio();
  const latest = useRef({ view, zoom, pan, width });
  useEffect(() => { latest.current = { view, zoom, pan, width }; });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { view: v, zoom: z, pan: p, width: w } = latest.current;
      const span = v.end - v.start;
      const rect = el.getBoundingClientRect();
      const anchor = xToTime(e.clientX - rect.left, v, w);
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
      if (e.ctrlKey || e.metaKey || (plainZooms && !horizontal)) {
        e.preventDefault();
        z(Math.exp(e.deltaY * 0.0045), anchor);
      } else if (horizontal) {
        e.preventDefault();
        const d = e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) ? e.deltaY : e.deltaX;
        p((d / Math.max(1, w)) * span * 1.2);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, plainZooms]);
}
