// Display helpers shared by the Reports (pivot) and Compare pages.
import { METRIC_META, type PivotMetric } from '../api/pivot';
import { DISPLAY_TZ, formatDuration, formatMoney, formatNumber, formatPct, formatR, sessionLabel } from './format';

export function formatMetric(m: PivotMetric, v: number | null | undefined, currency = 'USD'): string {
  if (v == null || Number.isNaN(v)) return '—';
  switch (METRIC_META[m].kind) {
    case 'money':
      return formatMoney(v, currency);
    case 'count':
      return String(v);
    case 'pct':
      return formatPct(v);
    case 'r':
      return formatR(v);
    case 'dur':
      return formatDuration(v);
    default:
      return formatNumber(v, 2);
  }
}

/** Stored hour keys are UTC; label them on the display clock. */
export function hourLabel(utcHour: number | string): string {
  const h = Number(utcHour);
  if (!Number.isFinite(h)) return String(utcHour);
  const d = new Date(Date.UTC(2026, 0, 5, h, 0, 0));
  const local = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: DISPLAY_TZ }).format(d);
  return `${local}:00`;
}

export const FIXED_DIMENSIONS: { value: string; label: string }[] = [
  { value: 'session', label: 'Session' },
  { value: 'setup', label: 'Setup' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'direction', label: 'Direction' },
  { value: 'hour', label: 'Hour of entry' },
  { value: 'weekday', label: 'Weekday' },
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'tag', label: 'Tag (all)' },
  { value: 'tag:mistake', label: 'Tag: mistake' },
  { value: 'tag:emotion', label: 'Tag: emotion' },
  { value: 'tag:setup', label: 'Tag: setup' },
  { value: 'tag:session', label: 'Tag: session' },
  { value: 'grade', label: 'Grade' },
  { value: 'emotion', label: 'Emotion (psych)' },
  { value: 'followed', label: 'Followed plan' },
];

/** Human label for a pivot group under a dimension. */
export function groupLabel(dim: string, key: string, label: string): string {
  if (dim === 'session') return sessionLabel(key);
  if (dim === 'hour') return key === '__none' ? '—' : hourLabel(key);
  if (dim === 'direction' || dim === 'emotion') return label.charAt(0).toUpperCase() + label.slice(1);
  return label;
}

/** Trades-page URL params for one group, or null when the page can't filter on it. */
export function drillParam(dim: string, key: string): [string, string] | null {
  if (key === '__none') return null;
  if (dim === 'session' || dim === 'instrument' || dim === 'setup' || dim === 'direction' || dim === 'hour' || dim === 'emotion')
    return [dim, key];
  if (dim === 'weekday') return ['dow', key];
  if (dim === 'followed') return ['followed', key];
  if (dim === 'tag' || dim === 'grade' || dim.startsWith('tag:')) return ['tag', key];
  return null;
}
