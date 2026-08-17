// Signal timezone lens.
//
// All Signal data is stored as epoch-millisecond UTC (see server schema.js:6).
// This module is the single place that converts those instants into wall-clock
// strings for display. Default is Africa/Johannesburg (SAST, UTC+2, no DST) to
// match the rest of the app (utils/format.ts DISPLAY_TZ); the user can override
// it from the terminal header and the choice persists in localStorage.
import { useEffect, useState } from 'react';
import { DISPLAY_TZ } from '../../../utils/format';

const STORAGE_KEY = 'signal.tz';
const EVENT = 'signal-tz-change';

// Curated IANA zones surfaced in the header picker. `label` is what the user
// sees; the value is the IANA id passed to Intl.
export const TZ_OPTIONS: { value: string; label: string }[] = [
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Frankfurt', label: 'Frankfurt' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
];

export function getSignalTz(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch {
    /* localStorage unavailable (SSR / privacy mode) — fall through */
  }
  return DISPLAY_TZ;
}

export function setSignalTz(tz: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, tz);
  } catch {
    /* ignore persistence failure — still broadcast for this session */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tz }));
}

// React hook: current tz, re-rendering any component when the user switches it.
export function useSignalTz(): string {
  const [tz, setTz] = useState(getSignalTz);
  useEffect(() => {
    const onChange = () => setTz(getSignalTz());
    window.addEventListener(EVENT, onChange);
    // cross-tab: another tab changing the setting fires a storage event
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return tz;
}

// Short zone abbreviation ("SAST", "GMT+2", "EDT") for labelling times.
export function tzAbbr(ts: number, tz: string = getSignalTz()): string {
  // Prefer a friendly name for the home zone; Intl returns "GMT+2" for it.
  if (tz === 'Africa/Johannesburg') return 'SAST';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date(ts));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

// HH:mm in the selected zone. `withZone` appends the abbreviation.
export function fmtTime(ts: number, tz: string = getSignalTz(), withZone = false): string {
  const t = new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  });
  return withZone ? `${t} ${tzAbbr(ts, tz)}` : t;
}

// HH:mm:ss — for the live header clock.
export function fmtClock(ts: number, tz: string = getSignalTz()): string {
  const t = new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
  });
  return `${t} ${tzAbbr(ts, tz)}`;
}

// "Fri, Aug 14" style header, computed in the selected zone.
export function fmtDate(ts: number, tz: string = getSignalTz()): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });
}

// "Aug 14, '26" compact date for tables.
export function fmtShortDate(ts: number, tz: string = getSignalTz()): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: tz,
  });
}

// Sortable YYYY-MM-DD *in the selected zone* — the grouping/"today" key. Using
// the zone here (not UTC) is what keeps late-night events on the correct day.
export function dayKey(ts: number, tz: string = getSignalTz()): string {
  // en-CA renders as YYYY-MM-DD.
  return new Date(ts).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  });
}
