import type { UTCTimestamp } from 'lightweight-charts';
import type { ChartMarker } from '../components/CandleChart';
import type { NewsEvent, NewsImpact } from '../types';
import { DISPLAY_TZ } from './format';

// --- Calendar day/time helpers (all in the app's display timezone) ---
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const weekdayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});

/** YYYY-MM-DD for an ISO instant, in the display timezone. */
export function tzDayKey(iso: string): string {
  return dayKeyFmt.format(new Date(iso));
}

/** HH:mm for an ISO instant, in the display timezone. */
export function tzTimeLabel(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** A stable Date at noon UTC for a YYYY-MM-DD key (DST-safe day math). */
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

export function addDaysKey(key: string, n: number): string {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0=Sun … 6=Sat for a day key. */
export function weekdayOf(key: string): number {
  return keyToDate(key).getUTCDay();
}

/** Monday of the week containing `key`. */
export function mondayOf(key: string): string {
  const back = (weekdayOf(key) + 6) % 7;
  return addDaysKey(key, -back);
}

/** Human label like "Mon 04 Aug" for a day key. */
export function weekdayLabel(key: string): string {
  return weekdayFmt.format(keyToDate(key));
}

/** Today's day key in the display timezone. */
export function todayKey(): string {
  return dayKeyFmt.format(new Date());
}

/** Loose numeric parse of a calendar value ("0.2%", "1.2M", "-3") → number. */
export function parseNewsValue(s: string | null): number | null {
  if (s == null || s === '') return null;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

// Impact → colour used for chart markers and list badges.
export const IMPACT_COLOR: Record<NewsImpact, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#64748b',
  holiday: '#6366f1',
};

export const IMPACT_RANK: Record<NewsImpact, number> = {
  high: 3,
  medium: 2,
  low: 1,
  holiday: 0,
};

// Currency → flag emoji + readable name, for the calendar's country column.
// The ForexFactory feed keys events by the 3-letter currency code.
export const CURRENCY_FLAG: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  AUD: '🇦🇺',
  NZD: '🇳🇿',
  CAD: '🇨🇦',
  CHF: '🇨🇭',
  CNY: '🇨🇳',
  HKD: '🇭🇰',
  SGD: '🇸🇬',
  SEK: '🇸🇪',
  NOK: '🇳🇴',
  MXN: '🇲🇽',
  ZAR: '🇿🇦',
  INR: '🇮🇳',
  BRL: '🇧🇷',
  KRW: '🇰🇷',
  ALL: '🌐',
};

export function currencyFlag(ccy: string): string {
  return CURRENCY_FLAG[(ccy || '').toUpperCase()] || '🏳️';
}

/**
 * Raw beat/miss of an actual vs its forecast. Neutral direction — 'up' just
 * means actual > forecast (not "good"); the reader decides what that means for
 * a given indicator. Returns null when either value isn't numeric or they tie.
 */
export function beatMiss(
  actual: string | null,
  forecast: string | null
): 'up' | 'down' | null {
  const a = parseNewsValue(actual);
  const f = parseNewsValue(forecast);
  if (a == null || f == null || a === f) return null;
  return a > f ? 'up' : 'down';
}

/** "2h 15m" / "15m" / "45s" / "now" — compact countdown for a future instant. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Which currencies are relevant to a traded instrument, so overlays aren't
// swamped by unrelated events. XAUUSD/US100 are USD-driven.
export function currenciesForInstrument(instrument: string): string[] | null {
  const s = (instrument || '').toUpperCase();
  if (s.includes('XAU') || s.includes('GOLD')) return ['USD'];
  if (s.includes('US100') || s.includes('NAS') || s.includes('US30') || s.includes('SPX'))
    return ['USD'];
  // forex: both legs (EURUSD → EUR, USD)
  const m = s.match(/^([A-Z]{3})([A-Z]{3})/);
  if (m) return [m[1], m[2]];
  return null; // unknown → don't filter
}

function toTs(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

/**
 * Convert news events into below-bar chart markers, coloured by impact.
 * Only high/medium by default keeps the timeline readable.
 */
export function newsToMarkers(
  events: NewsEvent[],
  minImpact: NewsImpact = 'medium'
): ChartMarker[] {
  const floor = IMPACT_RANK[minImpact];
  return events
    .filter((e) => IMPACT_RANK[e.impact] >= floor)
    .map((e) => ({
      time: toTs(e.dt),
      position: 'belowBar' as const,
      color: IMPACT_COLOR[e.impact],
      shape: 'circle' as const,
      text: e.currency || '•',
    }));
}
