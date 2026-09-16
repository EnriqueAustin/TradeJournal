import { useMemo, useSyncExternalStore } from 'react';

// Light/dark theme. The resolved theme lives on <html data-theme>, which
// index.css keys its palette off; index.html sets it before first paint. A
// saved choice (localStorage) wins, otherwise we follow the OS preference —
// live, until the user picks one explicitly.

export type Theme = 'light' | 'dark';

const KEY = 'tj-theme';
const listeners = new Set<() => void>();

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(t: Theme) {
  if (document.documentElement.getAttribute('data-theme') !== t) {
    document.documentElement.setAttribute('data-theme', t);
  }
  listeners.forEach((l) => l());
}

export function getTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode — still switch for this session */
  }
  apply(t);
}

if (typeof window !== 'undefined') {
  apply(saved() ?? systemTheme());
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (!saved()) apply(systemTheme());
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'dark');
}

/** Resolved colours for canvas/SVG charts that can't read CSS vars themselves
 *  (lightweight-charts, recharts props). Re-read whenever the theme changes. */
export interface ChartTheme {
  text: string;
  textHi: string;
  muted: string;
  grid: string;
  border: string;
  crosshair: string;
  crosshairLabel: string;
  tooltipBg: string;
  tooltipBorder: string;
  cursor: string;
  pos: string;
  neg: string;
  accent: string;
  accentFillTop: string;
  accentFillBottom: string;
  track: string;
  fontMono: string;
}

export function chartTheme(t: Theme): ChartTheme {
  return t === 'light'
    ? {
        text: '#4c5b55',
        textHi: '#0b1411',
        muted: '#67766f',
        grid: 'rgba(120,135,130,0.18)',
        border: 'rgba(120,135,130,0.45)',
        crosshair: '#67766f',
        crosshairLabel: '#4c5b55',
        tooltipBg: '#ffffff',
        tooltipBorder: '#c5cfcb',
        cursor: 'rgba(76,91,85,0.08)',
        pos: '#12994a',
        neg: '#d63a3a',
        accent: '#4f46e5',
        accentFillTop: 'rgba(79,70,229,0.22)',
        accentFillBottom: 'rgba(79,70,229,0.02)',
        track: '#e6ebe9',
        fontMono: '"JetBrains Mono", ui-monospace, monospace',
      }
    : {
        text: '#94a3b8',
        textHi: '#e2e8f0',
        muted: '#64748b',
        grid: 'rgba(51,65,85,0.3)',
        border: 'rgba(51,65,85,0.6)',
        crosshair: '#64748b',
        crosshairLabel: '#334155',
        tooltipBg: '#0f172a',
        tooltipBorder: '#334155',
        cursor: 'rgba(148,163,184,0.08)',
        pos: '#22c55e',
        neg: '#ef4444',
        accent: '#6366f1',
        accentFillTop: 'rgba(99,102,241,0.35)',
        accentFillBottom: 'rgba(99,102,241,0.02)',
        track: '#1e293b',
        fontMono: '"JetBrains Mono", ui-monospace, monospace',
      };
}

export function useChartTheme(): ChartTheme {
  const t = useTheme();
  return useMemo(() => chartTheme(t), [t]);
}

/** The theme-dependent part of a lightweight-charts options object. Pass to
 *  createChart and again to chart.applyOptions when the theme flips — the
 *  canvas doesn't see CSS changes. */
export function lwcThemeOptions(c: ChartTheme) {
  return {
    layout: { textColor: c.text, fontFamily: c.fontMono },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border },
    crosshair: {
      vertLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel },
      horzLine: { color: c.crosshair, labelBackgroundColor: c.crosshairLabel },
    },
  };
}
