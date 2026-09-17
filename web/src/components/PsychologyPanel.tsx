import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from './states';
import type { GroupAgg } from '../types';
import { formatMoney, formatPct, formatR, signClass } from '../utils/format';

const EMOTION_LABELS: Record<string, string> = {
  calm: 'Calm', confident: 'Confident', bored: 'Bored', anxious: 'Anxious', fomo: 'FOMO', revenge: 'Revenge',
};

function AggRows({ title, rows, label, currency }: {
  title: string;
  rows: Array<GroupAgg & { key: string | number }>;
  label: (k: string | number) => string;
  currency: string;
}) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net_pnl)));
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No ratings yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1 font-medium"> </th>
              <th className="py-1 text-right font-medium">N</th>
              <th className="py-1 text-right font-medium">Win%</th>
              <th className="py-1 text-right font-medium">Avg R</th>
              <th className="py-1 pl-3 font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.key)} className="border-t border-slate-800/60">
                <td className="py-1 text-slate-300">{label(r.key)}</td>
                <td className="num py-1 text-right text-slate-400">{r.n}</td>
                <td className="num py-1 text-right text-slate-300">{formatPct(r.win_rate)}</td>
                <td className={`num py-1 text-right ${signClass(r.avg_r)}`}>{formatR(r.avg_r)}</td>
                <td className="py-1 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${r.net_pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${(Math.abs(r.net_pnl) / maxAbs) * 100}%` }}
                      />
                    </div>
                    <span className={`num text-xs ${signClass(r.net_pnl)}`}>{formatMoney(r.net_pnl, currency)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Analytics panel: performance by emotional state, confidence and "tilt after loss". */
export default function PsychologyPanel({ currency = 'USD' }: { currency?: string }) {
  const { filters } = useFilters();
  const { data, loading, error, reload } = useApi(() => api.getPsychology(filters), [filterKey(filters)]);
  const t = data?.tilt_after_loss;
  return (
    <AsyncBoundary loading={loading} error={error} onRetry={reload} loadingLabel="Loading psychology…" skeleton="table">
      {data && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            {data.rated}/{data.total} trades rated. Rate trades in the review stepper or on trade detail.
          </p>
          {t && (
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['Within ' + t.window_min + ' min after a loss', t.after_loss, true],
                ['All other trades', t.other, false],
              ] as const).map(([label, a, tilt]) => (
                <div key={label} className={`rounded-lg border p-3 ${tilt ? 'border-amber-500/40' : 'border-slate-800'}`}>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
                  {a.n === 0 ? (
                    <div className="mt-1 text-sm text-slate-500">No trades</div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
                      <span className={`num font-semibold ${signClass(a.net_pnl)}`}>{formatMoney(a.net_pnl, currency)}</span>
                      <span className="num text-slate-400">n={a.n}</span>
                      <span className="num text-slate-300">win {formatPct(a.win_rate)}</span>
                      <span className={`num ${signClass(a.avg_net)}`}>{formatMoney(a.avg_net, currency)}/trade</span>
                      <span className={`num ${signClass(a.avg_r)}`}>{formatR(a.avg_r)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <AggRows title="By emotional state" rows={data.by_emotion} label={(k) => EMOTION_LABELS[k] ?? String(k)} currency={currency} />
            <AggRows title="By pre-trade confidence" rows={data.by_confidence} label={(k) => `Confidence ${k}`} currency={currency} />
            <AggRows title="By execution rating" rows={data.by_satisfaction} label={(k) => `Rated ${k}`} currency={currency} />
          </div>
        </div>
      )}
    </AsyncBoundary>
  );
}
