import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import type { NewsEvent, NewsImpact } from '../types';
import {
  IMPACT_COLOR,
  tzDayKey,
  tzTimeLabel,
  addDaysKey,
  mondayOf,
  weekdayLabel,
  todayKey,
  parseNewsValue,
} from '../utils/news';

const IMPACTS: NewsImpact[] = ['high', 'medium', 'low'];
const IMPACT_LABEL: Record<NewsImpact, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  holiday: 'Holiday',
};
const POLL_MS = 60_000; // client re-reads the server cache every minute

function parseServerTs(s: string | null): number | null {
  if (!s) return null;
  // SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS" in UTC.
  const t = new Date(`${s.replace(' ', 'T')}Z`).getTime();
  return Number.isFinite(t) ? t : null;
}

function ago(ms: number | null): string {
  if (ms == null) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Neutral beat/miss arrow — no good/bad judgement (that's indicator-specific).
function ValueDelta({ actual, forecast }: { actual: string | null; forecast: string | null }) {
  const a = parseNewsValue(actual);
  const f = parseNewsValue(forecast);
  if (a == null || f == null || a === f) return null;
  return (
    <span className="ml-1 text-[10px] text-slate-500">{a > f ? '▲' : '▼'}</span>
  );
}

function ImpactDot({ impact }: { impact: NewsImpact }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: IMPACT_COLOR[impact] }}
      title={IMPACT_LABEL[impact]}
    />
  );
}

function EventRow({ e }: { e: NewsEvent }) {
  const released = new Date(e.dt).getTime() <= Date.now();
  const hasActual = e.actual != null && e.actual !== '';
  return (
    <tr className={`border-t border-slate-800/60 ${released ? '' : 'opacity-90'}`}>
      <td className="num whitespace-nowrap py-2 pr-3 align-top text-xs text-slate-400">
        {tzTimeLabel(e.dt)}
      </td>
      <td className="py-2 pr-2 align-top">
        <ImpactDot impact={e.impact} />
      </td>
      <td className="py-2 pr-3 align-top text-xs font-semibold text-slate-300">
        {e.currency}
      </td>
      <td className="py-2 pr-3 align-top text-sm text-slate-200">{e.title}</td>
      <td className="num whitespace-nowrap py-2 pr-3 text-right align-top text-sm">
        {hasActual ? (
          <span className="font-semibold text-slate-100">
            {e.actual}
            <ValueDelta actual={e.actual} forecast={e.forecast} />
          </span>
        ) : (
          <span className="text-slate-600">{released ? '—' : '·'}</span>
        )}
      </td>
      <td className="num whitespace-nowrap py-2 pr-3 text-right align-top text-xs text-slate-500">
        {e.forecast || '—'}
      </td>
      <td className="num whitespace-nowrap py-2 text-right align-top text-xs text-slate-600">
        {e.previous || '—'}
      </td>
    </tr>
  );
}

