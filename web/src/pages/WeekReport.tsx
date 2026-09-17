import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import ShareLinkButton from '../components/ShareLinkButton';
import type { WeekReportTrade } from '../types';
import { formatMoney, formatR, formatPct, formatNumber, formatDate, signClass } from '../utils/format';

function TradeLine({ t, currency }: { t: WeekReportTrade; currency: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-800/60 py-1.5 text-sm last:border-0">
      <span className="font-medium text-slate-200">{t.instrument}</span>
      <span className="capitalize text-slate-400">{t.direction}</span>
      <span className="text-xs text-slate-500">{formatDate(t.entry_time)}</span>
      <span className={`num ml-auto ${signClass(t.net_pnl)}`}>{formatMoney(t.net_pnl, currency)}</span>
      <span className={`num w-16 text-right ${signClass(t.r_multiple)}`}>{formatR(t.r_multiple)}</span>
    </div>
  );
}

export default function WeekReport() {
  const { date = new Date().toISOString().slice(0, 10) } = useParams();
  const { filters } = useFilters();
  const account = filters.account ?? null;
  const r = useApi(() => api.getWeekReport(account, date), [account, date]);
  const d = r.data;
  const currency = d?.account.currency ?? 'USD';

  return (
    <div className="mx-auto max-w-3xl p-1">
      {/* Screen-only toolbar; hidden when printing */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold text-slate-100">Weekly Review</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ShareLinkButton kind="week" refId={date} accountId={account} />
          <Link className="btn text-xs" to={`/review/week/${d?.from ?? date}`}>
            Review week
          </Link>
          <Link className="btn text-xs" to={`/report/month/${(d?.from ?? date).slice(0, 7)}`}>
            Month report →
          </Link>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <AsyncBoundary
        loading={r.loading}
        error={r.error}
        onRetry={r.reload}
        loadingLabel="Building weekly review…"
      >
        {d && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">
                {formatDate(`${d.from}T12:00:00Z`)} – {formatDate(`${d.to}T12:00:00Z`)}
              </h2>
              <p className="text-sm text-slate-500">{d.account.name}</p>
            </div>

            {/* Week stats */}
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-800 p-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Net P&L', value: formatMoney(d.stats.net_pnl, currency), cls: signClass(d.stats.net_pnl) },
                { label: 'Trades', value: String(d.stats.trade_count), cls: 'text-slate-200' },
                { label: 'Win rate', value: formatPct(d.stats.win_rate), cls: 'text-slate-200' },
                { label: 'Profit factor', value: d.stats.profit_factor == null ? '—' : formatNumber(d.stats.profit_factor, 2), cls: 'text-slate-200' },
                { label: 'Expectancy', value: formatMoney(d.stats.expectancy, currency), cls: signClass(d.stats.expectancy) },
                { label: 'Total R', value: formatR(d.stats.total_r), cls: signClass(d.stats.total_r) },
              ].map((t) => (
                <div key={t.label}>
                  <div className="label">{t.label}</div>
                  <div className={`num text-lg font-semibold ${t.cls}`}>{t.value}</div>
                </div>
              ))}
            </div>

            {d.week_recap && (
              <div className="rounded-lg border border-slate-800 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">Week recap</h3>
                <p className="whitespace-pre-wrap text-sm text-slate-300">{d.week_recap}</p>
              </div>
            )}

            {/* Best / worst */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800 p-4">
                <h3 className="mb-2 text-sm font-semibold text-emerald-400">Best trades</h3>
                {d.best.length ? (
                  d.best.map((t) => <TradeLine key={t.id} t={t} currency={currency} />)
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-800 p-4">
                <h3 className="mb-2 text-sm font-semibold text-red-400">Worst trades</h3>
                {d.worst.length ? (
                  d.worst.map((t) => <TradeLine key={t.id} t={t} currency={currency} />)
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                )}
              </div>
            </div>

            {/* Day-by-day */}
            <div className="rounded-lg border border-slate-800 p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-200">Day by day</h3>
              <div className="flex flex-col gap-3">
                {d.days.map((day) => (
                  <div key={day.day} className="border-b border-slate-800/60 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-medium text-slate-200">
                        {new Date(`${day.day}T00:00:00Z`).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </span>
                      <span className="text-xs text-slate-500">
                        {day.trade_count} trade{day.trade_count === 1 ? '' : 's'}
                      </span>
                      {day.trade_count > 0 && (
                        <>
                          <span className={`num ml-auto ${signClass(day.net_pnl)}`}>
                            {formatMoney(day.net_pnl, currency)}
                          </span>
                          <span className={`num w-16 text-right ${signClass(day.r)}`}>
                            {formatR(day.r)}
                          </span>
                        </>
                      )}
                    </div>
                    {day.bias && (
                      <p className="mt-1 text-xs text-slate-500">
                        <span className="uppercase tracking-wide">Bias:</span> {day.bias}
                      </p>
                    )}
                    {day.recap && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{day.recap}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
