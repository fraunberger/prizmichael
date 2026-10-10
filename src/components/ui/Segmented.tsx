'use client';

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}

/** A row of mutually exclusive options, styled as one pill. */
export default function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 p-[2px] rounded-[8px] bg-paper-3">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`px-2.5 rounded-[6px] text-[12px] transition-colors ${
              on ? 'bg-card text-ink shadow-[var(--shadow-raised)]' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
