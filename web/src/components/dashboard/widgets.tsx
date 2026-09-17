import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useApi, filterKey } from '../../hooks/useApi';
import type { useFilters } from '../../store/FilterContext';
import StatTile from '../StatTile';
import EquityCurve from '../EquityCurve';
import Calendar from '../Calendar';
import YearCalendar from '../YearCalendar';
import SessionHeatmap from '../SessionHeatmap';
import SessionsClock from '../SessionsClock';
import HourlyBars from '../HourlyBars';
import AiReviewPanel from '../AiReviewPanel';
import GoalsCard from '../GoalsCard';
import RecentTradesCard from '../RecentTradesCard';
import { EdgeScoreGauge } from '../ReportCard';
import InsightsCard from '../InsightsCard';
import DayTradesModal from '../DayTradesModal';
import { AsyncBoundary } from '../states';
import { reviewPath, longDay } from '../../utils/review';
import type { ReportCard, StatsSummary, TradesResponse } from '../../types';
import {
  formatMoney,
  formatR,
  formatPct,
  formatNumber,
  signClass,
  DISPLAY_TZ,
} from '../../utils/format';
import { DailyNetPnlChart, IntradayPnlChart } from './DailyPnlCharts';

type Filters = ReturnType<typeof useFilters>['filters'];
type Async<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

/** Everything the widgets share, owned by the Dashboard page. */
export interface DashboardCtx {
  filters: Filters;
  fkey: string;
  currency: string;
  unit: 'money' | 'r';
  month: string;
  monthLabel: string;
  pickMonth: (m: string) => void;
  lastTradeMonth: string;
  summary: Async<StatsSummary>;
  reportCard: Async<ReportCard>;
  latest: Async<TradesResponse>;
}

const Ctx = createContext<DashboardCtx | null>(null);
export const DashboardProvider = Ctx.Provider;
function useDash(): DashboardCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('dashboard widgets need a DashboardProvider');
  return c;
}

