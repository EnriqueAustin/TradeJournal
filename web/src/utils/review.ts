import type { Filters } from '../types';

export type ReviewScope = 'day' | 'week';

export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the Mon–Sun week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return shiftDay(day, -((d.getUTCDay() + 6) % 7));
}

/** Inclusive [from, to] UTC date range a review scope covers. */
export function scopeRange(scope: ReviewScope, date: string): { from: string; to: string } {
  if (scope === 'week') {
    const from = mondayOf(date);
    return { from, to: shiftDay(from, 6) };
  }
  return { from: date, to: date };
}

/** Filters object scoped to one account and a date range, everything else All. */
export function rangeFilters(account: number | null, from: string, to: string): Filters {
  return {
    account,
    instrument: 'All',
    session: 'All',
    setup: 'All',
    from,
    to,
    rMin: '',
    rMax: '',
  };
}

export function reviewPath(scope: ReviewScope, date: string): string {
  return `/review/${scope}/${scope === 'week' ? mondayOf(date) : date}`;
}

export function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
