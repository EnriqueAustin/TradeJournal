import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from './states';
import type { Trade, Filters } from '../types';
import {
  formatMoney,
  formatR,
  formatNumber,
  formatDateTime,
  formatDuration,
} from '../utils/format';

function DirectionBadge({ dir }: { dir: string }) {
  const long = dir === 'long';
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
        long
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-red-500/15 text-red-400'
      }`}
    >
      {dir}
    </span>
  );
}

function Stat({
  label,
  value,
  valueClass = 'text-slate-200',
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num text-sm font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

// Session UTC windows, mirrored from server/src/util.js sessionFromTime().
// { start hour (UTC), length in hours }. asia wraps past midnight.
const SESSION_WINDOWS: Record<string, { start: number; len: number }> = {
  london: { start: 7, len: 5 },
  overlap: { start: 12, len: 4 },
  ny: { start: 16, len: 5 },
  off: { start: 21, len: 1 },
  asia: { start: 22, len: 9 },
};

function hh(h: number): string {
  return `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
}

// Horizontal timeline of trade entries within a session's UTC window.
function SessionTimeline({
  session,
  rows,
  currency,
}: {
  session: string;
  rows: Trade[];
  currency: string;
}) {
  const win = SESSION_WINDOWS[session];
  if (!win) return null;

  const marks = rows
    .map((t) => {
      if (!t.entry_time) return null;
      const d = new Date(t.entry_time);
      if (Number.isNaN(d.getTime())) return null;
      const hFrac = d.getUTCHours() + d.getUTCMinutes() / 60;
      // Offset from session start, wrapping across midnight.
      const off = ((hFrac - win.start + 24) % 24) / win.len;
      return { t, pos: Math.min(1, Math.max(0, off)) };
    })
    .filter((m): m is { t: Trade; pos: number } => m !== null);

  return (
    <div className="border-b border-slate-800 px-6 py-4">
      <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
        <span>Entries within session (UTC)</span>
        <span className="num">
          {hh(win.start)} → {hh(win.start + win.len)}
        </span>
      </div>
      <div className="relative h-9 rounded-lg border border-slate-800 bg-slate-950/40">
        {/* hour gridlines */}
        {Array.from({ length: win.len - 1 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 h-full w-px bg-slate-800/70"
            style={{ left: `${((i + 1) / win.len) * 100}%` }}
          />
        ))}
        {/* trade markers */}
        {marks.map((m) => (
          <div
            key={m.t.id}
            title={`${formatDateTime(m.t.entry_time)} · ${formatMoney(
              m.t.net_pnl,
              currency
            )}`}
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-950 ${
              m.t.net_pnl >= 0 ? 'bg-emerald-400' : 'bg-red-400'
            }`}
            style={{ left: `${m.pos * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export interface TradesDrilldownModalProps {
  title: string;
  subtitle?: React.ReactNode;
  filters: Filters;
  currency?: string;
  // When set, renders a timeline of entry times within this session window.
  timelineSession?: string;
  onClose: () => void;
}

export default function TradesDrilldownModal({
  title,
  subtitle,
  filters,
  currency = 'USD',
  timelineSession,
  onClose,
}: TradesDrilldownModalProps) {
  const { setups } = useFilters();
  const navigate = useNavigate();

  const setupName = (id: number | null) =>
    id == null ? null : setups.find((s) => s.id === id)?.name ?? null;

  const key = filterKey(filters);
  const { data, loading, error, reload } = useApi(
    () => api.getTrades(filters, 500, 0),
    [key]
  );

  const rows: Trade[] = data?.rows ?? [];

  const stats = useMemo(() => {
    let net = 0;
    let wins = 0;
    let losses = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let rSum = 0;
    let rCount = 0;
    for (const t of rows) {
      net += t.net_pnl;
      if (t.net_pnl > 0) {
        wins++;
        grossWin += t.net_pnl;
      } else if (t.net_pnl < 0) {
        losses++;
        grossLoss += Math.abs(t.net_pnl);
      }
      if (t.r_multiple != null) {
        rSum += t.r_multiple;
        rCount++;
      }
    }
    const decided = wins + losses;
    return {
      net,
      count: rows.length,
      winRate: decided > 0 ? wins / decided : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      avgR: rCount > 0 ? rSum / rCount : null,
      wins,
      losses,
    };
  }, [rows]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const goToTrade = (id: number) => {
    onClose();
    navigate(`/trades/${id}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative my-8 flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-bold capitalize text-slate-100">
              {title}
            </h2>
            <p className="text-xs text-slate-400">
              {subtitle ?? (
                <>
                  {stats.count} trade{stats.count === 1 ? '' : 's'} ·{' '}
                  {stats.wins}W / {stats.losses}L
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <AsyncBoundary
          loading={loading}
          error={error}
          onRetry={reload}
          isEmpty={rows.length === 0}
          emptyMessage="No trades found."
          loadingLabel="Loading trades…"
        >
          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-2 border-b border-slate-800 px-6 py-4 sm:grid-cols-3 md:grid-cols-5">
            <Stat
              label="Net P&L"
              value={formatMoney(stats.net, currency)}
              valueClass={stats.net >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <Stat
              label="Win Rate"
              value={
                stats.winRate == null
                  ? '—'
                  : `${(stats.winRate * 100).toFixed(0)}%`
              }
            />
            <Stat
              label="Profit Factor"
              value={
                stats.profitFactor == null
                  ? '—'
                  : formatNumber(stats.profitFactor, 2)
              }
              valueClass={
                stats.profitFactor == null
                  ? 'text-slate-200'
                  : stats.profitFactor >= 1
                    ? 'text-emerald-400'
                    : 'text-red-400'
              }
            />
            <Stat
              label="Avg R"
              value={formatR(stats.avgR)}
              valueClass={
                stats.avgR == null
                  ? 'text-slate-200'
                  : stats.avgR >= 0
                    ? 'text-emerald-400'
                    : 'text-red-400'
              }
            />
            <Stat label="Trades" value={stats.count} />
          </div>

          {/* Optional session entry-time timeline */}
          {timelineSession && (
            <SessionTimeline
              session={timelineSession}
              rows={rows}
              currency={currency}
            />
          )}

          {/* Trade table */}
          <div className="max-h-[55vh] overflow-y-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Instrument</th>
                  <th className="px-4 py-2.5 font-medium">Dir</th>
                  <th className="px-4 py-2.5 font-medium">Entry</th>
                  <th className="px-4 py-2.5 text-right font-medium">Size</th>
                  <th className="px-4 py-2.5 text-right font-medium">Hold</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net P&L</th>
                  <th className="px-4 py-2.5 text-right font-medium">R</th>
                  <th className="px-4 py-2.5 font-medium">Setup</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => goToTrade(t.id)}
                    className="cursor-pointer border-b border-slate-800/60 transition hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-200">
                      {t.instrument}
                    </td>
                    <td className="px-4 py-2.5">
                      <DirectionBadge dir={t.direction} />
                    </td>
                    <td className="num px-4 py-2.5 text-slate-400">
                      {formatDateTime(t.entry_time)}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-300">
                      {formatNumber(t.size, 2)}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-400">
                      {formatDuration(t.hold_time_sec)}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right font-semibold ${
                        t.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {formatMoney(t.net_pnl, currency)}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right ${
                        t.r_multiple == null
                          ? 'text-slate-500'
                          : t.r_multiple >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {formatR(t.r_multiple)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">
                      {setupName(t.setup_id) ? (
                        <span className="rounded bg-indigo-600/15 px-1.5 py-0.5 text-[11px] font-medium text-indigo-300">
                          {setupName(t.setup_id)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AsyncBoundary>
      </div>
    </div>
  );
}
