import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import EquityCurve from '../components/EquityCurve';
import Calendar from '../components/Calendar';
import { HOLD_TO_TARGET_LABELS } from '../components/ExitAnalysisCard';
import type { GroupAgg, HoldToTarget, MonthReport as TMonthReport, MonthReportTrade, StatsSummary } from '../types';
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPct,
  formatR,
  sessionLabel,
  signClass,
} from '../utils/format';
import { longDay } from '../utils/review';

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function Section({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`break-inside-avoid rounded-lg border border-slate-800 p-4 ${className}`}>
      <h3 className="mb-2 text-sm font-semibold text-slate-200">{title}</h3>
      {children}
    </div>
  );
}

// KPI with the delta against the previous month.
function Kpi({
  label,
  cur,
  prev,
  fmt,
  higherBetter = true,
  colorBySign = false,
}: {
  label: string;
  cur: number | null;
  prev: number | null;
  fmt: (v: number | null) => string;
  higherBetter?: boolean;
  colorBySign?: boolean;
}) {
  const delta = cur != null && prev != null ? cur - prev : null;
  const good = delta == null || delta === 0 ? null : higherBetter ? delta > 0 : delta < 0;
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`num text-lg font-semibold ${colorBySign ? signClass(cur) : 'text-slate-200'}`}>{fmt(cur)}</div>
      <div className={`num text-[11px] ${good == null ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400'}`}>
        {delta == null ? 'prev —' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} prev ${fmt(prev)}`}
      </div>
    </div>
  );
}

function TradeLine({ t, currency }: { t: MonthReportTrade; currency: string }) {
  return (
    <Link
      to={`/trades/${t.id}`}
      className="flex items-center gap-3 border-b border-slate-800/60 py-1.5 text-sm last:border-0 hover:bg-slate-800/30"
    >
      <span className="font-medium text-slate-200">{t.instrument}</span>
      <span className="capitalize text-slate-400">{t.direction}</span>
      <span className="text-xs text-slate-500">{formatDate(t.entry_time)}</span>
      <span className={`num ml-auto ${signClass(t.net_pnl)}`}>{formatMoney(t.net_pnl, currency)}</span>
      <span className={`num w-16 text-right ${signClass(t.r_multiple)}`}>{formatR(t.r_multiple)}</span>
    </Link>
  );
}

function AggTable({
  rows,
  label,
  currency,
}: {
  rows: Array<{ key: string; n: number; net: number; win: number | null; avg_r: number | null }>;
  label: (k: string) => string;
  currency: string;
}) {
  if (!rows.length) return <p className="text-sm text-slate-500">—</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <th className="py-1 font-medium"> </th>
          <th className="py-1 text-right font-medium">N</th>
          <th className="py-1 text-right font-medium">Win%</th>
          <th className="py-1 text-right font-medium">Net</th>
          <th className="py-1 text-right font-medium">Avg R</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-slate-800/60">
            <td className="py-1 text-slate-300">{label(r.key)}</td>
            <td className="num py-1 text-right text-slate-400">{r.n}</td>
            <td className="num py-1 text-right text-slate-300">{formatPct(r.win)}</td>
            <td className={`num py-1 text-right ${signClass(r.net)}`}>{formatMoney(r.net, currency)}</td>
            <td className={`num py-1 text-right ${signClass(r.avg_r)}`}>{formatR(r.avg_r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const fromAgg = (rows: Array<GroupAgg & { key: string }>) =>
  rows.map((r) => ({ key: r.key, n: r.n, net: r.net_pnl, win: r.win_rate, avg_r: r.avg_r }));

export default function MonthReport() {
  const { ym = new Date().toISOString().slice(0, 7) } = useParams();
  const navigate = useNavigate();
  const { filters } = useFilters();
  const account = filters.account ?? null;
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
  const r = useApi(
    () => (valid ? api.getMonthReport(account, ym) : Promise.reject(new Error('Month must be YYYY-MM'))),
    [account, ym]
  );
  const d = r.data && r.data.month === ym ? r.data : null;
  const currency = d?.account.currency ?? 'USD';

  return (
    <div className="mx-auto max-w-5xl p-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-lg font-semibold text-slate-100">Monthly Report</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn px-2 py-1" onClick={() => navigate(`/report/month/${shiftMonth(ym, -1)}`)} aria-label="Previous month">
            ‹
          </button>
          <input
            type="month"
            className="input py-1"
            value={valid ? ym : ''}
            onChange={(e) => e.target.value && navigate(`/report/month/${e.target.value}`)}
          />
          <button className="btn px-2 py-1" onClick={() => navigate(`/report/month/${shiftMonth(ym, 1)}`)} aria-label="Next month">
            ›
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload} loadingLabel="Building monthly report…">
        {d && <MonthBody d={d} currency={currency} />}
      </AsyncBoundary>
    </div>
  );
}

function MonthBody({ d, currency }: { d: TMonthReport; currency: string }) {
  const s: StatsSummary = d.stats;
  const p: StatsSummary = d.prev_stats;
  const money = (v: number | null) => formatMoney(v, currency);
  const disc = d.discipline;
  const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
  const gradeMax = Math.max(1, ...gradeOrder.map((g) => disc.grades[g] ?? 0));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">{monthLabel(d.month)}</h2>
        <p className="text-sm text-slate-500">
          {d.account.name} · {d.trading_days} trading days · {d.green_days} green
          {d.avg_day != null && <> · avg day {money(d.avg_day)}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-800 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Net P&L" cur={s.net_pnl} prev={p.trade_count ? p.net_pnl : null} fmt={money} colorBySign />
        <Kpi label="Trades" cur={s.trade_count} prev={p.trade_count} fmt={(v) => (v == null ? '—' : String(v))} />
        <Kpi label="Win rate" cur={s.trade_count ? s.win_rate : null} prev={p.trade_count ? p.win_rate : null} fmt={formatPct} />
        <Kpi
          label="Profit factor"
          cur={s.profit_factor}
          prev={p.profit_factor}
          fmt={(v) => (v == null ? '—' : formatNumber(v, 2))}
        />
        <Kpi label="Expectancy" cur={s.trade_count ? s.expectancy : null} prev={p.trade_count ? p.expectancy : null} fmt={money} colorBySign />
        <Kpi label="Total R" cur={s.total_r} prev={p.total_r} fmt={formatR} colorBySign />
      </div>

      {s.trade_count === 0 ? (
        <p className="rounded-lg border border-slate-800 p-6 text-sm text-slate-500">No trades this month.</p>
      ) : (
        <>
          <Section title="Equity curve">
            <EquityCurve data={d.equity} className="h-56" />
          </Section>

          <Section title="Calendar">
            <Calendar month={d.month} days={d.days} currency={currency} />
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Best & worst days">
              {[...d.best_days, ...d.worst_days].length === 0 && <p className="text-sm text-slate-500">—</p>}
              {[...d.best_days, ...d.worst_days].map((day) => (
                <Link
                  key={day.day}
                  to={`/journal?day=${day.day}`}
                  className="flex items-center gap-3 border-b border-slate-800/60 py-1.5 text-sm last:border-0 hover:bg-slate-800/30"
                >
                  <span className="text-slate-300">{longDay(day.day)}</span>
                  <span className="text-xs text-slate-500">{day.trade_count} trades</span>
                  <span className={`num ml-auto ${signClass(day.net_pnl)}`}>{money(day.net_pnl)}</span>
                  <span className={`num w-16 text-right ${signClass(day.r)}`}>{formatR(day.r)}</span>
                </Link>
              ))}
            </Section>
            <Section title="Discipline">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="label">Plan followed</div>
                  <div className="num text-lg font-semibold text-slate-200">{formatPct(disc.followed_pct)}</div>
                  <div className="text-[11px] text-slate-500">
                    {disc.followed} followed · {disc.broken} broke · {disc.total - disc.reviewed} unreviewed
                  </div>
                </div>
                <div>
                  <div className="label">Avg followed / broke</div>
                  <div className="num text-sm">
                    <span className={signClass(disc.avg_net_followed)}>{money(disc.avg_net_followed)}</span>
                    <span className="text-slate-600"> / </span>
                    <span className={signClass(disc.avg_net_broken)}>{money(disc.avg_net_broken)}</span>
                  </div>
                </div>
                <div className="flex items-end gap-1.5">
                  {gradeOrder.map((g) => {
                    const n = disc.grades[g] ?? 0;
                    return (
                      <div key={g} className="flex flex-col items-center gap-1">
                        <span className="num text-[11px] text-slate-400">{n || ''}</span>
                        <div className="w-5 rounded-sm bg-cyan-500/60" style={{ height: `${(n / gradeMax) * 40 + 2}px` }} />
                        <span className="text-xs text-slate-500">{g}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Section>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Best trades">
              {d.best_trades.length ? d.best_trades.map((t) => <TradeLine key={t.id} t={t} currency={currency} />) : <p className="text-sm text-slate-500">—</p>}
            </Section>
            <Section title="Worst trades">
              {d.worst_trades.length ? d.worst_trades.map((t) => <TradeLine key={t.id} t={t} currency={currency} />) : <p className="text-sm text-slate-500">—</p>}
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="By setup">
              <AggTable
                rows={d.by_setup.map((x) => ({ key: x.name, n: x.trade_count, net: x.net_pnl, win: x.win_rate, avg_r: x.avg_r }))}
                label={(k) => k}
                currency={currency}
              />
            </Section>
            <Section title="By session">
              <AggTable rows={fromAgg(d.by_session)} label={sessionLabel} currency={currency} />
            </Section>
            <Section title="By instrument">
              <AggTable rows={fromAgg(d.by_instrument)} label={(k) => k} currency={currency} />
            </Section>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Top mistakes by cost">
              {d.mistakes.length === 0 ? (
                <p className="text-sm text-slate-500">No costly mistake tags this month.</p>
              ) : (
                d.mistakes.map((m) => (
                  <div key={m.name} className="flex items-center gap-3 border-b border-slate-800/60 py-1.5 text-sm last:border-0">
                    <span className="text-slate-300">{m.name}</span>
                    <span className="text-xs text-slate-500">×{m.count}</span>
                    <span className={`num ml-auto ${signClass(m.net_pnl)}`}>{money(m.net_pnl)}</span>
                  </div>
                ))
              )}
            </Section>
            <Section title="Exit analysis">
              {!d.exits || d.exits.sample === 0 ? (
                <p className="text-sm text-slate-500">No post-exit bars for this month's trades.</p>
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <span className="text-slate-400">
                      Avg left on table{' '}
                      <span className="num text-amber-400">
                        {d.exits.avg_left_r != null ? formatR(d.exits.avg_left_r) : money(d.exits.avg_left_usd)}
                      </span>
                    </span>
                    <span className="text-slate-400">
                      Continued ≥1R <span className="num text-slate-200">{formatPct(d.exits.continued_1r_pct)}</span>
                    </span>
                    <span className="text-xs text-slate-500">n={d.exits.sample}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                    {d.exits.horizons.map((h) => (
                      <span key={h.minutes}>
                        +{h.minutes}m:{' '}
                        <span className={`num ${signClass(h.avg_move_usd)}`}>
                          {h.avg_move_r != null ? formatR(h.avg_move_r) : money(h.avg_move_usd)}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    {Object.entries(d.exits.hold_to_target)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => (
                        <span key={k}>
                          {HOLD_TO_TARGET_LABELS[k as HoldToTarget] ?? k}: <span className="num text-slate-300">{n}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </Section>
          </div>

          {d.psychology.by_emotion.length > 0 && (
            <Section title="Psychology">
              <AggTable rows={fromAgg(d.psychology.by_emotion)} label={(k) => k} currency={currency} />
            </Section>
          )}
        </>
      )}

      <Section title="Notes & recaps">
        {d.recaps.length === 0 ? (
          <p className="text-sm text-slate-500">No recaps written this month.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {d.recaps.map((n) => (
              <div key={`${n.kind}-${n.day}`} className="border-b border-slate-800/60 pb-2 last:border-0">
                <div className="text-xs font-medium text-slate-400">
                  {n.kind === 'week' ? `Week of ${longDay(n.day)}` : longDay(n.day)}
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-300">{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
