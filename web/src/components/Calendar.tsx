import { useEffect, useMemo, useState } from 'react';
import type { CalendarDay } from '../types';
import { formatMoney, formatR } from '../utils/format';
import DayTradesModal from './DayTradesModal';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Spot gold (and the indices) trade Mon–Fri, so the weekend columns are dead
// space on most months. Persisted like the other view prefs (see PricePanel).
const WEEKDAYS_ONLY_KEY = 'cal-weekdays-only';

// Both variants are spelled out in full so Tailwind's scanner emits them — a
// template-built class name would never make it into the stylesheet.
const GRID_7 = 'grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.15fr)]';
const GRID_5 = 'grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.15fr)]';

// Terminal palette (tailwind.config.js): emerald-400 #2ee56b / red-400 #ff5a5a.
const POS_RGB = '46,229,107';
const NEG_RGB = '255,90,90';

// Extra breathing room before the totals column, on top of the grid gap — a
// CSS grid `gap` is uniform, so the separation has to come from the column
// itself. Applied to the header and every week block so the rule stays aligned.
const WEEK_COL_GAP = 'ml-2.5';

// Amber rule down the left edge of the week column, separating the day cells
// from the totals. Longhand so it survives the shorthand `borderColor` that
// heat() sets — spread this *after* the heat style.
const WEEK_DIVIDER = {
  borderLeftWidth: '2px',
  borderLeftColor: 'rgba(245,166,35,0.65)', // term.amber #f5a623
} as const;

// Heat scaled by magnitude against the month's biggest day — the way Tradezella /
// TraderSync shade their P&L calendars, so the outlier days read at a glance
// instead of every winner looking identical.
function heat(pnl: number, maxAbs: number, strong = false) {
  if (pnl === 0 || maxAbs <= 0) return undefined;
  const mag = Math.min(1, Math.abs(pnl) / maxAbs);
  const rgb = pnl > 0 ? POS_RGB : NEG_RGB;
  // Ceilings stay low (0.25 day / 0.32 week): past ~0.35 the fill gets bright
  // enough that the slate secondary line on top of it stops being readable.
  const bg = (strong ? 0.12 : 0.08) + (strong ? 0.2 : 0.17) * mag;
  const border = `rgba(${rgb},${(0.3 + 0.45 * mag).toFixed(3)})`;
  return {
    backgroundColor: `rgba(${rgb},${bg.toFixed(3)})`,
    // Per-side longhands, never the `borderColor` shorthand. React diffs style
    // objects property by property, so on a re-render the shorthand can be
    // applied after the week column's borderLeftColor and silently wipe the
    // amber rule — and when a week stops being shaded, dropping the shorthand
    // resets all four sides, taking the rule with it. Longhands stay independent.
    borderTopColor: border,
    borderRightColor: border,
    borderBottomColor: border,
    borderLeftColor: border,
  };
}

// Cells show the exact figure, cents and all, so a five-figure day steps down a
// size rather than being abbreviated — the number stays readable and stays put
// inside the cell. Class names are spelled out for Tailwind's scanner.
function moneySize(s: string, strong = false): string {
  const [lg, md, sm] = strong
    ? ['text-xs', 'text-[11px]', 'text-[10px]']
    : ['text-[11px]', 'text-[10px]', 'text-[9px]'];
  return s.length <= 8 ? lg : s.length <= 10 ? md : sm;
}

function localTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

interface WeekStat {
  net_pnl: number;
  trade_count: number;
  days_traded: number;
  r: number | null;
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

  // Rows of 7, each paired with its aggregated week block.
  const weeks = useMemo(() => {
    const out: { cells: (CalendarDay | null)[]; stat: WeekStat }[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const row = cells.slice(i, i + 7);
      const traded = row.filter((c): c is CalendarDay => !!c && c.trade_count > 0);
      const rVals = traded.map((c) => c.r).filter((v): v is number => v != null);
      out.push({
        cells: row,
        stat: {
          net_pnl: traded.reduce((s, c) => s + c.net_pnl, 0),
          trade_count: traded.reduce((s, c) => s + c.trade_count, 0),
          days_traded: traded.length,
          r: rVals.length ? rVals.reduce((s, v) => s + v, 0) : null,
        },
      });
    }
    return out;
  }, [cells]);

  // Shared scale for the day heat; weeks get their own so a 5-day sum doesn't
  // wash every day cell out.
  const maxDayAbs = useMemo(
    () => Math.max(0, ...days.filter((d) => d.trade_count > 0).map((d) => Math.abs(d.net_pnl))),
    [days]
  );
  const maxWeekAbs = useMemo(
    () => Math.max(0, ...weeks.map((w) => Math.abs(w.stat.net_pnl))),
    [weeks]
  );