export function SectionCard({
  title,
  right,
  children,
  className = '',
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card h-full p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

// Edge Score tint by band — shared by the KPI tile and the side card.
function edgeClass(total: number): string {
  return total >= 70
    ? 'text-emerald-400'
    : total >= 55
      ? 'text-amber-400'
      : total >= 40
        ? 'text-orange-400'
        : 'text-red-400';
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

// ---------------- widgets ----------------

function KpiWidget() {
  const { summary, reportCard, unit, currency } = useDash();
  const s = summary.data;
  const score = reportCard.data?.score;
  return (
    <AsyncBoundary
      loading={summary.loading}
      error={summary.error}
      onRetry={summary.reload}
      loadingLabel="Loading summary…"
      skeleton="tiles"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatTile
          label={unit === 'r' ? 'Total R' : 'Net P&L'}
          value={unit === 'r' ? formatR(s?.total_r ?? null) : formatMoney(s?.net_pnl, currency)}
          valueClass={signClass(unit === 'r' ? s?.total_r ?? 0 : s?.net_pnl)}
          sub={unit === 'r' ? 'sum of R' : `Gross ${formatMoney(s?.gross_pnl, currency)}`}
        />
        <StatTile
          label="Win Rate"
          value={s?.trade_count ? formatPct(s.win_rate) : '—'}
          sub={`${s?.trade_count ?? 0} trades`}
        />
        <StatTile
          label="Profit Factor"
          // null = no losing trades in range: infinite PF, not a bad one.
          value={!s || s.trade_count === 0 ? '—' : s.profit_factor == null ? (s.avg_win > 0 ? '∞' : '—') : formatNumber(s.profit_factor, 2)}
          valueClass={
            !s || s.trade_count === 0 || (s.profit_factor == null && !(s.avg_win > 0))
              ? 'text-slate-200'
              : s.profit_factor == null || s.profit_factor >= 1
                ? 'text-emerald-400'
                : 'text-red-400'
          }
        />
        <StatTile
          label={unit === 'r' ? 'Expectancy (R)' : 'Expectancy'}
          value={unit === 'r' ? formatR(s?.avg_r) : s?.trade_count ? formatMoney(s.expectancy, currency) : '—'}
          valueClass={signClass(unit === 'r' ? s?.avg_r : s?.expectancy)}
          sub="per trade"
        />
        <StatTile label="Avg R" value={formatR(s?.avg_r)} valueClass={signClass(s?.avg_r)} />
        <StatTile
          label="Trade Count"
          value={s?.trade_count ?? 0}
          sub={s?.trade_count ? `${formatMoney(s.avg_win, currency)} / ${formatMoney(s.avg_loss, currency)}` : undefined}
        />
        <Link
          to="/analytics"
          title="Edge Score — see the full Report Card on Analytics"
          className="block transition hover:brightness-110"
        >
          <StatTile
            label="Edge Score"
            value={score ? score.total : '—'}
            valueClass={score ? edgeClass(score.total) : 'text-slate-200'}
            sub={score ? `Grade ${score.grade}${score.reliable ? '' : ' · early'}` : undefined}
          />
        </Link>
      </div>
    </AsyncBoundary>
  );
}

function EquityWidget() {
  const { filters, fkey, unit } = useDash();
  const equity = useApi(() => api.getEquity(filters), [fkey]);
  return (
    <SectionCard title={unit === 'r' ? 'Cumulative P&L (R)' : 'Cumulative P&L'}>
      <AsyncBoundary
        loading={equity.loading}
        error={equity.error}
        onRetry={equity.reload}
        isEmpty={!equity.data || equity.data.length === 0}
        emptyMessage="No closed trades in range."
        loadingLabel="Loading equity…"
        skeleton="chart"
      >
        {equity.data && <EquityCurve data={equity.data} unit={unit} className="h-72" />}
      </AsyncBoundary>
    </SectionCard>
  );
}

function EdgeWidget() {
  const { reportCard } = useDash();
  const score = reportCard.data?.score;
  return (
    <SectionCard
      title="Edge Score"
      right={
        <Link to="/analytics" className="text-xs text-cyan-400 hover:underline">
          Report card →
        </Link>
      }
    >
      <AsyncBoundary
        loading={reportCard.loading}
        error={reportCard.error}
        onRetry={reportCard.reload}
        isEmpty={!score}
        emptyMessage="Not enough trades to score yet."
        loadingLabel="Loading score…"
        skeleton="tiles"
      >
        {score && <EdgeScoreGauge score={score} />}
      </AsyncBoundary>
    </SectionCard>
  );
}

// Discipline card — how often the plan was followed and whether following it
// actually pays. Data comes from trades.followed_plan + the 'grade' tag; both
// are set one-tap from the Post-trade Review on each trade.
function DisciplineWidget() {
  const { filters } = useDash();
  const key = filterKey(filters);
  const { data, loading, error, reload } = useApi(() => api.getDiscipline(filters), [key]);
  const d = data;
  const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
  return (
    <SectionCard
      title="Discipline"
      right={
        d && d.reviewed > 0 ? (
          <span className="num text-xs text-slate-400">
            {d.reviewed}/{d.total} reviewed
          </span>
        ) : undefined
      }
    >
      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!d || d.reviewed === 0}
        emptyMessage="No reviews yet — grade a trade and flag whether you followed your plan on its detail page."
        loadingLabel="Loading discipline…"
        skeleton="tiles"
      >
        {d && (
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Plan followed</div>
              <div
                className={`num text-2xl font-bold ${
                  (d.followed_pct ?? 0) >= 0.7
                    ? 'text-emerald-400'
                    : (d.followed_pct ?? 0) >= 0.4
                      ? 'text-amber-400'
                      : 'text-red-400'
                }`}
              >
                {d.followed_pct == null ? '—' : formatPct(d.followed_pct)}
              </div>
              <div className="text-[11px] text-slate-500">
                {d.followed} followed · {d.broken} broke
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Avg P&L: followed vs broke</div>
              <div className="mt-1 flex items-center gap-3 text-sm">
                <span className={signClass(d.avg_net_followed)}>
                  {d.avg_net_followed == null ? '—' : formatMoney(d.avg_net_followed)}
                </span>
                <span className="text-slate-600">/</span>
                <span className={signClass(d.avg_net_broken)}>
                  {d.avg_net_broken == null ? '—' : formatMoney(d.avg_net_broken)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">per trade</div>
            </div>
            {d.graded > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Grades</div>
                <div className="flex items-end gap-1.5">
                  {gradeOrder.map((g) => {
                    const n = d.grades[g] ?? 0;
                    return (
                      <div key={g} className="flex flex-col items-center gap-1">
                        <span className="num text-xs text-slate-300">{n || ''}</span>
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded text-xs font-semibold ${
                            n === 0
                              ? 'bg-slate-800 text-slate-600'
                              : g === 'A' || g === 'B'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : g === 'C'
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-red-500/15 text-red-300'
                          }`}
                        >
                          {g}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </AsyncBoundary>
    </SectionCard>
  );
}

function InsightsWidget() {
  return (
    <SectionCard
      title="Insights"
      right={
        <Link to="/analytics" className="text-xs text-cyan-400 hover:underline">
          All insights →
        </Link>
      }
    >
      <InsightsCard limit={5} />
    </SectionCard>
  );
}

function ReviewQueueWidget() {
  const { filters, fkey } = useDash();
  // Unreviewed trades (followed_plan unset) in the filters, newest first, so
  // the prompt can open the stepper on the latest day that needs it.
  const unreviewed = useApi(() => api.getTrades(filters, 1, 0, { needs: 'unreviewed' }), [fkey]);
  const t = unreviewed.data?.rows[0];
  const unreviewedDay = (t?.exit_time ?? t?.entry_time ?? '').slice(0, 10) || null;
  return (
    <SectionCard title="Review queue">
      {unreviewed.data && unreviewed.data.total > 0 && unreviewedDay ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="num text-3xl font-bold text-amber-400">{unreviewed.data.total}</div>
            <div className="text-sm text-slate-400">
              unreviewed trade{unreviewed.data.total === 1 ? '' : 's'} in range
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={reviewPath('day', unreviewedDay)} className="btn btn-primary text-xs">
              Review {longDay(unreviewedDay)} →
            </Link>
            <Link to={reviewPath('week', unreviewedDay)} className="btn text-xs">
              Review week
            </Link>
            <Link to="/trades?needs=unreviewed" className="btn text-xs">
              List
            </Link>
          </div>
        </div>
      ) : unreviewed.loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <p className="text-sm text-emerald-400">✓ Every trade in range is reviewed.</p>
      )}
    </SectionCard>
  );
}

const CAL_VIEW_KEY = 'trade-journal:dashboard-calendar-view';

function CalendarWidget() {
  const { filters, fkey, currency, month, pickMonth, lastTradeMonth } = useDash();
  const [view, setView] = useState<'month' | 'year'>(() => readPref(CAL_VIEW_KEY, ['month', 'year'] as const, 'month'));
  useEffect(() => writePref(CAL_VIEW_KEY, view), [view]);

  const [year, setYear] = useState(() => Number(month.slice(0, 4)) || new Date().getUTCFullYear());
  // Follow the month picker / last-trade month into the year view.
  useEffect(() => {
    const y = Number(month.slice(0, 4));
    if (y) setYear(y);
  }, [month]);

  const monthCal = useApi(
    () => (view === 'month' ? api.getCalendar(filters, month) : Promise.resolve(null)),
    [fkey, month, view]
  );
  // The year's days, still inside the filter date range.
  const yearFilters = useMemo(() => {
    const yFrom = `${year}-01-01`;
    const yTo = `${year}-12-31`;
    return {
      ...filters,
      from: filters.from && filters.from > yFrom ? filters.from : yFrom,
      to: filters.to && filters.to < yTo ? filters.to : yTo,
    };
  }, [filters, year]);
  const yearCal = useApi(
    () => (view === 'year' ? api.getCalendar(yearFilters, '') : Promise.resolve(null)),
    [fkey, year, view]
  );
  const thisYear = new Date().getUTCFullYear();
  const active = view === 'month' ? monthCal : yearCal;

  return (
    <SectionCard
      title={view === 'year' ? `${year} P&L` : 'Monthly P&L'}
      right={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-800 text-[11px]">
            {(['month', 'year'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-1 font-semibold capitalize ${
                  view === v ? 'bg-cyan-600 text-white' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'month' ? (
            <>
              {lastTradeMonth && month !== lastTradeMonth && (
                <button
                  className="btn px-2 py-1 text-[11px]"
                  onClick={() => pickMonth(lastTradeMonth)}
                  title="Jump to the month of the most recent trade matching the filters"
                >
                  Last trading month
                </button>
              )}
              <input type="month" className="input py-1" value={month} onChange={(e) => pickMonth(e.target.value)} />
            </>
          ) : (
            <div className="flex items-center gap-1">
              <button className="btn px-2 py-1 text-xs" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
                ‹
              </button>
              <select className="input py-1 text-xs" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {Array.from({ length: Math.max(6, thisYear - Math.min(year, thisYear) + 2) }, (_, i) => thisYear + 1 - i).map(
                  (y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  )
                )}
              </select>
              <button
                className="btn px-2 py-1 text-xs"
                onClick={() => setYear((y) => y + 1)}
                disabled={year >= thisYear + 1}
                aria-label="Next year"
              >
                ›
              </button>
            </div>
          )}
        </div>
      }
    >
      <AsyncBoundary
        loading={active.loading}
        error={active.error}
        onRetry={active.reload}
        loadingLabel="Loading calendar…"
        skeleton="table"
      >
        {view === 'month' ? (
          <Calendar month={month} days={monthCal.data ?? []} currency={currency} />
        ) : (
          <YearCalendar
            year={year}
            days={yearCal.data ?? []}
            currency={currency}
            onPickMonth={(ym) => {
              pickMonth(ym);
              setView('month');
            }}
          />
        )}
      </AsyncBoundary>
    </SectionCard>
  );
}

function RecentTradesWidget() {
  const { latest, currency } = useDash();
  return (
    <SectionCard
      title="Recent Trades"
      right={
        <Link to="/trades" className="text-xs text-cyan-400 hover:underline">
          All trades →
        </Link>
      }
    >
      <AsyncBoundary
        loading={latest.loading}
        error={latest.error}
        onRetry={latest.reload}
        loadingLabel="Loading trades…"
        skeleton="table"
      >
        <RecentTradesCard rows={latest.data?.rows ?? []} currency={currency} />
      </AsyncBoundary>
    </SectionCard>
  );
}

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function IntradayWidget() {
  const { filters, fkey, unit, currency } = useDash();
  const days = useApi(() => api.getCalendar(filters, ''), [fkey]);
  const traded = useMemo(() => (days.data ?? []).filter((d) => d.trade_count > 0), [days.data]);
  const [picked, setPicked] = useState<string | null>(null);
  // Defaults to the last trading day in range; a stale pick outside the new
  // filter range falls back to it too.
  const day =
    picked && (!filters.from || picked >= filters.from) && (!filters.to || picked <= filters.to)
      ? picked
      : traded[traded.length - 1]?.day ?? null;

  const eq = useApi(
    () => (day ? api.getEquity({ ...filters, from: day, to: day }) : Promise.resolve([])),
    [fkey, day]
  );
  const idx = day ? traded.findIndex((d) => d.day === day) : -1;
  // Nearest traded days either side (works for a picked day with no trades too).
  const prev = day ? [...traded].reverse().find((d) => d.day < day)?.day : undefined;
  const next = day ? traded.find((d) => d.day > day)?.day : undefined;

  const stats = useMemo(() => {
    const pts = eq.data ?? [];
    let wins = 0;
    let losses = 0;
    let last = 0;
    let peak = 0;
    let trough = 0;
    for (const p of pts) {
      const v = unit === 'r' ? p.cum_r ?? 0 : p.cum_pnl;
      if (v > last) wins++;
      else if (v < last) losses++;
      last = v;
      peak = Math.max(peak, v);
      trough = Math.min(trough, v);
    }
    return { net: last, n: pts.length, wins, losses, peak, trough };
  }, [eq.data, unit]);
  const fmt = (v: number) => (unit === 'r' ? formatR(v) : formatMoney(v, currency));

  return (
    <SectionCard
      title="Intraday P&L"
      right={
        <div className="flex items-center gap-1">
          <button className="btn px-2 py-1 text-xs" disabled={!prev} onClick={() => prev && setPicked(prev)} aria-label="Previous trading day">
            ‹
          </button>
          <input
            type="date"
            className="input py-1 text-xs"
            value={day ?? ''}
            onChange={(e) => setPicked(e.target.value || null)}
          />
          <button className="btn px-2 py-1 text-xs" disabled={!next} onClick={() => next && setPicked(next)} aria-label="Next trading day">
            ›
          </button>
          {day && (
            <Link to={`/journal?day=${day}`} className="ml-1 text-xs text-cyan-400 hover:underline">
              Journal →
            </Link>
          )}
        </div>
      }
    >
      <AsyncBoundary
        loading={days.loading || eq.loading}
        error={days.error || eq.error}
        onRetry={() => {
          days.reload();
          eq.reload();
        }}
        isEmpty={!day || !eq.data || eq.data.length === 0}
        emptyMessage={day ? `No closed trades on ${shortDay(day)}.` : 'No closed trades in range.'}
        loadingLabel="Loading day…"
        skeleton="chart"
      >
        <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-500">
          {day && <span className="text-slate-400">{shortDay(day)}</span>}
          <span>
            Net <span className={`num text-sm font-semibold ${signClass(stats.net)}`}>{fmt(stats.net)}</span>
          </span>
          <span className="num">
            {stats.n}t · <span className="text-emerald-400">{stats.wins}W</span> /{' '}
            <span className="text-red-400">{stats.losses}L</span>
          </span>
          <span className="num" title="Best and worst running P&L through the day">
            high <span className="text-emerald-400">{fmt(stats.peak)}</span> · low{' '}
            <span className="text-red-400">{fmt(stats.trough)}</span>
          </span>
          {idx >= 0 && (
            <span className="ml-auto text-[11px]">
              day {idx + 1} of {traded.length}
            </span>
          )}
        </div>
        <IntradayPnlChart points={eq.data ?? []} unit={unit} currency={currency} />
        <p className="mt-1 text-[11px] text-slate-500">
          Running net P&L at each close · times {DISPLAY_TZ.split('/')[1]?.replace('_', ' ')}
        </p>
      </AsyncBoundary>
    </SectionCard>
  );
}

function DailyBarsWidget() {
  const { filters, fkey, unit, currency } = useDash();
  const days = useApi(() => api.getCalendar(filters, ''), [fkey]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const traded = useMemo(() => (days.data ?? []).filter((d) => d.trade_count > 0), [days.data]);
  const sum = useMemo(() => {
    const val = (d: (typeof traded)[number]) => (unit === 'r' ? d.r ?? 0 : d.net_pnl);
    return {
      total: traded.reduce((s, d) => s + val(d), 0),
      green: traded.filter((d) => val(d) > 0).length,
      red: traded.filter((d) => val(d) < 0).length,
    };
  }, [traded, unit]);
  const fmt = (v: number) => (unit === 'r' ? formatR(v) : formatMoney(v, currency));
  return (
    <SectionCard
      title="Daily net P&L"
      right={
        traded.length > 0 ? (
          <span className="num text-xs text-slate-500">
            {traded.length}d · <span className="text-emerald-400">{sum.green}</span>/
            <span className="text-red-400">{sum.red}</span> ·{' '}
            <span className={`font-semibold ${signClass(sum.total)}`}>{fmt(sum.total)}</span>
          </span>
        ) : undefined
      }
    >
      <AsyncBoundary
        loading={days.loading}
        error={days.error}
        onRetry={days.reload}
        isEmpty={traded.length === 0}
        emptyMessage="No closed trades in range."
        loadingLabel="Loading days…"
        skeleton="chart"
      >
        <DailyNetPnlChart days={traded} unit={unit} currency={currency} onPickDay={setOpenDay} height={250} />
        <p className="mt-1 text-[11px] text-slate-500">Bars: each day's net · area: cumulative (right axis) · click a bar for its trades</p>
      </AsyncBoundary>
      {openDay && <DayTradesModal day={openDay} currency={currency} onClose={() => setOpenDay(null)} />}
    </SectionCard>
  );
}

function HeatmapWidget() {
  const { filters, fkey, currency, month, monthLabel } = useDash();
  // Scoped to the same month as the calendar, so the two cards describe the
  // same period.
  const session = useApi(() => api.getSession(filters, month), [fkey, month]);
  return (
    <SectionCard
      title="Session Heatmap"
      right={
        <span className="text-xs text-slate-500" title="Follows the Monthly P&L month">
          {monthLabel}
        </span>
      }
    >
      <AsyncBoundary
        loading={session.loading}
        error={session.error}
        onRetry={session.reload}
        isEmpty={!session.data || session.data.length === 0}
        emptyMessage={`No session data for ${monthLabel}.`}
        loadingLabel="Loading sessions…"
        skeleton="table"
      >
        {session.data && <SessionHeatmap data={session.data} currency={currency} month={month} />}
      </AsyncBoundary>
    </SectionCard>
  );
}

function HourlyWidget() {
  const { filters, fkey } = useDash();
  const hourly = useApi(() => api.getHourly(filters), [fkey]);
  return (
    <SectionCard title="Hourly P&L (UTC)">
      <AsyncBoundary
        loading={hourly.loading}
        error={hourly.error}
        onRetry={hourly.reload}
        isEmpty={!hourly.data || hourly.data.length === 0}
        emptyMessage="No hourly data in range."
        loadingLabel="Loading hourly…"
        skeleton="chart"
      >
        {hourly.data && <HourlyBars data={hourly.data} />}
      </AsyncBoundary>
    </SectionCard>
  );
}

function SessionsWidget() {
  return (
    <SectionCard
      title="Sessions"
      right={<span className="text-[11px] text-slate-500">local · {DISPLAY_TZ.split('/')[1]?.replace('_', ' ')}</span>}
    >
      <SessionsClock />
    </SectionCard>
  );
}

function GoalsWidget() {
  const { filters, currency } = useDash();
  return <GoalsCard account={filters.account ?? ''} currency={currency} />;
}

function AiWidget() {
  return <AiReviewPanel />;
}

// ---------------- registry ----------------

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  Component: () => JSX.Element;
  /** lg+ column span on the 12-col grid at normal size (class spelled out for Tailwind). */
  span: string;
  /** Normal size is already full width — no wide toggle. */
  full?: boolean;
  defaultHidden?: boolean;
}

/** Registry order = the default layout (matches the pre-widget dashboard). */
export const WIDGETS: WidgetDef[] = [
  { id: 'kpis', title: 'Key stats', description: 'Net P&L, win rate, PF, expectancy, Edge Score', Component: KpiWidget, span: 'lg:col-span-12', full: true },
  { id: 'equity', title: 'Cumulative P&L', description: 'Equity curve over the filtered range', Component: EquityWidget, span: 'lg:col-span-8' },
  { id: 'edge', title: 'Edge Score', description: 'Report-card gauge', Component: EdgeWidget, span: 'lg:col-span-4' },
  { id: 'discipline', title: 'Discipline', description: 'Plan adherence and grades', Component: DisciplineWidget, span: 'lg:col-span-4' },
  { id: 'insights', title: 'Insights', description: 'Automatic pattern call-outs', Component: InsightsWidget, span: 'lg:col-span-8' },
  { id: 'review', title: 'Review queue', description: 'Unreviewed trades', Component: ReviewQueueWidget, span: 'lg:col-span-4' },
  { id: 'calendar', title: 'P&L calendar', description: 'Month or year heatmap', Component: CalendarWidget, span: 'lg:col-span-7' },
  { id: 'recent', title: 'Recent trades', description: 'Latest trades in range', Component: RecentTradesWidget, span: 'lg:col-span-5' },
  { id: 'intraday', title: 'Intraday P&L', description: 'Cumulative P&L through one trading day', Component: IntradayWidget, span: 'lg:col-span-6' },
  { id: 'daily', title: 'Daily net P&L', description: 'Daily bars with cumulative area', Component: DailyBarsWidget, span: 'lg:col-span-6' },
  { id: 'heatmap', title: 'Session heatmap', description: 'Session × instrument for the calendar month', Component: HeatmapWidget, span: 'lg:col-span-6' },
  { id: 'hourly', title: 'Hourly P&L', description: 'Net P&L by hour', Component: HourlyWidget, span: 'lg:col-span-6' },
  { id: 'sessions', title: 'Sessions clock', description: 'Market session times', Component: SessionsWidget, span: 'lg:col-span-12', full: true },
  { id: 'goals', title: 'Goals', description: 'Targets and progress', Component: GoalsWidget, span: 'lg:col-span-6' },
  { id: 'ai', title: 'AI review', description: 'AI coach review', Component: AiWidget, span: 'lg:col-span-6' },
];
