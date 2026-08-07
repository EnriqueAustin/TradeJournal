export function formatMoney(v: number | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const num = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = currencySymbol(currency);
  return `${sign}${symbol}${num}`;
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return '';
  }
}

export function formatR(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  // Accept either fraction (0-1) or already-percent (0-100)
  const pct = v <= 1 && v >= -1 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

export function formatNumber(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function signClass(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0)
    return 'text-slate-300';
  return v > 0 ? 'text-pos' : 'text-neg';
}

// Display timezone for all times. Data is stored in UTC; this is purely the
// lens. South Africa (UTC+2, no DST) matches the user's wall clock.
export const DISPLAY_TZ = 'Africa/Johannesburg';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DISPLAY_TZ,
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: DISPLAY_TZ,
  });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—';
  const r = Math.round(sec);
  if (r < 60) return `${r}s`;
  const m = Math.floor(r / 60);
  if (m < 60) return `${m}m ${r % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
