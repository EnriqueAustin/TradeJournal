import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import type { PortfolioAccount } from '../types';
import { formatMoney, formatPct, signClass } from '../utils/format';

function statusBadge(s: string) {
  if (s === 'breach')
    return 'bg-red-500/15 text-red-400 border-red-900/40';
  if (s === 'warn')
    return 'bg-amber-500/15 text-amber-400 border-amber-900/40';
  return 'bg-emerald-500/15 text-emerald-400 border-emerald-900/40';
}

function Meter({
  label,
  pct,
  limit,
  used,
  currency,
}: {
  label: string;
  pct: number | null;
  limit: number | null;
  used: number;
  currency: string;
}) {
  if (limit == null || limit <= 0)
    return <span className="text-xs text-slate-600">—</span>;
  const p = Math.max(0, Math.min(1, pct ?? 0));
  const color =
    p >= 1 ? 'bg-red-500' : p >= 0.8 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="min-w-[120px]">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        <span className="num text-slate-400">{formatPct(pct)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
        <div
          className={`h-full ${color}`}
          style={{ width: `${(p * 100).toFixed(1)}%` }}
        />
      </div>
      <div className="num mt-0.5 text-[10px] text-slate-500">
        {formatMoney(used, currency)} / {formatMoney(limit, currency)}
      </div>
    </div>
  );
}

function AccountRow({ a }: { a: PortfolioAccount }) {
  return (
    <tr className="border-b border-slate-800/60 align-top">
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-slate-100">{a.name}</span>
          <span className="text-xs text-slate-500">
            {a.broker || '—'} · #{a.account_id}
          </span>
          <div className="flex flex-wrap gap-1">
            {a.dd_type && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {a.dd_type === 'trailing' ? 'trailing' : 'static'} DD
              </span>
            )}
            {a.phase > 0 && (
              <span className="rounded bg-indigo-900/50 px-1.5 py-0.5 text-[10px] text-indigo-300">
                Phase {a.phase}
              </span>
            )}
            {a.phase === 0 && a.profit_split != null && (
              <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300">
                Funded {a.profit_split}%
              </span>
            )}
            {a.weekend_hold === false && (
              <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                No wknd
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${statusBadge(a.status)}`}
        >
          {a.status}
        </span>
      </td>
      <td className={`num px-4 py-3 text-right font-semibold ${signClass(a.total_pnl)}`}>
        {formatMoney(a.total_pnl, a.currency)}
        <div className={`num text-xs font-normal ${signClass(a.day_pnl)}`}>
          today {formatMoney(a.day_pnl, a.currency)}
        </div>
      </td>
      <td className="num px-4 py-3 text-right text-slate-300">
        {formatMoney(a.current_equity, a.currency)}
        <div className="num text-xs font-normal text-slate-500">
          start {formatMoney(a.starting_balance, a.currency)}
        </div>
      </td>
      <td className="px-4 py-3">
        <Meter
          label="Daily loss"
          pct={a.day_loss_used_pct}
          limit={a.day_loss_limit}
          used={Math.max(0, -(a.day_pnl || 0))}
          currency={a.currency}
        />
      </td>
      <td className="px-4 py-3">
        <Meter
          label={`Max DD${a.dd_type === 'trailing' ? ' (trail)' : ''}`}
          pct={a.max_dd_used_pct}
          limit={a.max_dd_limit}
          used={a.max_dd}
          currency={a.currency}
        />
      </td>
      <td className="px-4 py-3">
        <Meter
          label="Target"
          pct={a.target_progress_pct}
          limit={a.target}
          used={Math.max(0, a.total_pnl)}
          currency={a.currency}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-[100px]">
          {a.consistency_pct != null && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                <span>Consistency</span>
                <span className="num text-slate-400">
                  {a.best_day_pct_of_total != null ? `${(a.best_day_pct_of_total * 100).toFixed(1)}%` : '—'} / {a.consistency_pct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full ${a.consistency_used_pct != null && a.consistency_used_pct >= 1 ? 'bg-red-500' : a.consistency_used_pct != null && a.consistency_used_pct >= 0.8 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, (a.consistency_used_pct ?? 0) * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )}
          {a.min_trading_days != null && a.min_trading_days > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="uppercase tracking-wide text-slate-500">Min days</span>
              <span className={`num font-medium ${a.trading_days_count >= a.min_trading_days ? 'text-emerald-400' : 'text-slate-400'}`}>
                {a.trading_days_count}/{a.min_trading_days}
              </span>
            </div>
          )}
          {a.consistency_pct == null && (a.min_trading_days == null || a.min_trading_days <= 0) && (
            <span className="text-xs text-slate-600">—</span>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Portfolio() {
  const { filters } = useFilters();
  const key = filterKey(filters);
  const q = useApi(() => api.getPortfolio(filters), [key]);

  const d = q.data;
  const primary = d?.accounts[0]?.currency || 'USD';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Portfolio</h1>
        <p className="text-sm text-slate-500">
          Prop-firm guardrails across every account. Account filter is ignored
          here — the roll-up always spans everything.
        </p>
      </div>

      <AsyncBoundary
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        isEmpty={!d || d.account_count === 0}
        emptyMessage="No accounts yet — add one on the Accounts page."
        loadingLabel="Loading portfolio…"
      >
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <div className="text-[11px] uppercase text-slate-500">Accounts</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="num text-2xl font-semibold text-slate-100">
                    {d.account_count}
                  </span>
                  <span className="text-xs text-slate-500">
                    {d.warn_count} warn · {d.breach_count} breach
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <div className="text-[11px] uppercase text-slate-500">Total P&L</div>
                <div className={`num mt-1 text-2xl font-semibold ${signClass(d.total_pnl)}`}>
                  {formatMoney(d.total_pnl, primary)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <div className="text-[11px] uppercase text-slate-500">Day P&L</div>
                <div className={`num mt-1 text-2xl font-semibold ${signClass(d.day_pnl)}`}>
                  {formatMoney(d.day_pnl, primary)}
                </div>
              </div>
              <div
                className={`rounded-lg border px-3 py-2.5 ${statusBadge(d.status)}`}
              >
                <div className="text-[11px] uppercase opacity-70">Worst status</div>
                <div className="mt-1 text-2xl font-semibold capitalize">
                  {d.status}
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Account</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">P&L</th>
                      <th className="px-4 py-2.5 text-right font-medium">Equity</th>
                      <th className="px-4 py-2.5 font-medium">Daily loss</th>
                      <th className="px-4 py-2.5 font-medium">Max DD</th>
                      <th className="px-4 py-2.5 font-medium">Target</th>
                      <th className="px-4 py-2.5 font-medium">Rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.accounts.map((a) => (
                      <AccountRow key={a.account_id} a={a} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
