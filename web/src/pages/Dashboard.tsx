import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import StatTile from '../components/StatTile';
import EquityCurve from '../components/EquityCurve';
import Calendar from '../components/Calendar';
import SessionHeatmap from '../components/SessionHeatmap';
import HourlyBars from '../components/HourlyBars';
import AiReviewPanel from '../components/AiReviewPanel';
import LivePositions from '../components/LivePositions';
import { AsyncBoundary } from '../components/states';
import {
  formatMoney,
  formatR,
  formatPct,
  formatNumber,
  signClass,
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

export default function Dashboard() {
  const { filters, accounts } = useFilters();
  const [month, setMonth] = useState(currentMonth);

  const currency = useMemo(
    () => accounts.find((a) => a.id === filters.account)?.currency ?? 'USD',
    [accounts, filters.account]
  );

  const key = filterKey(filters);

  const summary = useApi(() => api.getSummary(filters), [key]);
  const equity = useApi(() => api.getEquity(filters), [key]);
  const calendar = useApi(
    () => api.getCalendar(filters, month),
    [key, month]
  );
  const session = useApi(() => api.getSession(filters), [key]);
  const hourly = useApi(() => api.getHourly(filters), [key]);

  const s = summary.data;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Performance across the selected filters.
        </p>
      </div>

      {/* Live open positions (rendered only when EA snapshot present) */}
      <LivePositions account={filters.account} currency={currency} />

      {/* Stat tiles */}
      <AsyncBoundary
        loading={summary.loading}
        error={summary.error}
        onRetry={summary.reload}
        loadingLabel="Loading summary…"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Net P&L"
            value={formatMoney(s?.net_pnl, currency)}
            valueClass={signClass(s?.net_pnl)}
            sub={`Gross ${formatMoney(s?.gross_pnl, currency)}`}
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
            label="Expectancy"
            value={formatMoney(s?.expectancy, currency)}
            valueClass={signClass(s?.expectancy)}
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

      {/* Equity curve */}
      <SectionCard title="Equity Curve">
        <AsyncBoundary
          loading={equity.loading}
          error={equity.error}
          onRetry={equity.reload}
          isEmpty={!equity.data || equity.data.length === 0}
          emptyMessage="No closed trades in range."
          loadingLabel="Loading equity…"
        >
          {equity.data && <EquityCurve data={equity.data} />}
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
