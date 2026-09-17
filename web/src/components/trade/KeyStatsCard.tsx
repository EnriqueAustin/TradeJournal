import type { TradeDetail as TTradeDetail } from '../../types';
import {
  formatMoney,
  formatR,
  formatNumber,
  formatDateTime,
  formatDuration,
  signClass,
} from '../../utils/format';

// Marks an MAE/MFE value that was derived from price bars, not entered by hand.
function AutoMark() {
  return (
    <span
      className="ml-1 rounded bg-slate-800 px-1 font-sans text-[11px] uppercase text-slate-500"
      title="Auto-derived from stored price bars (S5 when available, else M1)"
    >
      auto
    </span>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="num mt-0.5 text-[13px] text-slate-200">{children}</div>
    </div>
  );
}

// Side-rail summary of the fill: result first, then prices, timing, size and
// excursion. Everything here is read-only — edits live in Risk Levels.
export default function KeyStatsCard({ trade }: { trade: TTradeDetail }) {
  return (
    <div className="card p-4">
      <div className="flex items-end justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Net P&L</div>
          <div className={`num text-2xl font-semibold ${signClass(trade.net_pnl)}`}>
            {formatMoney(trade.net_pnl)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">R</div>
          <div className={`num text-xl font-semibold ${signClass(trade.r_multiple)}`}>
            {formatR(trade.r_multiple)}
            {trade.r_derived ? (
              <span
                className="ml-1 text-slate-500"
                title="Derived from the account's default risk — no stop was recorded"
              >
                ~
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Entry">{formatNumber(trade.entry_price, 2)}</Field>
        <Field label="Exit">{formatNumber(trade.exit_price, 2)}</Field>
        <Field label="Entry Time" wide>
          {formatDateTime(trade.entry_time)}
        </Field>
        <Field label="Exit Time" wide>
          {formatDateTime(trade.exit_time)}
        </Field>
        <Field label="Hold">{formatDuration(trade.hold_time_sec)}</Field>
        <Field label="Size">{formatNumber(trade.size, 2)}</Field>
        <Field label="MAE">
          {trade.mae == null ? '—' : formatNumber(trade.mae, 2)}
          {trade.mae != null && trade.mae_auto ? <AutoMark /> : null}
        </Field>
        <Field label="MFE">
          {trade.mfe == null ? '—' : formatNumber(trade.mfe, 2)}
          {trade.mfe != null && trade.mfe_auto ? <AutoMark /> : null}
        </Field>
        <Field label="Gross P&L">
          <span className={signClass(trade.gross_pnl)}>{formatMoney(trade.gross_pnl)}</span>
        </Field>
        <Field label="Commission">{formatMoney(trade.commission)}</Field>
        <Field label="Swap">{formatMoney(trade.swap)}</Field>
        <Field label="Source">
          <span className="uppercase">{trade.source}</span>
        </Field>
      </div>
    </div>
  );
}
