import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from './states';
import { formatMoney, formatNumber, formatR, signClass } from '../utils/format';
import type { ExitAnalysis, HoldToTarget } from '../types';

export const HOLD_TO_TARGET_LABELS: Record<HoldToTarget, string> = {
  target: 'Target first',
  stop: 'Stop first',
  neither: 'Neither (4h)',
  ambiguous: 'Both in one bar',
  already: 'Exited at target',
};

/**
 * "Price after exit" for one trade: where price went 5/15/30/60 min after the
 * exit, the best exit reachable in hindsight, and whether holding to target
 * would have been stopped first. Self-contained — fetches its own data.
 * `refreshKey` should change when the trade's prices/stop/target are edited.
 */
export default function ExitAnalysisCard({
  tradeId,
  currency = 'USD',
  refreshKey = '',
}: {
  tradeId: number;
  currency?: string;
  refreshKey?: string | number;
}) {
  const res = useApi(() => api.getExitAnalysis(tradeId), [tradeId, refreshKey]);
  const a = res.data?.analysis ?? null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Exit Analysis</h2>
        {a && (
          <span
            className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] uppercase text-slate-500"
            title="Bar series used — S5 when stored for the whole window, else M1"
          >
            {a.tf} bars
          </span>
        )}
      </div>
      <AsyncBoundary
        loading={res.loading}
        error={res.error}
        onRetry={res.reload}
        isEmpty={!a}
        emptyMessage="No price bars after this exit (or fill prices don't match the bar feed)."
        loadingLabel="Reading price after exit…"
      >
        {a && <ExitAnalysisBody a={a} currency={currency} />}
      </AsyncBoundary>
    </div>
  );
}

function ExitAnalysisBody({ a, currency }: { a: ExitAnalysis; currency: string }) {
  const left = a.left_on_table;
  const rNote = a.r_kind === 'derived' ? '~' : '';
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-500/80">
            Left on table
          </div>
          <div className="num mt-0.5 text-lg font-semibold text-amber-300">
            {left.usd != null ? formatMoney(left.usd, currency) : formatNumber(left.price, 2)}
          </div>
          <div className="num text-xs text-slate-500">
            {left.r != null ? `${formatR(left.r)}${rNote}` : 'no R'} · best within {left.minutes ?? '—'}m
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Ran ≥1R after exit
          </div>
          <div
            className={`num mt-0.5 text-lg font-semibold ${
              a.continued_1r == null ? 'text-slate-500' : a.continued_1r ? 'text-amber-300' : 'text-slate-200'
            }`}
          >
            {a.continued_1r == null ? '—' : a.continued_1r ? 'Yes' : 'No'}
          </div>
          <div className="num text-xs text-slate-500">
            1R = {formatNumber(a.risk_dist, 2)} pts{a.r_kind === 'derived' ? ' (modeled)' : ''}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Hold to target
          </div>
          <div
            className={`mt-0.5 text-lg font-semibold ${
              a.hold_to_target === 'stop'
                ? 'text-red-400'
                : a.hold_to_target === 'target'
                ? 'text-emerald-400'
                : 'text-slate-200'
            }`}
          >
            {a.hold_to_target ? HOLD_TO_TARGET_LABELS[a.hold_to_target] : '—'}
          </div>
          <div className="text-xs text-slate-500">
            {a.hold_to_target ? 'from exit, stop vs target' : 'needs stop + target'}
          </div>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pb-1 font-medium">After exit</th>
            <th className="pb-1 text-right font-medium">Move</th>
            <th className="pb-1 text-right font-medium">Move R</th>
            <th className="pb-1 text-right font-medium">Best</th>
            <th className="pb-1 text-right font-medium">Best R</th>
            <th className="pb-1 text-right font-medium">Against</th>
          </tr>
        </thead>
        <tbody>
          {a.horizons.map((h) => (
            <tr key={h.minutes} className="border-t border-slate-800/60">
              <td className="py-1 text-slate-300">
                {h.minutes}m
                {!h.complete && h.move != null && (
                  <span className="ml-1 text-slate-600" title="Stored bars end before this horizon">
                    *
                  </span>
                )}
              </td>
              <td className={`num py-1 text-right ${signClass(h.move)}`}>
                {h.move_usd != null ? formatMoney(h.move_usd, currency) : formatNumber(h.move, 2)}
              </td>
              <td className={`num py-1 text-right ${signClass(h.move_r)}`}>{formatR(h.move_r)}</td>
              <td className="num py-1 text-right text-amber-300/90">
                {h.best_usd != null ? formatMoney(h.best_usd, currency) : formatNumber(h.best, 2)}
              </td>
              <td className="num py-1 text-right text-amber-300/90">{formatR(h.best_r)}</td>
              <td className="num py-1 text-right text-slate-400">{formatNumber(h.adverse, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-500">
        Moves are measured in the trade's direction from the exit price (+ = price kept going
        your way). Uses bars that open at/after the exit, so the first bar of partial time is
        skipped{rNote ? '; ~R is from the modeled risk (no stop recorded)' : ''}.
      </p>
    </div>
  );
}
