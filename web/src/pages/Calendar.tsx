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
  currencyFlag,
  beatMiss,
  formatCountdown,
} from '../utils/news';

const IMPACTS: NewsImpact[] = ['high', 'medium', 'low'];
const IMPACT_LABEL: Record<NewsImpact, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  holiday: 'Holiday',
};
const POLL_MS = 60_000; // client re-reads the server cache every minute
const TICK_MS = 30_000; // re-render countdowns / "now" line twice a minute

// The server container is Cloudflare-blocked from the ForexFactory feed, so the
// "Refresh now" button pings a small fetcher running on the host (residential
// IP), which pulls the feed and POSTs it to /api/news/ingest. Override the URL
// with VITE_NEWS_FETCHER_URL if the fetcher runs elsewhere.
const NEWS_FETCHER_URL =
  import.meta.env.VITE_NEWS_FETCHER_URL || 'http://localhost:4100/refresh';

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

// Impact rendered as a stack of bars (1–3), the way most calendars signal
// importance at a glance — clearer than a single dot.
function ImpactBars({ impact }: { impact: NewsImpact }) {
  const level = impact === 'high' ? 3 : impact === 'medium' ? 2 : impact === 'low' ? 1 : 0;
  const color = IMPACT_COLOR[impact];
  if (impact === 'holiday') {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
        title="Holiday"
      />
    );
  }
  return (
    <span className="inline-flex items-end gap-0.5" title={IMPACT_LABEL[impact]}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className="w-1 rounded-sm"
          style={{
            height: `${3 + n * 2}px`,
            backgroundColor: n <= level ? color : 'currentColor',
            opacity: n <= level ? 1 : 0.18,
          }}
        />
      ))}
    </span>
  );
}

function CurrencyCell({ ccy }: { ccy: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm leading-none">{currencyFlag(ccy)}</span>
      <span className="text-xs font-semibold text-slate-300">{ccy}</span>
    </span>
  );
}

function ActualCell({ e }: { e: NewsEvent }) {
  const released = new Date(e.dt).getTime() <= Date.now();
  const hasActual = e.actual != null && e.actual !== '';
  if (!hasActual) return <span className="text-slate-600">{released ? '—' : '·'}</span>;
  const dir = beatMiss(e.actual, e.forecast);
  const cls =
    dir === 'up'
      ? 'text-emerald-400'
      : dir === 'down'
        ? 'text-rose-400'
        : 'text-slate-100';
  return (
    <span className={`font-semibold ${cls}`}>
      {e.actual}
      {dir && <span className="ml-1 text-[10px]">{dir === 'up' ? '▲' : '▼'}</span>}
    </span>
  );
}

function EventRow({ e, isNext }: { e: NewsEvent; isNext: boolean }) {
  const released = new Date(e.dt).getTime() <= Date.now();
  return (
    <tr
      className={`border-t border-slate-800/60 transition-colors ${
        isNext
          ? 'bg-indigo-500/10'
          : released
            ? 'opacity-70 hover:bg-slate-800/30'
            : 'hover:bg-slate-800/30'
      }`}
    >
      <td className="num whitespace-nowrap py-2 pr-3 align-middle text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          {isNext && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
          )}
          {tzTimeLabel(e.dt)}
        </span>
      </td>
      <td className="py-2 pr-2 align-middle text-slate-500">
        <ImpactBars impact={e.impact} />
      </td>
      <td className="py-2 pr-3 align-middle">
        <CurrencyCell ccy={e.currency} />
      </td>
      <td className="py-2 pr-3 align-middle text-sm text-slate-200">
        {e.url ? (
          <a
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1 hover:text-indigo-300"
            title="Open on ForexFactory"
          >
            {e.title}
            <span className="text-[10px] text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
              ↗
            </span>
          </a>
        ) : (
          e.title
        )}
      </td>
      <td className="num whitespace-nowrap py-2 pr-3 text-right align-middle text-sm">
        <ActualCell e={e} />
      </td>
      <td className="num whitespace-nowrap py-2 pr-3 text-right align-middle text-xs text-slate-500">
        {e.forecast || '—'}
      </td>
      <td className="num whitespace-nowrap py-2 text-right align-middle text-xs text-slate-600">
        {e.previous || '—'}
      </td>
    </tr>
  );
}

