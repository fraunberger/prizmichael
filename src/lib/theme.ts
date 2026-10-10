'use client';

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();

function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('prizmiker-theme', theme); } catch { /* private mode */ }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light');
}

/** Design tokens resolved for canvas drawing (call at draw time). */
export interface Tokens {
  paper: string; paper2: string; paper3: string; card: string;
  ink: string; ink2: string; ink3: string; ink4: string;
  rule: string; rule2: string; accent: string; accentSoft: string;
  voices: [string, string, string, string];
  lead: string; dry: string; bass: string;
  rowIn: string; rowOut: string;
  keyWhite: string; keyBlack: string;
  fontDisplay: string; fontType: string;
}

export function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    paper: v('--paper'), paper2: v('--paper-2'), paper3: v('--paper-3'), card: v('--card'),
    ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), ink4: v('--ink-4'),
    rule: v('--rule'), rule2: v('--rule-2'), accent: v('--accent'), accentSoft: v('--accent-soft'),
    voices: [v('--v1'), v('--v2'), v('--v3'), v('--v4')],
    lead: v('--lead'), dry: v('--dry'), bass: v('--bass'),
    rowIn: v('--row-in'), rowOut: v('--row-out'),
    keyWhite: v('--key-white'), keyBlack: v('--key-black'),
    fontDisplay: v('--ff-display') || 'Optima, sans-serif',
    fontType: v('--ff-type') || 'Courier New, monospace',
  };
}

/** Same color with a new alpha; accepts #rrggbb. */
export function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