  const totals = useMemo(() => {
    const traded = days.filter((d) => d.trade_count > 0);
    const net = traded.reduce((s, d) => s + d.net_pnl, 0);
    const green = traded.filter((d) => d.net_pnl > 0).length;
    const red = traded.filter((d) => d.net_pnl < 0).length;
    const best = traded.reduce<CalendarDay | null>(
      (b, d) => (!b || d.net_pnl > b.net_pnl ? d : b),
      null
    );
    const worst = traded.reduce<CalendarDay | null>(
      (b, d) => (!b || d.net_pnl < b.net_pnl ? d : b),
      null
    );
    return {
      net,
      green,
      red,
      best,
      worst,
      days_traded: traded.length,
      trade_count: traded.reduce((s, d) => s + d.trade_count, 0),
    };
  }, [days]);

  const [weekdaysOnly, setWeekdaysOnly] = useState(() => {
    try {
      // Default on — gold and the indices don't trade the weekend.
      return localStorage.getItem(WEEKDAYS_ONLY_KEY) !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(WEEKDAYS_ONLY_KEY, weekdaysOnly ? '1' : '0');
    } catch {
      /* ignore — private mode / storage disabled */
    }
  }, [weekdaysOnly]);

  // A Sunday-evening gold reopen can land a trade on a hidden column. The week
  // and month figures still count it (they run off `days`, not the cells), so
  // flag it rather than let the row sums look wrong.
  const hiddenWeekend = useMemo(() => {
    if (!weekdaysOnly) return null;
    const wk = days.filter((d) => {
      if (d.trade_count === 0) return false;
      const dow = new Date(`${d.day}T00:00:00Z`).getUTCDay();
      return dow === 0 || dow === 6;
    });
    if (!wk.length) return null;
    return {
      days: wk.length,
      net_pnl: wk.reduce((s, d) => s + d.net_pnl, 0),
      trade_count: wk.reduce((s, d) => s + d.trade_count, 0),
    };
  }, [days, weekdaysOnly]);

  // With weekends hidden, a row that is nothing but Sat/Sun (a month starting on
  // a Saturday) would render as a blank strip — drop it, unless it carries P&L
  // that would otherwise have nowhere to show.
  const visibleWeeks = useMemo(() => {
    if (!weekdaysOnly) return weeks;
    return weeks.filter(
      (w) => w.cells.slice(0, 5).some((c) => c !== null) || w.stat.days_traded > 0
    );
  }, [weeks, weekdaysOnly]);

  const today = localTodayKey();
  const [openDay, setOpenDay] = useState<string | null>(null);

  // Day columns + a slightly wider week block on the right.
  const gridCols = weekdaysOnly ? GRID_5 : GRID_7;
  const headers = weekdaysOnly ? WEEKDAYS.slice(0, 5) : WEEKDAYS;

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <label
          className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500 hover:text-slate-300"
          title="Hide Saturday and Sunday — weekend P&L still counts toward the week and month totals"
        >
          <input
            type="checkbox"
            className="h-3 w-3 accent-indigo-500"
            checked={weekdaysOnly}
            onChange={(e) => setWeekdaysOnly(e.target.checked)}
          />
          Weekdays only
        </label>
      </div>

      <div className={`mb-2 grid ${gridCols} gap-1.5`}>
        {headers.map((w) => (
          <div
            key={w}
            className="text-center text-[11px] font-medium uppercase tracking-wide text-slate-500"
          >
            {w}
          </div>
        ))}
        <div
          style={WEEK_DIVIDER}
          className={`${WEEK_COL_GAP} text-center text-[11px] font-medium uppercase tracking-wide text-amber-500/80`}
        >
          Week
        </div>
      </div>

      <div className={`grid ${gridCols} gap-1.5`}>
        {visibleWeeks.map((w, wi) => (
          <WeekRow
            key={wi}
            week={w}
            label={`W${wi + 1}`}
            currency={currency}
            today={today}
            maxDayAbs={maxDayAbs}
            maxWeekAbs={maxWeekAbs}
            weekdaysOnly={weekdaysOnly}
            onOpenDay={setOpenDay}
          />
        ))}
      </div>

      {hiddenWeekend && (
        <button
          onClick={() => setWeekdaysOnly(false)}
          className="mt-2 w-full rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-left text-[11px] text-amber-500/90 hover:bg-amber-500/10"
        >
          {hiddenWeekend.days} weekend{' '}
          {hiddenWeekend.days === 1 ? 'day has' : 'days have'} trades (
          <span className="num">{formatMoney(hiddenWeekend.net_pnl, currency)}</span> ·{' '}
          {hiddenWeekend.trade_count}t) — counted in the totals but hidden. Show
          weekends.
        </button>
      )}

