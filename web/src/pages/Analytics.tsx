import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import HoldTimeBars from '../components/HoldTimeBars';
import OptimizerHeatmap from '../components/OptimizerHeatmap';
import { formatNumber, formatPct, formatDuration } from '../utils/format';
import type { ExcursionStats } from '../types';

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
