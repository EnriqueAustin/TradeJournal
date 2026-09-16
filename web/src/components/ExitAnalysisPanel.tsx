import { Link } from 'react-router-dom';
import { formatMoney, formatPct, formatR, formatDateTime, signClass, sessionLabel } from '../utils/format';
import { HOLD_TO_TARGET_LABELS } from './ExitAnalysisCard';
import type { ExitStats, HoldToTarget } from '../types';

function Tile({
  label,
  value,
  sub,
  valueClass = 'text-slate-200',
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`num mt-1 text-lg font-semibold ${valueClass}`}>{value}</div>
      {sub != null && <div className="num mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** Aggregate "price after exit" across the filtered trades (GET /api/stats/exits). */
export default function ExitAnalysisPanel({ data, currency = 'USD' }: { data: ExitStats; currency?: string }) {
  const holdKeys = (Object.keys(data.hold_to_target) as HoldToTarget[]).filter(
    (k) => data.hold_to_target[k] > 0
  );
  const top = data.trades.slice(0, 8);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Avg left on table"
          value={formatMoney(data.avg_left_usd, currency)}
          valueClass="text-amber-300"
          sub="best price within 60m of exit"
        />
        <Tile
          label="Avg left (R)"
          value={formatR(data.avg_left_r)}
          valueClass="text-amber-300"
          sub={`${data.r_sample} trades with R`}
        />
        <Tile
          label="Ran ≥1R after exit"
          value={data.continued_1r_pct == null ? '—' : formatPct(data.continued_1r_pct)}
          sub={`${data.continued_1r} of ${data.r_sample}`}
        />
        <Tile
          label="Analysed"
          value={`${data.sample} / ${data.total_scanned}`}
          sub="trades with post-exit bars"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Price after exit (in trade direction)
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1 font-medium">After</th>
                <th className="pb-1 text-right font-medium">Avg move</th>
                <th className="pb-1 text-right font-medium">Avg R</th>
                <th className="pb-1 text-right font-medium">Avg best R</th>
                <th className="pb-1 text-right font-medium">Kept going</th>
              </tr>
            </thead>
            <tbody>
              {data.horizons.map((h) => (
                <tr key={h.minutes} className="border-t border-slate-800/60">
                  <td className="py-1.5 text-slate-300">{h.minutes}m</td>
                  <td className={`num py-1.5 text-right ${signClass(h.avg_move_usd)}`}>
                    {formatMoney(h.avg_move_usd, currency)}
                  </td>
                  <td className={`num py-1.5 text-right ${signClass(h.avg_move_r)}`}>{formatR(h.avg_move_r)}</td>
                  <td className="num py-1.5 text-right text-amber-300/90">{formatR(h.avg_best_r)}</td>
                  <td className="num py-1.5 text-right text-slate-400">{formatPct(h.pct_continued)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            By session
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1 font-medium">Session</th>
                <th className="pb-1 text-right font-medium">Trades</th>
                <th className="pb-1 text-right font-medium">Avg left</th>
                <th className="pb-1 text-right font-medium">Avg left R</th>
                <th className="pb-1 text-right font-medium">≥1R after</th>
              </tr>
            </thead>
            <tbody>
              {data.by_session.map((s) => (
                <tr key={s.key} className="border-t border-slate-800/60">
                  <td className="py-1.5 text-slate-300">{sessionLabel(s.key)}</td>
                  <td className="num py-1.5 text-right text-slate-400">{s.sample}</td>
                  <td className="num py-1.5 text-right text-amber-300/90">{formatMoney(s.avg_left_usd, currency)}</td>
                  <td className="num py-1.5 text-right text-amber-300/90">{formatR(s.avg_left_r)}</td>
                  <td className="num py-1.5 text-right text-slate-400">{formatPct(s.continued_1r_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {holdKeys.length > 0 && (
            <div className="mt-3 text-xs text-slate-400">
              <span className="text-slate-500">Hold to target: </span>
              {holdKeys.map((k) => `${HOLD_TO_TARGET_LABELS[k]} ${data.hold_to_target[k]}`).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {top.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Most left on the table
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-1 font-medium">Trade</th>
                <th className="pb-1 font-medium">Exit</th>
                <th className="pb-1 text-right font-medium">Net P&L</th>
                <th className="pb-1 text-right font-medium">Left</th>
                <th className="pb-1 text-right font-medium">Left R</th>
              </tr>
            </thead>
            <tbody>
              {top.map((t) => (
                <tr key={t.id} className="border-t border-slate-800/60">
                  <td className="py-1.5">
                    <Link to={`/trades/${t.id}`} className="text-cyan-400 hover:underline">
                      #{t.id} {t.instrument} {t.direction}
                    </Link>
                  </td>
                  <td className="num py-1.5 text-slate-400">{formatDateTime(t.exit_time)}</td>
                  <td className={`num py-1.5 text-right ${signClass(t.net_pnl)}`}>{formatMoney(t.net_pnl, currency)}</td>
                  <td className="num py-1.5 text-right text-amber-300/90">{formatMoney(t.left_usd, currency)}</td>
                  <td className="num py-1.5 text-right text-amber-300/90">
                    {formatR(t.left_r)}
                    {t.r_kind === 'derived' && t.left_r != null ? '~' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        From stored OANDA bars (S5 when available, else M1) opening at/after each exit. "Left on
        table" is the best price reachable within 60 minutes — hindsight, not a realistic exit.
        R uses the recorded stop, or the modeled risk (~) when none was set.
      </p>
    </div>
  );
}
