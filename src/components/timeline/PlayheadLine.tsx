'use client';

import { useRef } from 'react';
import { usePlayhead } from '@/hooks/usePlayhead';
import { TimeView } from '@/context/StudioContext';
import { timeToX } from '@/lib/timeline';

/** A DOM playhead moved per frame, so lanes don't redraw their canvases while playing. */
export default function PlayheadLine({ view, width, head = false }: { view: TimeView; width: number; head?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  usePlayhead(t => {
    const node = el.current;
    if (!node) return;
    const x = timeToX(t, view, width);
    const visible = t >= view.start && t <= view.end && width > 0;
    node.style.transform = `translateX(${x}px)`;
    node.style.opacity = visible ? '1' : '0';
  });
  return (
    <div ref={el} className="pointer-events-none absolute top-0 bottom-0 left-0 w-0 z-20" style={{ opacity: 0 }}>
      <div className="absolute top-0 bottom-0 -left-[0.75px] w-[1.5px] bg-accent" />
      {head && (
        <div
          className="absolute -top-px -left-[5px] w-0 h-0"
          style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid var(--accent)' }}
        />
      )}
    </div>
  );
}
