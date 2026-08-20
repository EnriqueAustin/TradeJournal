import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import HoldTimeBars from '../components/HoldTimeBars';
import OptimizerHeatmap from '../components/OptimizerHeatmap';
import { formatNumber, formatPct, formatDuration, formatMoney, signClass } from '../utils/format';
import type { ExcursionStats, WickEdgeStats, WickEdgeRow } from '../types';

// Pretty labels for the wick-edge grouping keys.
const WICK_KEY_LABELS: Record<string, string> = {
  asian_high: 'Asian High', asian_low: 'Asian Low',
  london_high: 'London High', london_low: 'London Low',
  pdh: 'Prev Day High', pdl: 'Prev Day Low', ny_open: 'NY Open',
  equal_highs: 'Equal Highs', equal_lows: 'Equal Lows', other: 'Other',
  asia: 'Asia', london: 'London', ny: 'New York', off: 'Off-hours',
  clean: 'Clean sweep', fakeout: 'Faked out first', unset: 'Untagged',
};

function WickEdgeTable({ title, rows }: { title: string; rows: WickEdgeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-3 font-medium">Group</th>
              <th className="py-1.5 px-3 text-right font-medium">N</th>
              <th className="py-1.5 px-3 text-right font-medium">Win%</th>
              <th className="py-1.5 px-3 text-right font-medium">Net P&L</th>
              <th className="py-1.5 px-3 text-right font-medium">Avg R</th>
              <th className="py-1.5 pl-3 text-right font-medium">Avg Fill%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-800/60">
                <td className="py-1.5 pr-3 text-slate-200">{WICK_KEY_LABELS[r.key] ?? r.key}</td>
                <td className="num py-1.5 px-3 text-right text-slate-400">{r.count}</td>
                <td className="num py-1.5 px-3 text-right text-slate-300">{formatPct(r.win_rate)}</td>
                <td className={`num py-1.5 px-3 text-right font-semibold ${signClass(r.net_pnl)}`}>
                  {formatMoney(r.net_pnl)}
                </td>
                <td className={`num py-1.5 px-3 text-right ${r.avg_r == null ? 'text-slate-500' : signClass(r.avg_r)}`}>
                  {r.avg_r == null ? '—' : formatNumber(r.avg_r, 2)}
                </td>
                <td className="num py-1.5 pl-3 text-right text-slate-400">
                  {r.avg_fill == null ? '—' : `${formatNumber(r.avg_fill, 0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WickEdgePanel({ data }: { data: WickEdgeStats }) {
  if (data.total === 0) {
    return (
      <p className="text-sm text-slate-500">
        No wick-tagged trades match the filters. Tag a trade's liquidity swept,
        session and wick fill on its detail page (Wick-Fill Setup) to build this.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <WickEdgeTable title="By liquidity swept" rows={data.by_level} />
      <WickEdgeTable title="By session" rows={data.by_session} />
      <WickEdgeTable title="Clean vs fakeout" rows={data.by_fakeout} />
      <p className="text-xs text-slate-500">
        {data.total} tagged trade{data.total === 1 ? '' : 's'}. Which sweep, session
        and fill actually pays — the edge inside the setup.
      </p>
    </div>
  );
}

function SectionCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass = 'text-slate-100',
  sub,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num mt-1 text-lg font-semibold ${valueClass}`}>{value}</div>
      {sub != null && <div className="num mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ExcursionPanel({ e }: { e: ExcursionStats }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Avg MAE · Winners"
          value={e.avg_mae_winners == null ? '—' : formatNumber(e.avg_mae_winners, 2)}
          valueClass="text-emerald-400"
          sub="favourable trades"
        />
        <Metric
          label="Avg MAE · Losers"
          value={e.avg_mae_losers == null ? '—' : formatNumber(e.avg_mae_losers, 2)}
          valueClass="text-red-400"
          sub="how deep losers went against"
        />
        <Metric
          label="Avg MFE · Winners"
          value={e.avg_mfe_winners == null ? '—' : formatNumber(e.avg_mfe_winners, 2)}
          valueClass="text-emerald-400"
        />
        <Metric
          label="Avg MFE · Losers"
          value={e.avg_mfe_losers == null ? '—' : formatNumber(e.avg_mfe_losers, 2)}
          valueClass="text-amber-400"
          sub="give-back on losers"
        />
      </div>
      <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-500/80">
          Gave back a 1R winner
        </div>
        <div className="num mt-1 text-2xl font-semibold text-amber-300">
          {e.hit_1r_mfe === 0 ? '—' : `${e.hit_1r_mfe_then_lost} / ${e.hit_1r_mfe}`}
        </div>
        <div className="num mt-0.5 text-xs text-slate-400">
          {e.hit_1r_mfe_then_lost_pct == null
            ? 'No trades reached +1R MFE (needs a stop price to define risk).'
            : `${formatPct(
                e.hit_1r_mfe_then_lost_pct
              )} of trades that reached +1R of favourable excursion still finished at/below break-even.`}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        MAE/MFE are price-distance excursions recorded per trade. Sample:{' '}
        {e.mae_sample} with MAE, {e.mfe_sample} with MFE. Populate them on the
        Trade detail page or via the EA/import to enrich this panel.
      </p>
    </div>
  );
}

export default function Analytics() {
  const { filters } = useFilters();
  const key = filterKey(filters);
  const holdtime = useApi(() => api.getHoldtime(filters), [key]);
  const excursion = useApi(() => api.getExcursion(filters), [key]);
  const wickEdge = useApi(() => api.getWickEdge(filters), [key]);
  const [slGrid, setSlGrid] = useState('0.5,0.75,1,1.25,1.5,2');
  const [tpGrid, setTpGrid] = useState('1,1.5,2,2.5,3,4');
  const optimizer = useApi(
    () => api.getOptimizer(filters, slGrid, tpGrid),
    [key, slGrid, tpGrid]
  );

  const h = holdtime.data;
  const hasHold = !!h && h.buckets.some((b) => b.trade_count > 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Analytics</h1>
        <p className="text-sm text-slate-500">
          Hold-time distribution and trade excursion (MAE/MFE) across the current
          filters.
        </p>
      </div>

      <SectionCard
        title="Net P&L by Hold Time"
        right={
          h && (
            <div className="text-xs text-slate-500">
              Avg hold — winners{' '}
              <span className="text-emerald-400">
                {formatDuration(h.avg_hold_winners_sec)}
              </span>{' '}
              · losers{' '}
              <span className="text-red-400">
                {formatDuration(h.avg_hold_losers_sec)}
              </span>
            </div>
          )
        }
      >
        <AsyncBoundary
          loading={holdtime.loading}
          error={holdtime.error}
          onRetry={holdtime.reload}
          isEmpty={!hasHold}
          emptyMessage="No trades with a hold time match the filters."
          loadingLabel="Loading hold-time buckets…"
        >
          {h && <HoldTimeBars data={h.buckets} />}
        </AsyncBoundary>
      </SectionCard>

      <SectionCard title="Excursion (MAE / MFE)">
        <AsyncBoundary
          loading={excursion.loading}
          error={excursion.error}
          onRetry={excursion.reload}
          loadingLabel="Loading excursion…"
        >
          {excursion.data && <ExcursionPanel e={excursion.data} />}
        </AsyncBoundary>
      </SectionCard>

      <SectionCard title="Wick-Fill Edge">
        <AsyncBoundary
          loading={wickEdge.loading}
          error={wickEdge.error}
          onRetry={wickEdge.reload}
          loadingLabel="Loading wick edge…"
        >
          {wickEdge.data && <WickEdgePanel data={wickEdge.data} />}
        </AsyncBoundary>
      </SectionCard>

      <SectionCard
        title="Trade Management Optimizer"
        right={
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="opt-sl">SL grid (R)</label>
              <input
                id="opt-sl"
                className="input w-44"
                value={slGrid}
                onChange={(e) => setSlGrid(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="opt-tp">TP grid (R)</label>
              <input
                id="opt-tp"
                className="input w-44"
                value={tpGrid}
                onChange={(e) => setTpGrid(e.target.value)}
              />
            </div>
          </div>
        }
      >
        <AsyncBoundary
          loading={optimizer.loading}
          error={optimizer.error}
          onRetry={optimizer.reload}
          loadingLabel="Sweeping SL/TP grid…"
        >
          {optimizer.data && <OptimizerHeatmap data={optimizer.data} />}
        </AsyncBoundary>
      </SectionCard>
    </div>
  );
}