      {/* Month summary */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-800 pt-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
          <span>
            <span className="num font-semibold text-slate-300">{totals.days_traded}</span>{' '}
            days · <span className="num font-semibold text-slate-300">{totals.trade_count}</span>{' '}
            trades
          </span>
          <span>
            <span className="num font-semibold text-emerald-400">{totals.green}</span>
            <span className="text-slate-600">/</span>
            <span className="num font-semibold text-red-400">{totals.red}</span> green/red
          </span>
          {totals.best && totals.best.net_pnl > 0 && (
            <span title={`Best day: ${totals.best.day}`}>
              best{' '}
              <span className="num font-semibold text-emerald-400">
                {formatMoney(totals.best.net_pnl, currency)}
              </span>
            </span>
          )}
          {totals.worst && totals.worst.net_pnl < 0 && (
            <span title={`Worst day: ${totals.worst.day}`}>
              worst{' '}
              <span className="num font-semibold text-red-400">
                {formatMoney(totals.worst.net_pnl, currency)}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center text-sm">
          <span className="text-slate-500">Month total:&nbsp;</span>
          <span
            className={`num font-semibold ${
              totals.net >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {formatMoney(totals.net, currency)}
          </span>
        </div>
      </div>

      {openDay && (
        <DayTradesModal
          day={openDay}
          currency={currency}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

function WeekRow({
  week,
  label,
  currency,
  today,
  maxDayAbs,
  maxWeekAbs,
  weekdaysOnly,
  onOpenDay,
}: {
  week: { cells: (CalendarDay | null)[]; stat: WeekStat };
  label: string;
  currency: string;
  today: string;
  maxDayAbs: number;
  maxWeekAbs: number;
  weekdaysOnly: boolean;
  onOpenDay: (day: string) => void;
}) {
  const { stat } = week;
  const active = stat.days_traded > 0;
  // Drop the Sat/Sun columns only from the render — `stat` still sums all seven
  // so a weekend trade never silently vanishes from the week's P&L.
  const shown = weekdaysOnly ? week.cells.slice(0, 5) : week.cells;

  return (
    <>
      {shown.map((c, i) =>
        c === null ? (
          <div key={i} className="aspect-square rounded-lg" />
        ) : (
          <DayCell
            key={c.day}
            day={c}
            currency={currency}
            isToday={c.day === today}
            maxAbs={maxDayAbs}
            onOpen={onOpenDay}
          />
        )
      )}

      {/* Week block — the row's P&L, sitting beside the days it came from. */}
      <div
        title={
          active
            ? `${label} · ${formatMoney(stat.net_pnl, currency)} · ${stat.days_traded} days · ${stat.trade_count} trades`
            : `${label} · no trades`
        }
        style={{ ...(active ? heat(stat.net_pnl, maxWeekAbs, true) : {}), ...WEEK_DIVIDER }}
        className={`${WEEK_COL_GAP} flex flex-col justify-center gap-0.5 rounded-lg border pl-2.5 pr-2 py-1.5 ${
          !active
            ? 'border-slate-800/50 bg-slate-900/20'
            : // A week that nets exactly zero gets no heat style, so it needs an
              // explicit colour or `border` falls back to Tailwind's light default.
              stat.net_pnl === 0
              ? 'border-slate-700/50 bg-slate-800/40'
              : ''
        }`}
      >
        <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {active ? (
          <>
            <div
              className={`num font-semibold leading-tight ${moneySize(
                formatMoney(stat.net_pnl, currency),
                true
              )} ${stat.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {formatMoney(stat.net_pnl, currency)}
            </div>
            <div className="num text-[10px] leading-tight text-slate-500">
              {stat.days_traded}d · {stat.trade_count}t
            </div>
            {stat.r != null && (
              <div
                className={`num text-[10px] leading-tight ${
                  stat.r >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'
                }`}
              >
                {formatR(stat.r)}
              </div>
            )}
          </>
        ) : (
          <div className="num text-[11px] text-slate-700">—</div>
        )}
      </div>
    </>
  );
}

function DayCell({
  day: c,
  currency,
  isToday,
  maxAbs,
  onOpen,
}: {
  day: CalendarDay;
  currency: string;
  isToday: boolean;
  maxAbs: number;
  onOpen: (day: string) => void;
}) {
  const traded = c.trade_count > 0;
  return (
    <div
      onClick={traded ? () => onOpen(c.day) : undefined}
      role={traded ? 'button' : undefined}
      tabIndex={traded ? 0 : undefined}
      onKeyDown={
        traded
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(c.day);
              }
            }
          : undefined
      }
      title={`${c.day} · ${formatMoney(c.net_pnl, currency)} · ${c.trade_count} trades${
        c.r != null ? ` · ${formatR(c.r)}` : ''
      }`}
      style={traded ? heat(c.net_pnl, maxAbs) : undefined}
      className={`flex aspect-square flex-col justify-between rounded-lg border p-1.5 ${
        traded
          ? 'cursor-pointer transition hover:ring-2 hover:ring-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500'
          : 'border-slate-800/50 bg-slate-900/30'
      } ${traded && c.net_pnl === 0 ? 'border-slate-700/50 bg-slate-800/40' : ''} ${
        isToday ? 'ring-1 ring-indigo-500/70' : ''
      }`}
    >
      <div
        className={`text-[11px] ${isToday ? 'font-semibold text-indigo-300' : 'text-slate-400'}`}
      >
        {Number(c.day.slice(-2))}
      </div>
      {traded && (
        <div className="leading-tight">
          <div
            className={`num font-semibold ${moneySize(
              formatMoney(c.net_pnl, currency)
            )} ${c.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {formatMoney(c.net_pnl, currency)}
          </div>
          <div className="num text-[10px] text-slate-500">{c.trade_count}t</div>
        </div>
      )}
    </div>
  );
}
