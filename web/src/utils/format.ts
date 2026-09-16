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
  // Always a fraction (0.5 = 50%). Every caller passes one; guessing "already a
  // percent" for |v| > 1 rendered a 120% DD breach or 150% target as "1.2%".
  return `${(v * 100).toFixed(1)}%`;
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

// Human labels for the stored session codes. The DB/filter values stay short
// ('ny', 'london', …); this is purely the display name. 'overlap' is legacy.
export const SESSION_LABELS: Record<string, string> = {
  asia: 'Asia',
  london: 'London',
  ny: 'New York',
  overlap: 'Overlap',
  off: 'Off-Hours',
};

export function sessionLabel(s?: string | null): string {
  if (!s) return '';
  if (s === 'All') return 'All';
  return SESSION_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

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

// Offset (minutes) of a zone at a given UTC instant, such that
// local-wall-clock = UTC + offset. Uses Intl to read the zone's own clock.
function tzOffsetMinutes(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return (asUtc - utcMs) / 60000;
}

// Convert a datetime-local value ("YYYY-MM-DDTHH:mm", zoneless wall clock the
// user reads on-screen) into a true UTC ISO string, interpreting the wall time
// in DISPLAY_TZ. This is what the rest of the app stores and derives sessions
// from — appending a bare "Z" (as the old code did) mislabels the wall clock as
// UTC and lands the trade hours off, into the wrong session.
export function wallTimeToUtcIso(local: string, tz: string = DISPLAY_TZ): string | null {
  if (!local) return null;
  const [datePart, timePart = '00:00'] = local.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = tzOffsetMinutes(tz, guess);
  return new Date(guess - offset * 60000).toISOString();
}

// Short zone abbreviation (e.g. "SAST") for labelling time inputs.
export function tzAbbrev(tz: string = DISPLAY_TZ): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
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
