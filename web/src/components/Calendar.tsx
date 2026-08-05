import { useMemo } from 'react';
import type { CalendarDay } from '../types';
import { formatMoney } from '../utils/format';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pnlBg(pnl: number): string {
  if (pnl === 0) return 'bg-slate-800/40 border-slate-700/50';
  return pnl > 0
    ? 'bg-emerald-500/15 border-emerald-500/40'
    : 'bg-red-500/15 border-red-500/40';
}

export default function Calendar({
  month,
  days,
  currency = 'USD',
}: {
  month: string; // YYYY-MM
  days: CalendarDay[];
  currency?: string;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    for (const d of days) m.set(d.day, d);
    return m;
  }, [days]);

  const cells = useMemo(() => {
    const [y, mo] = month.split('-').map(Number);
    if (!y || !mo) return [];
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    // Monday-first offset
    const jsDow = first.getUTCDay(); // 0=Sun
    const lead = (jsDow + 6) % 7;
    const out: (CalendarDay | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out.push(byDay.get(key) ?? { day: key, net_pnl: 0, trade_count: 0, r: null });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month, byDay]);

  const monthTotal = useMemo(
    () => days.reduce((s, d) => s + d.net_pnl, 0),
    [days]
  );

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-center text-[11px] font-medium uppercase tracking-wide text-slate-500"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) =>
          c === null ? (
            <div key={i} className="aspect-square rounded-lg" />
          ) : (
            <div
              key={c.day}
              title={`${c.day} · ${formatMoney(c.net_pnl, currency)} · ${c.trade_count} trades`}
              className={`flex aspect-square flex-col justify-between rounded-lg border p-1.5 ${
                c.trade_count > 0
                  ? pnlBg(c.net_pnl)
                  : 'border-slate-800/50 bg-slate-900/30'
              }`}
            >
              <div className="text-[11px] text-slate-400">
                {Number(c.day.slice(-2))}
              </div>
              {c.trade_count > 0 && (
                <div className="leading-tight">
                  <div
                    className={`num text-[11px] font-semibold ${
                      c.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatMoney(c.net_pnl, currency)}
                  </div>
                  <div className="num text-[10px] text-slate-500">
                    {c.trade_count}t
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
      <div className="mt-3 flex justify-end text-sm">
        <span className="text-slate-500">Month total:&nbsp;</span>
        <span
          className={`num font-semibold ${
            monthTotal >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {formatMoney(monthTotal, currency)}
        </span>
      </div>
    </div>
  );
}
