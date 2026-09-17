import { useMemo, useState } from 'react';
import type { CalendarDay } from '../types';
import { formatMoney, formatPct } from '../utils/format';
import DayTradesModal from './DayTradesModal';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface MonthStat {
  ym: string;
  net: number;
  trades: number;
  days: number;
  green: number;
}

/** Contribution-style fill: square-root scaled so small days still register. */
function cellStyle(pnl: number, maxAbs: number): React.CSSProperties | undefined {
  if (maxAbs <= 0 || pnl === 0) return undefined;
  const mag = Math.sqrt(Math.min(1, Math.abs(pnl) / maxAbs));
  const rgb = pnl > 0 ? 'var(--c-green)' : 'var(--c-red)';
  return { backgroundColor: `rgb(${rgb} / ${(0.18 + 0.72 * mag).toFixed(3)})` };
}

/**
 * Year view of the P&L calendar: twelve mini months, one square per day shaded
 * by that day's net P&L (intensity against the year's biggest day), with each
 * month's total, trade count and green-day rate. Click a day for its trades,
 * a month header to drill into the month view.
 */
export default function YearCalendar({
  year,
  days,
  currency = 'USD',
  onPickMonth,
}: {
  year: number;
  days: CalendarDay[];
  currency?: string;
  onPickMonth?: (ym: string) => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);

  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  const traded = useMemo(
    () => days.filter((d) => d.trade_count > 0 && d.day.startsWith(`${year}-`)),
    [days, year]
  );
  const maxAbs = useMemo(() => Math.max(0, ...traded.map((d) => Math.abs(d.net_pnl))), [traded]);

  const months: MonthStat[] = useMemo(
    () =>
      MONTHS.map((_, i) => {
        const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
        const ds = traded.filter((d) => d.day.startsWith(ym));
        return {
          ym,
          net: ds.reduce((s, d) => s + d.net_pnl, 0),
          trades: ds.reduce((s, d) => s + d.trade_count, 0),
          days: ds.length,
          green: ds.filter((d) => d.net_pnl > 0).length,
        };
      }),
    [traded, year]
  );

  const total = useMemo(() => {
    const net = traded.reduce((s, d) => s + d.net_pnl, 0);
    const green = traded.filter((d) => d.net_pnl > 0).length;
    const active = months.filter((m) => m.days > 0);
    const best = active.reduce<MonthStat | null>((b, m) => (!b || m.net > b.net ? m : b), null);
    return {
      net,
      days: traded.length,
      trades: traded.reduce((s, d) => s + d.trade_count, 0),
      greenPct: traded.length ? green / traded.length : null,
      best,
      greenMonths: active.filter((m) => m.net > 0).length,
      activeMonths: active.length,
    };
  }, [traded, months]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-4">
        {months.map((m, mi) => {
          const first = new Date(Date.UTC(year, mi, 1));
          const lead = (first.getUTCDay() + 6) % 7;
          const dim = new Date(Date.UTC(year, mi + 1, 0)).getUTCDate();
          const cells: (string | null)[] = [
            ...Array.from({ length: lead }, () => null),
            ...Array.from({ length: dim }, (_, d) => `${m.ym}-${String(d + 1).padStart(2, '0')}`),
          ];
          return (
            <div key={m.ym} className="min-w-0">
              <button
                className="mb-1 flex w-full items-baseline justify-between gap-1 rounded px-0.5 text-left hover:bg-slate-800/50"
                onClick={() => onPickMonth?.(m.ym)}
                title={`Open ${MONTHS[mi]} ${year} in month view`}
              >
                <span className="text-xs font-semibold text-slate-300">{MONTHS[mi]}</span>
                {m.days > 0 ? (
                  <span className={`num truncate text-[11px] font-semibold ${m.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatMoney(m.net, currency)}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-600">—</span>
                )}
              </button>
              <div className="grid grid-cols-7 gap-[3px]">
                {DOW.map((d, i) => (
                  <div key={i} className="text-center text-[9px] leading-3 text-slate-600">
                    {d}
                  </div>
                ))}
                {cells.map((day, i) => {
                  if (!day) return <div key={`x${i}`} />;
                  const c = byDay.get(day);
                  const has = !!c && c.trade_count > 0;
                  return (
                    <button
                      key={day}
                      disabled={!has}
                      onClick={() => has && setOpenDay(day)}
                      title={
                        has
                          ? `${day} · ${formatMoney(c!.net_pnl, currency)} · ${c!.trade_count} trade${c!.trade_count === 1 ? '' : 's'}`
                          : day
                      }
                      style={has ? cellStyle(c!.net_pnl, maxAbs) : undefined}
                      className={`aspect-square w-full rounded-[3px] ${
                        has
                          ? `cursor-pointer hover:ring-1 hover:ring-cyan-400 ${c!.net_pnl === 0 ? 'bg-slate-600/50' : ''}`
                          : 'cursor-default bg-slate-800/40'
                      } ${day === today ? 'ring-1 ring-cyan-500/70' : ''}`}
                      aria-label={has ? `${day} ${formatMoney(c!.net_pnl, currency)}` : day}
                    />
                  );
                })}
              </div>
              <div className="num mt-1 flex justify-between px-0.5 text-[10px] text-slate-500">
                <span>
                  {m.trades}t · {m.days}d
                </span>
                <span title="Green days / traded days">
                  {m.days ? `${Math.round((m.green / m.days) * 100)}% win days` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-800 pt-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
          <span>
            <span className="num font-semibold text-slate-300">{total.days}</span> days ·{' '}
            <span className="num font-semibold text-slate-300">{total.trades}</span> trades
          </span>
          <span>
            <span className="num font-semibold text-slate-300">{formatPct(total.greenPct)}</span> win days
          </span>
          {total.activeMonths > 0 && (
            <span>
              <span className="num font-semibold text-slate-300">
                {total.greenMonths}/{total.activeMonths}
              </span>{' '}
              green months
            </span>
          )}
          {total.best && total.best.net > 0 && (
            <span>
              best{' '}
              <span className="font-semibold text-slate-300">{MONTHS[Number(total.best.ym.slice(5)) - 1]}</span>{' '}
              <span className="num font-semibold text-emerald-400">{formatMoney(total.best.net, currency)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[10px] text-slate-500" aria-hidden>
            loss
            {[-1, -0.4, 0, 0.4, 1].map((v) => (
              <span
                key={v}
                className={`inline-block h-2.5 w-2.5 rounded-[2px] ${v === 0 ? 'bg-slate-800/40' : ''}`}
                style={v === 0 ? undefined : cellStyle(v, 1)}
              />
            ))}
            profit
          </span>
          <span className="text-sm">
            <span className="text-slate-500">Year total:&nbsp;</span>
            <span className={`num font-semibold ${total.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatMoney(total.net, currency)}
            </span>
          </span>
        </div>
      </div>

      {openDay && <DayTradesModal day={openDay} currency={currency} onClose={() => setOpenDay(null)} />}
    </div>
  );
}
