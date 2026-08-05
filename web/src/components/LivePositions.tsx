import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { LivePositionsResponse } from '../types';
import { formatMoney, formatNumber, signClass } from '../utils/format';

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

export default function LivePositions({
  account,
  currency,
}: {
  account: number | null;
  currency: string;
}) {
  const [data, setData] = useState<LivePositionsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.getLivePositions(account);
        if (!cancelled) {
          setData(r);
          setErr(null);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load live positions');
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account]);

  if (err) return null;
  if (!data || data.count === 0) return null;

  const age = ageSeconds(data.last_update);
  const stale = age != null && age > 15;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              stale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
            }`}
          />
          <h2 className="text-sm font-semibold text-slate-200">
            Live Positions ({data.count})
          </h2>
          <span className="text-xs text-slate-500">
            {stale ? `stale · ${age}s` : age != null ? `${age}s ago` : ''}
          </span>
        </div>
        <div className={`num text-sm font-semibold ${signClass(data.unrealized_pnl)}`}>
          {formatMoney(data.unrealized_pnl, currency)}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Dir</th>
              <th className="px-3 py-2 text-right font-medium">Size</th>
              <th className="px-3 py-2 text-right font-medium">Entry</th>
              <th className="px-3 py-2 text-right font-medium">Now</th>
              <th className="px-3 py-2 text-right font-medium">Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p) => (
              <tr key={p.ext_id} className="border-b border-slate-800/60">
                <td className="px-3 py-2 text-slate-200">{p.instrument}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      p.direction === 'long'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    {p.direction}
                  </span>
                </td>
                <td className="num px-3 py-2 text-right text-slate-300">
                  {formatNumber(p.size, 2)}
                </td>
                <td className="num px-3 py-2 text-right text-slate-300">
                  {formatNumber(p.entry_price, 2)}
                </td>
                <td className="num px-3 py-2 text-right text-slate-300">
                  {formatNumber(p.current_price, 2)}
                </td>
                <td className={`num px-3 py-2 text-right font-medium ${signClass(p.unrealized_pnl)}`}>
                  {formatMoney(p.unrealized_pnl, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
