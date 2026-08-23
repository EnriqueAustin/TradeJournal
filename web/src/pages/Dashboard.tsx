import { useMemo, useState } from 'react';
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
import { AsyncBoundary } from '../components/states';
import type { PropStats, EdgeScore } from '../types';
import { Link } from 'react-router-dom';
import {
  formatMoney,
  formatR,
  formatPct,
  formatNumber,
  signClass,
  DISPLAY_TZ,
} from '../utils/format';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    const color = pct >= 1 ? 'bg-red-500' : pct >= 0.8 ? 'bg-amber-500' : danger === false ? 'bg-indigo-500' : 'bg-emerald-500';
    return (
      <div className="min-w-[100px] flex-1">
        <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-500">
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
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px]">
              {p.dd_type === 'trailing' ? 'trailing' : 'static'} DD
            </span>
          )}
          {p.phase > 0 && (
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px]">
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
            unit === u ? 'bg-indigo-600 text-white' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
          }`}
        >
          {u === 'money' ? '$' : 'R'}
        </button>
      ))}
    </div>
  );
}

// Compact Edge Score badge (full breakdown lives on Analytics → Report Card).
function EdgeScoreChip({ score }: { score: EdgeScore }) {
  const col =
    score.total >= 70
      ? 'text-emerald-400 border-emerald-800/60 bg-emerald-950/30'
      : score.total >= 55
        ? 'text-amber-400 border-amber-800/60 bg-amber-950/30'
        : score.total >= 40
          ? 'text-orange-400 border-orange-800/60 bg-orange-950/30'
          : 'text-red-400 border-red-800/60 bg-red-950/30';
  return (
    <Link
      to="/analytics"
      title="Edge Score — see the full Report Card on Analytics"
      className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 ${col} transition hover:brightness-125`}
    >
      <span className="num text-2xl font-bold leading-none">{score.total}</span>
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wide opacity-70">Edge Score</span>
        <span className="text-xs font-semibold">
          Grade {score.grade}
          {!score.reliable && <span className="ml-1 opacity-60">· early</span>}
        </span>
      </span>
    </Link>
  );
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
      >
        {d && (
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
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
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
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
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
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
  const [unit, setUnit] = useState<'money' | 'r'>('money');

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
  const calendar = useApi(
    () => api.getCalendar(filters, month),
    [key, month]
  );
  const session = useApi(() => api.getSession(filters), [key]);
  const hourly = useApi(() => api.getHourly(filters), [key]);
  const prop = useApi(() => (isProp ? api.getProp(filters) : Promise.resolve(null)), [key, isProp]);

  const s = summary.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Performance across the selected filters.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <UnitToggle unit={unit} onChange={setUnit} />
          {reportCard.data?.score && <EdgeScoreChip score={reportCard.data.score} />}
        </div>
      </div>

      {/* Live open positions (rendered only when EA snapshot present) */}
      <LivePositions account={filters.account} currency={currency} />

      {/* Prop status banner */}
      {isProp && prop.data && <PropBanner p={prop.data} currency={currency} />}

      {/* Stat tiles */}
      <AsyncBoundary
        loading={summary.loading}
        error={summary.error}
        onRetry={summary.reload}
        loadingLabel="Loading summary…"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label={unit === 'r' ? 'Total R' : 'Net P&L'}
            value={unit === 'r' ? formatR(s?.total_r ?? null) : formatMoney(s?.net_pnl, currency)}
            valueClass={signClass(unit === 'r' ? s?.total_r ?? 0 : s?.net_pnl)}
            sub={unit === 'r' ? 'sum of R' : `Gross ${formatMoney(s?.gross_pnl, currency)}`}
          />
          <StatTile
            label="Win Rate"
            value={formatPct(s?.win_rate)}
            sub={`${s?.trade_count ?? 0} trades`}
          />
          <StatTile
            label="Profit Factor"
            value={s ? formatNumber(s.profit_factor, 2) : '—'}
            valueClass={
              s && s.profit_factor >= 1 ? 'text-emerald-400' : 'text-red-400'
            }
          />
          <StatTile
            label={unit === 'r' ? 'Expectancy (R)' : 'Expectancy'}
            value={unit === 'r' ? formatR(s?.avg_r) : formatMoney(s?.expectancy, currency)}
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
              s
                ? `${formatMoney(s.avg_win, currency)} / ${formatMoney(s.avg_loss, currency)}`
                : undefined
            }
          />
        </div>
      </AsyncBoundary>

      {/* Goals */}
      <GoalsCard account={filters.account ?? ''} currency={currency} />

      {/* Discipline — plan adherence + grades */}
      <DisciplineCard filters={filters} />

      {/* Equity curve */}
      <SectionCard
        title={unit === 'r' ? 'Equity Curve (R)' : 'Equity Curve'}
        right={<UnitToggle unit={unit} onChange={setUnit} />}
      >
        <AsyncBoundary
          loading={equity.loading}
          error={equity.error}
          onRetry={equity.reload}
          isEmpty={!equity.data || equity.data.length === 0}
          emptyMessage="No closed trades in range."
          loadingLabel="Loading equity…"
        >
          {equity.data && <EquityCurve data={equity.data} unit={unit} />}
        </AsyncBoundary>
      </SectionCard>

      {/* Calendar + Sessions */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard
          title="Monthly P&L"
          right={
            <input
              type="month"
              className="input py-1"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          }
        >
          <AsyncBoundary
            loading={calendar.loading}
            error={calendar.error}
            onRetry={calendar.reload}
            loadingLabel="Loading calendar…"
          >
            <Calendar
              month={month}
              days={calendar.data ?? []}
              currency={currency}
            />
          </AsyncBoundary>
        </SectionCard>

        <SectionCard title="Session Heatmap">
          <AsyncBoundary
            loading={session.loading}
            error={session.error}
            onRetry={session.reload}
            isEmpty={!session.data || session.data.length === 0}
            emptyMessage="No session data in range."
            loadingLabel="Loading sessions…"
          >
            {session.data && (
              <SessionHeatmap data={session.data} currency={currency} />
            )}
          </AsyncBoundary>
        </SectionCard>
      </div>

      {/* Market sessions clock */}
      <SectionCard
        title="Sessions"
        right={<span className="text-[10px] text-slate-500">local · {DISPLAY_TZ.split('/')[1]?.replace('_', ' ')}</span>}
      >
        <SessionsClock />
      </SectionCard>

      {/* Hourly */}
      <SectionCard title="Hourly P&L (UTC)">
        <AsyncBoundary
          loading={hourly.loading}
          error={hourly.error}
          onRetry={hourly.reload}
          isEmpty={!hourly.data || hourly.data.length === 0}
          emptyMessage="No hourly data in range."
          loadingLabel="Loading hourly…"
        >
          {hourly.data && <HourlyBars data={hourly.data} />}
        </AsyncBoundary>
      </SectionCard>

      {/* AI Review */}
      <AiReviewPanel />
    </div>
  );
}
