import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import EquityCurve from '../components/EquityCurve';
import MultiEquityCurve, { SERIES_COLORS } from '../components/MultiEquityCurve';
import type { PortfolioAccount } from '../types';
import { formatMoney, formatPct, formatR, formatNumber, signClass } from '../utils/format';

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

function roomClass(room: number | null, limit: number | null) {
  if (room == null || limit == null || limit <= 0) return 'text-slate-300';
  if (room <= 0) return 'text-red-400';
  if (room / limit <= 0.2) return 'text-amber-400';
  return 'text-slate-200';
}

function AccountRow({ a, onOpen }: { a: PortfolioAccount; onOpen: () => void }) {
  const idle = a.days_since_last_trade;
  const idleWarn =
    idle != null && a.max_inactivity_days != null && a.max_inactivity_days > 0
      ? idle >= a.max_inactivity_days * 0.8
      : false;
  return (
    <tr
      className="cursor-pointer border-b border-slate-800/60 align-top hover:bg-slate-800/30"
      onClick={onOpen}
      title="Open this account on the dashboard"
    >
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-slate-100">{a.name}</span>
          <span className="text-xs text-slate-500">
            {a.broker || '—'} · #{a.account_id}
          </span>
          <span className={`text-[11px] ${idleWarn ? 'text-amber-400' : 'text-slate-500'}`}>
            {idle == null
              ? 'no trades yet'
              : `last trade ${idle === 0 ? 'today' : `${idle}d ago`}`}
            {a.max_inactivity_days ? ` · max ${a.max_inactivity_days}d idle` : ''}
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
      <td className="num px-4 py-3 text-right">
        <div className={`font-semibold ${roomClass(a.day_loss_room, a.day_loss_limit)}`}>
          {a.day_loss_room == null ? '—' : formatMoney(Math.max(0, a.day_loss_room), a.currency)}
          <span className="ml-1 text-[10px] font-normal uppercase text-slate-500">today</span>
        </div>
        <div className={`text-xs ${roomClass(a.dd_room, a.max_dd_limit)}`}>
          {a.dd_room == null ? '—' : formatMoney(Math.max(0, a.dd_room), a.currency)}
          <span className="ml-1 text-[10px] uppercase text-slate-500">to DD</span>
        </div>
        {a.dd_floor != null && (
          <div className="text-[10px] text-slate-500">
            floor {formatMoney(a.dd_floor, a.currency)}
          </div>
        )}
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

type SortKey = 'name' | 'trades' | 'win' | 'pf' | 'exp' | 'r' | 'net';

const SORTERS: Record<SortKey, (a: PortfolioAccount) => number | string> = {
  name: (a) => a.name.toLowerCase(),
  trades: (a) => a.perf.trade_count,
  win: (a) => a.perf.win_rate,
  pf: (a) => a.perf.profit_factor ?? Number.POSITIVE_INFINITY,
  exp: (a) => a.perf.expectancy,
  r: (a) => a.perf.total_r ?? 0,
  net: (a) => a.perf.net_pnl,
};

// Side-by-side edge per account — which book is actually carrying the P&L.
function AccountComparison({
  accounts,
  onOpen,
}: {
  accounts: PortfolioAccount[];
  onOpen: (id: number) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'net', dir: -1 });
  const colorOf = new Map(accounts.map((a, i) => [a.account_id, SERIES_COLORS[i % SERIES_COLORS.length]]));
  const rows = [...accounts].sort((x, y) => {
    const a = SORTERS[sort.key](x);
    const b = SORTERS[sort.key](y);
    return (a < b ? -1 : a > b ? 1 : 0) * sort.dir;
  });
  const grossPos = accounts.reduce((t, a) => t + Math.abs(a.perf.net_pnl), 0);

  const th = (key: SortKey, label: string, right = true) => (
    <th
      className={`cursor-pointer select-none px-4 py-2.5 font-medium hover:text-slate-300 ${right ? 'text-right' : ''}`}
      onClick={() =>
        setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'name' ? 1 : -1 }))
      }
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-sm font-semibold text-slate-200">Account comparison</h2>
        <span className="text-xs text-slate-500">follows the date / instrument filters</span>
      </div>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              {th('name', 'Account', false)}
              {th('trades', 'Trades')}
              {th('win', 'Win rate')}
              {th('pf', 'PF')}
              {th('exp', 'Expectancy')}
              <th className="px-4 py-2.5 text-right font-medium">Avg W / L</th>
              {th('r', 'Total R')}
              {th('net', 'Net P&L')}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const share = grossPos > 0 ? Math.abs(a.perf.net_pnl) / grossPos : 0;
              return (
                <tr
                  key={a.account_id}
                  className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/30"
                  onClick={() => onOpen(a.account_id)}
                >
                  <td className="px-4 py-2.5">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ background: colorOf.get(a.account_id) }}
                    />
                    <span className="text-slate-200">{a.name}</span>
                  </td>
                  <td className="num px-4 py-2.5 text-right text-slate-300">{a.perf.trade_count}</td>
                  <td className="num px-4 py-2.5 text-right text-slate-300">{formatPct(a.perf.win_rate)}</td>
                  <td className="num px-4 py-2.5 text-right text-slate-300">
                    {a.perf.profit_factor == null
                      ? a.perf.trade_count
                        ? '∞'
                        : '—'
                      : formatNumber(a.perf.profit_factor, 2)}
                  </td>
                  <td className={`num px-4 py-2.5 text-right ${signClass(a.perf.expectancy)}`}>
                    {formatMoney(a.perf.expectancy, a.currency)}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-xs">
                    <span className="text-pos">{formatMoney(a.perf.avg_win, a.currency)}</span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-neg">{formatMoney(a.perf.avg_loss, a.currency)}</span>
                  </td>
                  <td className={`num px-4 py-2.5 text-right ${signClass(a.perf.total_r)}`}>
                    {formatR(a.perf.total_r)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className={`num font-semibold ${signClass(a.perf.net_pnl)}`}>
                      {formatMoney(a.perf.net_pnl, a.currency)}
                    </div>
                    <div className="ml-auto mt-1 h-1 w-24 overflow-hidden rounded bg-slate-800">
                      <div
                        className={`ml-auto h-full ${a.perf.net_pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${(share * 100).toFixed(1)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const { filters, setFilters } = useFilters();
  const navigate = useNavigate();
  const [chartMode, setChartMode] = useState<'combined' | 'accounts'>('combined');
  const key = filterKey(filters);
  const q = useApi(() => api.getPortfolio(filters), [key]);

  // Performance across ALL accounts (the roll-up always spans everything, so
  // pin account=null regardless of the global bar; other filters pass through).
  const allFilters = useMemo(() => ({ ...filters, account: null }), [filters]);
  const allKey = filterKey(allFilters);
  const perf = useApi(() => api.getSummary(allFilters), [allKey]);
  const eq = useApi(() => api.getEquity(allFilters), [allKey]);

  const d = q.data;
  const primary = d?.accounts[0]?.currency || 'USD';
  const s = perf.data;

  const openAccount = (id: number) => {
    setFilters({ account: id });
    navigate('/');
  };
  const series = useMemo(
    () => (d ? d.accounts.map((a) => ({ id: a.account_id, name: a.name, data: a.equity })) : []),
    [d]
  );
  // The account nearest its max-DD floor — the one to trade most carefully.
  const tightest = useMemo(() => {
    const withRoom = (d?.accounts ?? []).filter((a) => a.dd_room != null);
    return withRoom.length
      ? withRoom.reduce((m, a) => ((a.dd_room as number) < (m.dd_room as number) ? a : m))
      : null;
  }, [d]);

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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <div className="text-[11px] uppercase text-slate-500">Closest to breach</div>
                {tightest ? (
                  <>
                    <div
                      className={`num mt-1 text-2xl font-semibold ${roomClass(tightest.dd_room, tightest.max_dd_limit)}`}
                    >
                      {formatMoney(Math.max(0, tightest.dd_room as number), tightest.currency)}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {tightest.name} · room to DD floor
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-slate-600">no DD limits set</div>
                )}
              </div>
              <div
                className={`col-span-2 rounded-lg border px-3 py-2.5 md:col-span-1 ${statusBadge(d.status)}`}
              >
                <div className="text-[11px] uppercase opacity-70">Worst status</div>
                <div className="mt-1 text-2xl font-semibold capitalize">
                  {d.status}
                </div>
              </div>
            </div>

            {s && (
              <div className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">
                    Combined performance
                  </h2>
                  <span className="text-xs text-slate-500">
                    every account as one book{s.trade_count === 0 ? ' · no trades' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: 'Net P&L', value: formatMoney(s.net_pnl, primary), cls: signClass(s.net_pnl) },
                    { label: 'Trades', value: String(s.trade_count), cls: 'text-slate-200' },
                    { label: 'Win rate', value: formatPct(s.win_rate), cls: 'text-slate-200' },
                    { label: 'Profit factor', value: s.profit_factor == null ? '—' : formatNumber(s.profit_factor, 2), cls: 'text-slate-200' },
                    { label: 'Expectancy', value: formatMoney(s.expectancy, primary), cls: signClass(s.expectancy) },
                    { label: 'Total R', value: formatR(s.total_r), cls: signClass(s.total_r) },
                  ].map((t) => (
                    <div key={t.label}>
                      <div className="label">{t.label}</div>
                      <div className={`num text-lg font-semibold ${t.cls}`}>{t.value}</div>
                    </div>
                  ))}
                </div>
                {eq.data && eq.data.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                        {chartMode === 'accounts' &&
                          d.accounts.map((a, i) => (
                            <span key={a.account_id} className="flex items-center gap-1.5">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                              />
                              {a.name}
                            </span>
                          ))}
                      </div>
                      <div className="flex shrink-0 overflow-hidden rounded border border-slate-700 text-xs">
                        {(['combined', 'accounts'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setChartMode(m)}
                            className={`px-2.5 py-1 ${chartMode === m ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                          >
                            {m === 'combined' ? 'Combined' : 'By account'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {chartMode === 'combined' ? (
                      <EquityCurve data={eq.data} className="h-64" />
                    ) : (
                      <MultiEquityCurve series={series} className="h-64" />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1020px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Account</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">P&L</th>
                      <th className="px-4 py-2.5 text-right font-medium">Equity</th>
                      <th className="px-4 py-2.5 text-right font-medium">Room</th>
                      <th className="px-4 py-2.5 font-medium">Daily loss</th>
                      <th className="px-4 py-2.5 font-medium">Max DD</th>
                      <th className="px-4 py-2.5 font-medium">Target</th>
                      <th className="px-4 py-2.5 font-medium">Rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.accounts.map((a) => (
                      <AccountRow
                        key={a.account_id}
                        a={a}
                        onOpen={() => openAccount(a.account_id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {d.accounts.length > 1 && (
              <AccountComparison accounts={d.accounts} onOpen={openAccount} />
            )}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
