import { useState } from 'react';
import type { TradeDetail as TTradeDetail } from '../../types';
import { formatMoney, formatNumber, formatDateTime, signClass } from '../../utils/format';

// Breaks a trade into its entry fill(s) and each partial close, showing every
// partial's own price / size / P&L and how much position was left running.
export default function PartialsPanel({ trade }: { trade: TTradeDetail }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const execs = [...trade.executions].sort((a, b) =>
    a.exec_time.localeCompare(b.exec_time)
  );
  const entries = execs.filter((e) => e.side === 'in');
  const exits = execs.filter((e) => e.side === 'out');
  const entrySize = entries.reduce((s, e) => s + e.size, 0);

  // Running remaining size after each partial exit (in exit order).
  let remaining = entrySize;
  const rows = exits.map((ex, i) => {
    remaining = Math.max(0, remaining - ex.size);
    return { ex, n: i + 1, remaining, pctClosed: entrySize ? ex.size / entrySize : 0 };
  });

  const hasPnl = exits.some((e) => e.profit != null);

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Partials & Executions
        </h2>
        <span className="text-xs text-slate-500">
          {exits.length} {exits.length === 1 ? 'close' : 'closes'} ·{' '}
          {formatNumber(entrySize, 2)} entered
        </span>
      </div>

      {execs.length === 0 ? (
        <p className="text-sm text-slate-500">No executions recorded.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Entry summary */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-400">
                entry
              </span>
              <span className="text-slate-300">
                {formatNumber(entrySize, 2)} @{' '}
                {formatNumber(trade.entry_price, 2)}
              </span>
            </span>
            <span className="num text-xs text-slate-500">
              {formatDateTime(entries[0]?.exec_time ?? trade.entry_time)}
            </span>
          </div>

          {/* Each partial close */}
          {rows.map(({ ex, n, remaining, pctClosed }) => {
            const isOpen = open.has(ex.id);
            const flat = remaining <= 1e-9;
            return (
              <div
                key={ex.id}
                className="rounded-lg border border-slate-800 bg-slate-900/40"
              >
                <button
                  onClick={() => toggle(ex.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-800/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500">{isOpen ? '▾' : '▸'}</span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                      partial {n}/{exits.length}
                    </span>
                    <span className="num text-slate-300">
                      {formatNumber(ex.size, 2)} @ {formatNumber(ex.price, 2)}
                    </span>
                    <span className="text-xs text-slate-500">
                      ({(pctClosed * 100).toFixed(0)}%)
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {ex.profit != null && (
                      <span className={`num font-medium ${signClass(ex.profit)}`}>
                        {formatMoney(ex.profit)}
                      </span>
                    )}
                    <span className="num text-xs text-slate-500">
                      {flat ? 'closed' : `${formatNumber(remaining, 2)} left`}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-800 px-3 py-2 text-xs sm:grid-cols-4">
                    <Detail label="Time" value={formatDateTime(ex.exec_time)} />
                    <Detail label="Price" value={formatNumber(ex.price, 2)} />
                    <Detail label="Size" value={formatNumber(ex.size, 2)} />
                    <Detail
                      label="Remaining"
                      value={flat ? '0 (flat)' : formatNumber(remaining, 2)}
                    />
                    {ex.profit != null && (
                      <Detail
                        label="P&L"
                        value={formatMoney(ex.profit)}
                        className={signClass(ex.profit)}
                      />
                    )}
                    {ex.commission != null && (
                      <Detail label="Commission" value={formatMoney(ex.commission)} />
                    )}
                    {ex.swap != null && ex.swap !== 0 && (
                      <Detail label="Swap" value={formatMoney(ex.swap)} />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {hasPnl && (
            <div className="mt-1 flex items-center justify-between px-3 text-xs text-slate-500">
              <span>Sum of partials (gross)</span>
              <span className={`num ${signClass(trade.gross_pnl)}`}>
                {formatMoney(exits.reduce((s, e) => s + (e.profit ?? 0), 0))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num text-slate-300 ${className}`}>{value}</div>
    </div>
  );
}
