import { Link } from 'react-router-dom';
import type { Trade } from '../types';
import { formatMoney, formatR, signClass, DISPLAY_TZ } from '../utils/format';

// "12 Jul 14:05" in the display timezone — compact enough for a narrow widget.
function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DISPLAY_TZ,
  });
}

// Last few closed trades matching the filters, each a link to its detail page.
export default function RecentTradesCard({
  rows,
  currency,
}: {
  rows: Trade[];
  currency: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No trades in range.</p>;
  }
  return (
    <ul className="-mx-1 flex flex-col">
      {rows.map((t) => (
        <li key={t.id}>
          <Link
            to={`/trades/${t.id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded px-1 py-1.5 transition hover:bg-slate-800/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`w-10 shrink-0 text-[11px] font-semibold uppercase ${
                  t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {t.direction}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-slate-200">
                  {t.instrument}
                </span>
                <span className="num block whitespace-nowrap text-[11px] text-slate-500">
                  {shortTime(t.exit_time ?? t.entry_time)}
                </span>
              </span>
            </span>
            <span className={`num text-right text-xs ${signClass(t.r_multiple)}`}>
              {t.r_multiple == null ? '' : formatR(t.r_multiple)}
            </span>
            <span className={`num w-20 text-right text-[13px] font-semibold ${signClass(t.net_pnl)}`}>
              {formatMoney(t.net_pnl, currency)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