function DaySection({
  dayKey,
  events,
  isToday,
}: {
  dayKey: string;
  events: NewsEvent[];
  isToday: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-2 ${
          isToday ? 'bg-indigo-600/15' : 'bg-slate-900/60'
        }`}
      >
        <h3 className="text-sm font-semibold text-slate-200">
          {weekdayLabel(dayKey)}
          {isToday && (
            <span className="ml-2 rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200">
              Today
            </span>
          )}
        </h3>
        <span className="text-xs text-slate-500">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-500">No events.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-600">
                <th className="px-0 py-1 pl-4 font-medium">Time</th>
                <th className="py-1 font-medium"></th>
                <th className="py-1 font-medium">Ccy</th>
                <th className="py-1 font-medium">Event</th>
                <th className="py-1 pr-3 text-right font-medium">Actual</th>
                <th className="py-1 pr-3 text-right font-medium">Forecast</th>
                <th className="py-1 pr-4 text-right font-medium">Previous</th>
              </tr>
            </thead>
            <tbody className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4">
              {events.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Calendar() {
  const [view, setView] = useState<'week' | 'day'>('week');
  const [cursor, setCursor] = useState(todayKey());
  const [impacts, setImpacts] = useState<Set<NewsImpact>>(
    new Set<NewsImpact>(['high', 'medium'])
  );
  const [currency, setCurrency] = useState(''); // '' = all
  const [refreshing, setRefreshing] = useState(false);

  const days = useMemo(() => {
    if (view === 'day') return [cursor];
    const mon = mondayOf(cursor);
    return Array.from({ length: 7 }, (_, i) => addDaysKey(mon, i));
  }, [view, cursor]);

  // Query a ±1-day padded UTC window (display tz can shift a local day across
  // the UTC boundary) and bucket into local days on the client.
  const from = `${addDaysKey(days[0], -1)}T00:00:00.000Z`;
  const to = `${addDaysKey(days[days.length - 1], 1)}T00:00:00.000Z`;

  const news = useApi<NewsEvent[]>(() => api.getNews({ from, to }), [from, to]);
  const status = useApi(() => api.getNewsStatus(), []);

  // Poll the server cache so actuals appear as ForexFactory publishes them,
  // and re-read whenever the tab regains focus (covers wake-from-sleep).
  useEffect(() => {
    const tick = () => {
      news.reload();
      status.reload();
    };
    const id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const e of news.data ?? []) if (e.currency) set.add(e.currency);
    return [...set].sort();
  }, [news.data]);

  // Bucket events into the visible day columns, applying client-side filters.
  const byDay = useMemo(() => {
    const map: Record<string, NewsEvent[]> = {};
    for (const k of days) map[k] = [];
    for (const e of news.data ?? []) {
      if (!impacts.has(e.impact)) continue;
      if (currency && e.currency !== currency) continue;
      const k = tzDayKey(e.dt);
      if (k in map) map[k].push(e);
    }
    for (const k of days) map[k].sort((a, b) => a.dt.localeCompare(b.dt));
    return map;
  }, [news.data, days, impacts, currency]);

  const today = todayKey();
  const totalShown = days.reduce((n, k) => n + byDay[k].length, 0);

  const step = (dir: number) =>
    setCursor((c) => addDaysKey(c, dir * (view === 'week' ? 7 : 1)));

  const toggleImpact = (imp: NewsImpact) =>
    setImpacts((prev) => {
      const next = new Set(prev);
      next.has(imp) ? next.delete(imp) : next.add(imp);
      return next;
    });

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await api.refreshNews();
      news.reload();
      status.reload();
    } catch {
      /* non-fatal — the scheduler will catch up */
    } finally {
      setRefreshing(false);
    }
  };

  const lastRefreshMs = parseServerTs(status.data?.last_refresh ?? null);
  const rangeLabel =
    view === 'week'
      ? `${weekdayLabel(days[0])} – ${weekdayLabel(days[6])}`
      : weekdayLabel(days[0]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Economic Calendar</h1>
          <p className="text-sm text-slate-500">
            High-impact news from ForexFactory · auto-updates as results release.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
            {status.data?.auto ? '● Auto' : '○ Manual'} · updated{' '}
            {ago(lastRefreshMs)}
          </span>
          <button className="btn text-xs" onClick={refreshNow} disabled={refreshing}>
            {refreshing || status.data?.refreshing ? 'Refreshing…' : '↻ Refresh now'}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-slate-700">
            {(['week', 'day'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-semibold uppercase ${
                  view === v
                    ? 'bg-indigo-600/20 text-indigo-300'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button className="btn px-2 py-1 text-xs" onClick={() => step(-1)}>
              ‹
            </button>
            <button
              className="btn px-2 py-1 text-xs"
              onClick={() => setCursor(todayKey())}
            >
              Today
            </button>
            <button className="btn px-2 py-1 text-xs" onClick={() => step(1)}>
              ›
            </button>
          </div>
          <span className="text-sm text-slate-400">{rangeLabel}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {IMPACTS.map((imp) => {
            const on = impacts.has(imp);
            return (
              <button
                key={imp}
                onClick={() => toggleImpact(imp)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                  on
                    ? 'border-slate-600 text-slate-200'
                    : 'border-slate-800 text-slate-600'
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: on ? IMPACT_COLOR[imp] : 'transparent',
                    boxShadow: on ? 'none' : `inset 0 0 0 1px ${IMPACT_COLOR[imp]}`,
                  }}
                />
                {IMPACT_LABEL[imp]}
              </button>
            );
          })}
          <select
            className="input py-1 text-xs"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="">All currencies</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AsyncBoundary
        loading={news.loading && !news.data}
        // Keep showing cached data if a background poll fails; only surface the
        // full error screen when we have nothing to show yet.
        error={news.data ? null : news.error}
        onRetry={news.reload}
        loadingLabel="Loading calendar…"
      >
        {totalShown === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500">
            No events for this {view} at the selected impact levels.
            <div className="mt-1 text-xs text-slate-600">
              ForexFactory publishes roughly this and next week; older weeks show
              only what the app has already cached.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {days.map((k) => (
              <DaySection
                key={k}
                dayKey={k}
                events={byDay[k]}
                isToday={k === today}
              />
            ))}
          </div>
        )}
      </AsyncBoundary>

      {news.data && news.error && (
        <p className="text-[11px] text-amber-500/80">
          Showing cached data — last refresh didn’t reach the server.
        </p>
      )}
      {status.data?.last_error && (
        <p className="text-[11px] text-amber-500/80">
          Last server refresh error: {status.data.last_error}
        </p>
      )}
    </div>
  );
}
