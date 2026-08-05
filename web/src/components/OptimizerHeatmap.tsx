import type { OptimizerStats } from '../types';
import { formatNumber, formatPct } from '../utils/format';

export default function OptimizerHeatmap({ data }: { data: OptimizerStats }) {
  if (data.sample_size === 0) {
    return (
      <p className="text-sm text-slate-500">
        No trades with entry price, stop price, MAE and MFE match the filters.
        Populate stops + MAE/MFE (via import, EA, or trade detail) to unlock the
        optimizer.
      </p>
    );
  }

  const totals = data.cells.map((c) => c.total_r);
  const maxAbs = Math.max(1, ...totals.map((v) => Math.abs(v)));
  const bg = (r: number) => {
    const norm = Math.max(-1, Math.min(1, r / maxAbs));
    if (norm >= 0) {
      const a = 0.08 + norm * 0.55;
      return { backgroundColor: `rgba(16,185,129,${a.toFixed(3)})` };
    }
    const a = 0.08 + Math.abs(norm) * 0.55;
    return { backgroundColor: `rgba(239,68,68,${a.toFixed(3)})` };
  };

  const cellAt = (sl: number, tp: number) =>
    data.cells.find((c) => c.sl_r === sl && c.tp_r === tp);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <div className="text-[11px] uppercase text-slate-500">Sample</div>
          <div className="num mt-1 text-lg font-semibold text-slate-100">
            {data.sample_size}
            <span className="ml-1 text-xs text-slate-500">/ {data.total_scanned}</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <div className="text-[11px] uppercase text-slate-500">Realized total R</div>
          <div className="num mt-1 text-lg font-semibold text-slate-100">
            {formatNumber(data.baseline_r, 2)}
          </div>
          <div className="num text-xs text-slate-500">
            avg {formatNumber(data.baseline_avg_r, 2)} R
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <div className="text-[11px] uppercase text-slate-500">Best (SL / TP)</div>
          <div className="num mt-1 text-lg font-semibold text-indigo-300">
            {data.best ? `${data.best.sl_r}R / ${data.best.tp_r}R` : '—'}
          </div>
          <div className="num text-xs text-slate-500">
            {data.best ? `${formatNumber(data.best.total_r, 2)} R total` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3 py-2.5">
          <div className="text-[11px] uppercase text-emerald-500/80">Uplift vs realized</div>
          <div
            className={`num mt-1 text-lg font-semibold ${
              (data.uplift_r ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'
            }`}
          >
            {data.uplift_r == null ? '—' : `${data.uplift_r >= 0 ? '+' : ''}${formatNumber(data.uplift_r, 2)} R`}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-950 px-2 py-2 text-right font-medium text-slate-400">
                SL ↓ / TP →
              </th>
              {data.tp_r.map((tp) => (
                <th
                  key={tp}
                  className="px-2 py-2 text-center font-medium text-slate-400"
                >
                  {tp}R
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.sl_r.map((sl) => (
              <tr key={sl}>
                <th className="sticky left-0 z-10 bg-slate-950 px-2 py-2 text-right font-medium text-slate-400">
                  {sl}R
                </th>
                {data.tp_r.map((tp) => {
                  const c = cellAt(sl, tp);
                  if (!c)
                    return (
                      <td key={tp} className="px-2 py-2 text-center text-slate-600">
                        —
                      </td>
                    );
                  const isBest =
                    data.best && data.best.sl_r === sl && data.best.tp_r === tp;
                  return (
                    <td
                      key={tp}
                      style={bg(c.total_r)}
                      className={`num px-2 py-2 text-center ${
                        isBest ? 'ring-2 ring-indigo-400' : ''
                      }`}
                      title={`${c.wins}W / ${c.losses}L · win-rate ${formatPct(c.win_rate)} · avg ${formatNumber(c.avg_r, 2)}R`}
                    >
                      <div className="font-medium text-slate-100">
                        {formatNumber(c.total_r, 1)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formatPct(c.win_rate)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Simulated total R per cell: on trades with a stop, MAE and MFE — if MAE ≥ SL,
        the trade would stop out at −SL; else if MFE ≥ TP, it hits target at +TP; else
        the realized R is kept.
      </p>
    </div>
  );
}
