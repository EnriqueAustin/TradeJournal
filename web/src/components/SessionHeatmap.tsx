import { useMemo } from 'react';
import type { SessionStat } from '../types';
import { formatMoney, formatR, formatPct } from '../utils/format';

const SESSION_ORDER = ['asia', 'london', 'overlap', 'ny', 'off'];

// Map a net_pnl to a background style scaled against the max magnitude.
function cellStyle(pnl: number, max: number): React.CSSProperties {
  if (max === 0 || pnl === 0) return { background: 'rgba(30,41,59,0.4)' };
  const intensity = Math.min(1, Math.abs(pnl) / max);
  const alpha = 0.12 + intensity * 0.5;
  const color = pnl > 0 ? `34,197,94` : `239,68,68`;
  return { background: `rgba(${color},${alpha.toFixed(3)})` };
}

export default function SessionHeatmap({
  data,
  currency = 'USD',
}: {
  data: SessionStat[];
  currency?: string;
}) {
  const { instruments, grid, max } = useMemo(() => {
    const instr = Array.from(new Set(data.map((d) => d.instrument))).sort();
    const g = new Map<string, SessionStat>();
    let mx = 0;
    for (const d of data) {
      g.set(`${d.session}|${d.instrument}`, d);
      mx = Math.max(mx, Math.abs(d.net_pnl));
    }
    return { instruments: instr, grid: g, max: mx };
  }, [data]);

  const sessions = SESSION_ORDER.filter((s) =>
    data.some((d) => d.session === s)
  );
  const rows = sessions.length ? sessions : SESSION_ORDER;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Session
            </th>
            {instruments.map((inst) => (
              <th
                key={inst}
                className="px-2 py-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400"
              >
                {inst}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s}>
              <td className="px-2 py-1 text-xs font-medium capitalize text-slate-400">
                {s}
              </td>
              {instruments.map((inst) => {
                const cell = grid.get(`${s}|${inst}`);
                return (
                  <td key={inst} className="p-0">
                    <div
                      className="rounded-lg border border-slate-800/60 px-2 py-2 text-center"
                      style={cellStyle(cell?.net_pnl ?? 0, max)}
                      title={
                        cell
                          ? `${s} · ${inst}\n${formatMoney(cell.net_pnl, currency)} · ${cell.trade_count} trades · ${formatPct(cell.win_rate)} win · ${formatR(cell.avg_r)}`
                          : `${s} · ${inst}: no trades`
                      }
                    >
                      {cell && cell.trade_count > 0 ? (
                        <>
                          <div
                            className={`num text-xs font-semibold ${
                              cell.net_pnl >= 0 ? 'text-emerald-300' : 'text-red-300'
                            }`}
                          >
                            {formatMoney(cell.net_pnl, currency)}
                          </div>
                          <div className="num text-[10px] text-slate-400">
                            {cell.trade_count}t · {formatR(cell.avg_r)}
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-slate-600">—</div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {instruments.length === 0 && (
        <p className="py-4 text-center text-sm text-slate-500">No session data.</p>
      )}
    </div>
  );
}