function DaySection({
  dayKey,
  events,
  isToday,
  nextId,
}: {
  dayKey: string;
  events: NewsEvent[];
  isToday: boolean;
  nextId: string | null;
}) {
  const highCount = events.filter((e) => e.impact === 'high').length;
  return (
    <div className="card overflow-hidden">
      <div
        className={`sticky top-0 z-10 flex items-center justify-between px-4 py-2 backdrop-blur ${
          isToday ? 'bg-indigo-600/20' : 'bg-slate-900/85'
        }`}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          {weekdayLabel(dayKey)}
          {isToday && (
            <span className="rounded bg-indigo-600/30 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200">
              Today
            </span>
          )}
        </h3>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {highCount > 0 && (
            <span className="flex items-center gap-1 text-rose-400">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: IMPACT_COLOR.high }}
              />
              {highCount} high
            </span>
          )}
          <span>
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </span>
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
                <EventRow key={e.id} e={e} isNext={e.id === nextId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The "what's next" banner — the single most useful thing a trader wants from a
// calendar: the next high-impact release and a live countdown to it.
function NextEventBanner({ event, now }: { event: NewsEvent; now: number }) {
  const ms = new Date(event.dt).getTime() - now;
  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 border-indigo-500/30 bg-indigo-500/5 px-4 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
        Next up
      </span>
      <span className="flex items-center gap-2 text-sm text-slate-200">
        <ImpactBars impact={event.impact} />
        <span className="inline-flex items-center gap-1.5">
          <span className="leading-none">{currencyFlag(event.currency)}</span>
          <span className="font-semibold text-slate-300">{event.currency}</span>
        </span>
        <span className="font-medium">{event.title}</span>
      </span>
      <span className="ml-auto flex items-center gap-2 text-sm">
        <span className="text-xs text-slate-500">{tzTimeLabel(event.dt)}</span>
        <span className="num rounded-md bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-200">
          in {formatCountdown(ms)}
        </span>
      </span>
    </div>
  );
}

