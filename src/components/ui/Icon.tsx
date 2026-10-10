/** Hairline icons drawn to sit next to Optima at 12–13px. */
const PATHS: Record<string, React.ReactNode> = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="4.25" y="3.5" width="2.5" height="9" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="9.25" y="3.5" width="2.5" height="9" rx="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  start: (
    <>
      <path d="M12 4v8L6.5 8z" fill="currentColor" stroke="none" />
      <path d="M4.5 4v8" />
    </>
  ),
  loop: (
    <>
      <path d="M3.5 9.5V8a3 3 0 0 1 3-3H12" />
      <path d="M10.5 3.2 12.3 5l-1.8 1.8" />
      <path d="M12.5 6.5V8a3 3 0 0 1-3 3H4" />
      <path d="M5.5 12.8 3.7 11l1.8-1.8" />
    </>
  ),
  rec: <circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" />,
  undo: (
    <>
      <path d="M5.5 5H10a3 3 0 0 1 0 6H6" />
      <path d="M7.5 2.8 5.3 5l2.2 2.2" />
    </>
  ),
  redo: (
    <>
      <path d="M10.5 5H6a3 3 0 0 0 0 6h4" />
      <path d="M8.5 2.8 10.7 5 8.5 7.2" />
    </>
  ),
  open: (
    <>
      <path d="M8 10.5V3" />
      <path d="M5.2 5.6 8 2.8l2.8 2.8" />
      <path d="M3 9.5v2.7c0 .5.4.8.8.8h8.4c.4 0 .8-.3.8-.8V9.5" />
    </>
  ),
  export: (
    <>
      <path d="M8 2.8v7.5" />
      <path d="M5.2 7.6 8 10.4l2.8-2.8" />
      <path d="M3 9.5v2.7c0 .5.4.8.8.8h8.4c.4 0 .8-.3.8-.8V9.5" />
    </>
  ),
  moon: <path d="M12.5 9.6A5 5 0 0 1 6.4 3.5a5 5 0 1 0 6.1 6.1z" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
    </>
  ),
  sparkle: <path d="M8 2.5 9.2 6.8 13.5 8 9.2 9.2 8 13.5 6.8 9.2 2.5 8 6.8 6.8z" />,
  midi: (
    <>
      <rect x="2.5" y="4" width="11" height="8" rx="1.2" />
      <path d="M5 4v4.5M8 4v4.5M11 4v4.5" />
    </>
  ),
  trash: (
    <>
      <path d="M3.5 4.5h9" />
      <path d="M6.5 4.5V3.2h3v1.3" />
      <path d="M4.7 4.5 5.3 13h5.4l.6-8.5" />
    </>
  ),
  chevron: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  keys: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
      <path d="M5 3.5v5.5M8 3.5v5.5M11 3.5v5.5" />
    </>
  ),
};

export default function Icon({ name, size = 16, className }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
