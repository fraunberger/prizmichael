/**
 * The mark: one beam of voice into a prism, four colored voices out.
 */
export default function PrismMark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  const rays = [
    { y: 9.5, color: 'var(--v4)' },
    { y: 13, color: 'var(--v3)' },
    { y: 16.5, color: 'var(--v2)' },
    { y: 20, color: 'var(--v1)' },
  ];
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 45 28" fill="none" aria-hidden="true">
      <line x1="0.5" y1="16" x2="13.2" y2="14.6" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" />
      {rays.map((r, i) => (
        <line
          key={i}
          className={animated ? 'prism-ray' : undefined}
          x1="22.5"
          y1={14.6}
          x2="44"
          y2={r.y + (i - 1.5) * 1.6}
          stroke={r.color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ))}
      <path d="M17.5 3 L28.5 24 L6.5 24 Z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="13.2" y1="14.6" x2="22.5" y2="14.6" stroke="var(--ink-3)" strokeWidth="0.9" strokeDasharray="1.2 1.4" />
    </svg>
  );
}