export default function Calendar() {
  const [view, setView] = useState<'week' | 'day'>('week');
  const [cursor, setCursor] = useState(todayKey());
  const [impacts, setImpacts] = useState<Set<NewsImpact>>(
    new Set<NewsImpact>(['high', 'medium'])
  );
  const [selCcy, setSelCcy] = useState<Set<string>>(new Set()); // empty = all
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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

  // Lightweight clock so countdowns and the next-event highlight stay live
  // without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const e of news.data ?? []) if (e.currency) set.add(e.currency);
    return [...set].sort();
  }, [news.data]);

  const q = query.trim().toLowerCase();

  // Bucket events into the visible day columns, applying client-side filters.
  const byDay = useMemo(() => {
    const map: Record<string, NewsEvent[]> = {};
    for (const k of days) map[k] = [];
    for (const e of news.data ?? []) {
      if (!impacts.has(e.impact)) continue;
      if (selCcy.size && !selCcy.has(e.currency)) continue;
      if (q && !e.title.toLowerCase().includes(q)) continue;
      const k = tzDayKey(e.dt);
      if (k in map) map[k].push(e);
    }
    for (const k of days) map[k].sort((a, b) => a.dt.localeCompare(b.dt));
    return map;
  }, [news.data, days, impacts, selCcy, q]);

  const today = todayKey();
  const totalShown = days.reduce((n, k) => n + byDay[k].length, 0);

  // Summary + "next up" derived from what's actually visible.
  const { counts, nextEvent } = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, holiday: 0 } as Record<
      NewsImpact,
      number
    >;
    let nextEvent: NewsEvent | null = null;
    for (const k of days) {
      for (const e of byDay[k]) {
        counts[e.impact]++;
        const t = new Date(e.dt).getTime();
        if (t > now && (!nextEvent || t < new Date(nextEvent.dt).getTime())) {
          nextEvent = e;
        }
      }
    }
    return { counts, nextEvent };
  }, [byDay, days, now]);

  const step = (dir: number) =>
    setCursor((c) => addDaysKey(c, dir * (view === 'week' ? 7 : 1)));

  const toggleImpact = (imp: NewsImpact) =>
    setImpacts((prev) => {
      const next = new Set(prev);
      next.has(imp) ? next.delete(imp) : next.add(imp);
      return next;
    });

  const toggleCcy = (c: string) =>
    setSelCcy((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });

  // Quick jumps used by the range chips.
  const goToday = () => {
    setView('day');
    setCursor(todayKey());
  };
  const goTomorrow = () => {
    setView('day');
    setCursor(addDaysKey(todayKey(), 1));
  };
  const goThisWeek = () => {
    setView('week');
    setCursor(todayKey());
  };
  const goNextWeek = () => {
    setView('week');
    setCursor(addDaysKey(todayKey(), 7));
  };

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      // Preferred path: the host fetcher pulls the feed and ingests it.
      const res = await fetch(NEWS_FETCHER_URL, { method: 'GET' });
      if (!res.ok) throw new Error(`fetcher HTTP ${res.status}`);
    } catch {
      // Fetcher not running → fall back to the server-side fetch (works only
      // if the server's own IP isn't blocked). Non-fatal either way.
      try {
        await api.refreshNews();
      } catch {
        /* ignore — nothing more we can do from the browser */
      }
    } finally {
      news.reload();
      status.reload();
      setRefreshing(false);
    }
  };

  const lastRefreshMs = parseServerTs(status.data?.last_refresh ?? null);
  const rangeLabel =
    view === 'week'
      ? `${weekdayLabel(days[0])} – ${weekdayLabel(days[6])}`
      : weekdayLabel(days[0]);

  const hasFilters = impacts.size < IMPACTS.length || selCcy.size > 0 || q !== '';
  const clearFilters = () => {
    setImpacts(new Set<NewsImpact>(['high', 'medium', 'low']));
    setSelCcy(new Set());
    setQuery('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Economic Calendar</h1>
          <p className="text-sm text-slate-500">
            High-impact news from ForexFactory · auto-updates as results release.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span
            className={`flex items-center gap-1 ${
              status.data?.auto ? 'text-emerald-400/80' : 'text-slate-500'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status.data?.auto ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            {status.data?.auto ? 'Auto' : 'Manual'}
          </span>
          <span>· updated {ago(lastRefreshMs)}</span>
          <button className="btn text-xs" onClick={refreshNow} disabled={refreshing}>
            {refreshing || status.data?.refreshing ? 'Refreshing…' : '↻ Refresh now'}
          </button>
        </div>
      </div>

      {/* Summary strip: impact counts for the range + next release countdown */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {IMPACTS.map((imp) => (
          <span
            key={imp}
            className="flex items-center gap-1.5 rounded-md bg-slate-900/60 px-2 py-1 text-slate-400"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: IMPACT_COLOR[imp] }}
            />
            <span className="num font-semibold text-slate-200">{counts[imp]}</span>
            {IMPACT_LABEL[imp].toLowerCase()}
          </span>
        ))}
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">
          <span className="num font-semibold text-slate-300">{totalShown}</span> shown
          this {view}
        </span>
      </div>

      {nextEvent && <NextEventBanner event={nextEvent} now={now} />}

      {/* Controls: view + navigation + quick ranges */}
      <div className="flex flex-wrap items-center gap-2">
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
          <button className="btn px-2 py-1 text-xs" onClick={() => setCursor(todayKey())}>
            Today
          </button>
          <button className="btn px-2 py-1 text-xs" onClick={() => step(1)}>
            ›
          </button>
        </div>
        <span className="text-sm text-slate-400">{rangeLabel}</span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {(
            [
              ['Today', goToday],
              ['Tomorrow', goTomorrow],
              ['This week', goThisWeek],
              ['Next week', goNextWeek],
            ] as const
          ).map(([label, fn]) => (
            <button
              key={label}
              onClick={fn}
              className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Controls: search + impact + currency filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            🔍
          </span>
          <input
            className="input py-1 pl-7 text-xs"
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

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

        {/* Currency chips — multi-select; empty = all */}
        {currencies.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {currencies.map((c) => {
              const on = selCcy.has(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCcy(c)}
                  className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs ${
                    on
                      ? 'border-indigo-500/50 bg-indigo-500/10 text-slate-100'
                      : 'border-slate-800 text-slate-500 hover:border-slate-600'
                  }`}
                  title={c}
                >
                  <span className="leading-none">{currencyFlag(c)}</span>
                  {c}
                </button>
              );
            })}
          </div>
        )}

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          >
            Clear
          </button>
        )}
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
            No events for this {view} at the selected filters.
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
                nextId={nextEvent?.id ?? null}
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
