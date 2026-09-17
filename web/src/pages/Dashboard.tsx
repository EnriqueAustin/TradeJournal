import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import StatTile from '../components/StatTile';
import EquityCurve from '../components/EquityCurve';
import Calendar from '../components/Calendar';
import SessionHeatmap from '../components/SessionHeatmap';
import SessionsClock from '../components/SessionsClock';
import HourlyBars from '../components/HourlyBars';
import AiReviewPanel from '../components/AiReviewPanel';
import LivePositions from '../components/LivePositions';
import GoalsCard from '../components/GoalsCard';
import RecentTradesCard from '../components/RecentTradesCard';
import { EdgeScoreGauge } from '../components/ReportCard';
import InsightsCard from '../components/InsightsCard';
import { ReminderSettingsButton, ReviewReminderBanner } from '../components/ReviewReminders';
import { reviewPath, longDay } from '../utils/review';
import { AsyncBoundary } from '../components/states';
import type { PropStats } from '../types';
import { Link } from 'react-router-dom';
import {
  formatMoney,
  formatR,
  formatPct,
  formatNumber,
  signClass,
  DISPLAY_TZ,
} from '../utils/format';

const RECENT_TRADES = 8;

// UTC month, matching the server's realized-date buckets.
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function SectionCard({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function PropBanner({ p, currency }: { p: PropStats; currency: string }) {
  const hasLimits = p.day_loss_limit != null || p.max_dd_limit != null || p.target != null;
  if (!hasLimits) return null;

  const statusMap = {
    ok: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-400',
    warn: 'border-amber-800/60 bg-amber-950/30 text-amber-400',
    breach: 'border-red-800/60 bg-red-950/30 text-red-400',
  } as const;

  function MiniMeter({ label, pct, danger }: { label: string; pct: number | null; danger?: boolean }) {
    if (pct == null) return null;
    const w = Math.min(100, Math.max(0, pct * 100));
    const color = pct >= 1 ? 'bg-red-500' : pct >= 0.8 ? 'bg-amber-500' : danger === false ? 'bg-cyan-500' : 'bg-emerald-500';
    return (
      <div className="min-w-[100px] flex-1">
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-slate-500">
          <span>{label}</span>
          <span className="num">{formatPct(pct)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${statusMap[p.status]}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide">
            {p.status === 'ok' ? 'OK' : p.status === 'warn' ? 'Warning' : 'Breach'}
          </span>
          <span className="num text-xs opacity-70">
            Equity {formatMoney(p.current_equity, currency)}
          </span>
          {p.dd_type && (
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
              {p.dd_type === 'trailing' ? 'trailing' : 'static'} DD
            </span>
          )}
          {p.phase > 0 && (
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
              Phase {p.phase}
            </span>
          )}
        </div>
        <div className="flex flex-1 items-center gap-4">
          <MiniMeter label="Daily Loss" pct={p.day_loss_used_pct} />
          <MiniMeter label={`Max DD${p.dd_type === 'trailing' ? ' (trail)' : ''}`} pct={p.max_dd_used_pct} />
          <MiniMeter label="Target" pct={p.target_progress_pct} danger={false} />
        </div>
      </div>
    </div>
  );
}

// $ / R unit toggle — switches P&L-denominated tiles and the equity curve
// between money and R-multiples (risk units), the way rival journals do.
function UnitToggle({ unit, onChange }: { unit: 'money' | 'r'; onChange: (u: 'money' | 'r') => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-800">
      {(['money', 'r'] as const).map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          className={`px-2.5 py-1 text-xs font-semibold ${
            unit === u ? 'bg-cyan-600 text-white' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
          }`}
        >
          {u === 'money' ? '$' : 'R'}
        </button>
      ))}
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

// Discipline card — how often the plan was followed and whether following it
// actually pays. Data comes from trades.followed_plan + the 'grade' tag; both
// are set one-tap from the Post-trade Review on each trade.
function DisciplineCard({ filters }: { filters: ReturnType<typeof useFilters>['filters'] }) {
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
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Plan followed
              </div>
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
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Avg P&L: followed vs broke
              </div>
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
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                  Grades
                </div>
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

export default function Dashboard() {
  const { filters, accounts } = useFilters();
  const [month, setMonth] = useState(currentMonth);
  // The calendar and heatmap are also scoped by the date range, so a month
  // outside it would render empty. When the range moves off the picked month,
  // follow it to the range's last month.
  useEffect(() => {
    const fromM = filters.from ? filters.from.slice(0, 7) : '';
    const toM = filters.to ? filters.to.slice(0, 7) : '';
    setMonth((m) => {
      if (toM && m > toM) return toM;
      if (fromM && m < fromM) return toM || fromM;
      return m;
    });
  }, [filters.from, filters.to]);
  const [unit, setUnit] = useState<'money' | 'r'>('money');

  // "2026-08" → "August 2026", for cards that follow the month picker but don't
  // own one.
  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [month]);

  const currency = useMemo(
    () => accounts.find((a) => a.id === filters.account)?.currency ?? 'USD',
    [accounts, filters.account]
  );
  const isProp = useMemo(
    () => accounts.find((a) => a.id === filters.account)?.account_type === 'prop',
    [accounts, filters.account]
  );

  const key = filterKey(filters);

  const summary = useApi(() => api.getSummary(filters), [key]);
  const reportCard = useApi(() => api.getReportCard(filters), [key]);
  const equity = useApi(() => api.getEquity(filters), [key]);
  // Most recent trade matching the filters (trades sort newest-realized first).
  // The calendar + heatmap open on its month rather than the current one, which
  // is often empty; once the user picks a month by hand we stop following it.
  // Also feeds the Recent Trades widget.
  const latest = useApi(() => api.getTrades(filters, RECENT_TRADES, 0), [key]);
  const lastTradeMonth = useMemo(() => {
    const t = latest.data?.rows[0];
    return (t?.exit_time ?? t?.entry_time ?? '').slice(0, 7);
  }, [latest.data]);
  const monthPicked = useRef(false);
  useEffect(() => {
    if (lastTradeMonth && !monthPicked.current) setMonth(lastTradeMonth);
  }, [lastTradeMonth]);
  const pickMonth = (m: string) => {
    monthPicked.current = true;
    setMonth(m);
  };

  const calendar = useApi(
    () => api.getCalendar(filters, month),
    [key, month]
  );
  // Scoped to the same month as the calendar beside it, so the two cards always
  // describe the same period.
  const session = useApi(() => api.getSession(filters, month), [key, month]);
  const hourly = useApi(() => api.getHourly(filters), [key]);
  // Review queue: unreviewed trades (followed_plan unset) in the filters, newest
  // first, so the prompt can open the stepper on the latest day that needs it.
  const unreviewed = useApi(
    () => api.getTrades(filters, 1, 0, { needs: 'unreviewed' }),
    [key]
  );
  const unreviewedDay = (() => {
    const t = unreviewed.data?.rows[0];
    return (t?.exit_time ?? t?.entry_time ?? '').slice(0, 10) || null;
  })();
  const prop = useApi(() => (isProp ? api.getProp(filters) : Promise.resolve(null)), [key, isProp]);


  const s = summary.data;
  const score = reportCard.data?.score;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500">Performance across the selected filters.</p>
        </div>
        <div className="flex items-center gap-2">
          <ReminderSettingsButton />
          <UnitToggle unit={unit} onChange={setUnit} />
        </div>
      </div>

      <ReviewReminderBanner account={filters.account} profile={filters.profile ?? null} />

      {/* Live open positions (rendered only when EA snapshot present) */}
      <LivePositions account={filters.account} currency={currency} />

      {/* Prop status banner */}
      {isProp && prop.data && <PropBanner p={prop.data} currency={currency} />}

      {/* KPI row */}
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
          <StatTile
            label="Avg R"
            value={formatR(s?.avg_r)}
            valueClass={signClass(s?.avg_r)}
          />
          <StatTile
            label="Trade Count"
            value={s?.trade_count ?? 0}
            sub={
              s?.trade_count
                ? `${formatMoney(s.avg_win, currency)} / ${formatMoney(s.avg_loss, currency)}`
                : undefined
            }
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

      {/* Equity curve (wide) + Edge Score / discipline rail */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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

        <div className="grid grid-cols-1 content-start gap-4 lg:grid-cols-2 xl:grid-cols-1">
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
          <DisciplineCard filters={filters} />
        </div>
      </div>

      {/* Insights + review queue */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
      </div>

      {/* Calendar + recent trades */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard
          title="Monthly P&L"
          right={
            <div className="flex items-center gap-2">
              {lastTradeMonth && month !== lastTradeMonth && (
                <button
                  className="btn px-2 py-1 text-[11px]"
                  onClick={() => pickMonth(lastTradeMonth)}
                  title="Jump to the month of the most recent trade matching the filters"
                >
                  Last trading month
                </button>
              )}
              <input
                type="month"
                className="input py-1"
                value={month}
                onChange={(e) => pickMonth(e.target.value)}
              />
            </div>
          }
        >
          <AsyncBoundary
            loading={calendar.loading}
            error={calendar.error}
            onRetry={calendar.reload}
            loadingLabel="Loading calendar…"
            skeleton="table"
          >
            <Calendar
              month={month}
              days={calendar.data ?? []}
              currency={currency}
            />
          </AsyncBoundary>
        </SectionCard>

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
      </div>

      {/* Session heatmap + hourly P&L + sessions clock */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            {session.data && (
              <SessionHeatmap data={session.data} currency={currency} month={month} />
            )}
          </AsyncBoundary>
        </SectionCard>

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

        <SectionCard
          title="Sessions"
          className="lg:col-span-2"
          right={<span className="text-[11px] text-slate-500">local · {DISPLAY_TZ.split('/')[1]?.replace('_', ' ')}</span>}
        >
          <SessionsClock />
        </SectionCard>
      </div>

      {/* Goals + AI review */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <GoalsCard account={filters.account ?? ''} currency={currency} />
        <AiReviewPanel />
      </div>
    </div>
  );
}
