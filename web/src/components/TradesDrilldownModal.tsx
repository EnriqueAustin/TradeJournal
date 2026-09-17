import { useEffect, useMemo, useState } from 'react';
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
  formatDate,
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
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num text-sm font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

// Default session UTC windows for the drilldown timeline (northern-summer
// spans of server util.js sessionFromTime). { start hour (UTC), length in
// hours }. asia wraps past midnight. Real boundaries shift ±1h with DST, so
// buildTimeline widens the window to cover any entry that falls outside it
// rather than clamping it into the wrong hour.
const SESSION_WINDOWS: Record<string, { start: number; len: number }> = {
  london: { start: 7, len: 5 },
  ny: { start: 12, len: 9 },
  off: { start: 21, len: 1 },
  asia: { start: 21, len: 10 },
};

function hh(h: number): string {
  return `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
}

interface TimelineMark {
  t: Trade;
  pos: number; // 0..1 across the timeline
  seg: number; // one-hour segment index
}

interface Timeline {
  start: number; // UTC hour of segment 0 (may be <0 or >23; format with hh)
  len: number; // number of one-hour segments
  marks: TimelineMark[];
}

function buildTimeline(session: string, rows: Trade[]): Timeline | null {
  const win = SESSION_WINDOWS[session];
  if (!win) return null;
  // Out-of-window gap is split evenly: entries just before the window count as
  // negative offsets, entries just after as offsets past its end.
  const gapMid = win.len + (24 - win.len) / 2;
  const offs: { t: Trade; off: number }[] = [];
  for (const t of rows) {
    if (!t.entry_time) continue;
    const d = new Date(t.entry_time);
    if (Number.isNaN(d.getTime())) continue;
    const hFrac =
      d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    let off = (((hFrac - win.start) % 24) + 24) % 24;
    if (off >= gapMid) off -= 24;
    offs.push({ t, off });
  }
  let first = 0;
  let last = win.len; // exclusive
  for (const { off } of offs) {
    first = Math.min(first, Math.floor(off));
    last = Math.max(last, Math.floor(off) + 1);
  }
  const len = last - first;
  return {
    start: win.start + first,
    len,
    marks: offs.map(({ t, off }) => ({
      t,
      pos: (off - first) / len,
      seg: Math.floor(off) - first,
    })),
  };
}

// Horizontal timeline of trade entries within a session's UTC window.
// Clicking an hour segment filters the trade table to that hour.
function SessionTimeline({
  timeline,
  currency,
  selected,
  onSelect,
}: {
  timeline: Timeline;
  currency: string;
  selected: number | null;
  onSelect: (seg: number | null) => void;
}) {
  const { marks } = timeline;
  const win = timeline;
  const toggle = (i: number) => onSelect(selected === i ? null : i);

  // Per-hour segment breakdown: win rate for entries in that hour.
  const segments = Array.from({ length: win.len }, (_, i) => ({
    start: win.start + i,
    wins: 0,
    losses: 0,
    be: 0,
    net: 0,
  }));
  for (const m of marks) {
    const seg = segments[m.seg];
    seg.net += m.t.net_pnl;
    if (m.t.is_be) seg.be++;
    else if (m.t.net_pnl > 0) seg.wins++;
    else if (m.t.net_pnl < 0) seg.losses++;
    else seg.be++;
  }
  const cols = { gridTemplateColumns: `repeat(${win.len}, minmax(0, 1fr))` };

  return (
    <div className="border-b border-slate-800 px-6 py-4">
      <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
        <span>Entries within session (UTC)</span>
        <span className="num">
          {hh(win.start)} → {hh(win.start + win.len)}
        </span>
      </div>
      {/* segment time labels */}
      <div className="mb-1 grid" style={cols}>
        {segments.map((s, i) => (
          <button
            key={s.start}
            type="button"
            onClick={() => toggle(i)}
            className={`num rounded text-center text-[11px] transition hover:text-cyan-300 ${
              selected === i ? 'font-semibold text-cyan-300' : 'text-slate-400'
            }`}
          >
            {hh(s.start)}
          </button>
        ))}
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
              m.t.is_be
                ? 'bg-slate-400'
                : m.t.net_pnl > 0
                ? 'bg-emerald-400'
                : m.t.net_pnl < 0
                  ? 'bg-red-400'
                  : 'bg-slate-400'
            }`}
            style={{ left: `${m.pos * 100}%` }}
          />
        ))}
      </div>
      {/* per-segment win rate */}
      <div>
        <div className="mt-2 grid gap-1" style={cols}>
          {segments.map((s, i) => {
            const n = s.wins + s.losses + s.be;
            // wins ÷ all trades (break-even counts), same as the dashboard.
            const wr = n > 0 ? s.wins / n : null;
            return (
              <button
                key={s.start}
                type="button"
                onClick={() => toggle(i)}
                className={`rounded-md border px-1 py-1.5 text-center transition hover:border-cyan-500/60 ${
                  selected === i
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-800 bg-slate-950/40'
                }`}
                title={`${hh(s.start)}–${hh(s.start + 1)} · ${s.wins}W / ${s.losses}L${s.be ? ` / ${s.be}BE` : ''} · ${formatMoney(s.net, currency)} · click to filter`}
              >
                {n === 0 ? (
                  <div className="text-[11px] text-slate-600">—</div>
                ) : (
                  <>
                    <div
                      className={`num text-xs font-semibold ${
                        wr == null
                          ? 'text-slate-400'
                          : wr >= 0.5
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {wr == null ? '—' : `${Math.round(wr * 100)}%`}
                    </div>
                    <div className="num text-[11px] text-slate-400">
                      {s.wins}W/{s.losses}L{s.be ? `/${s.be}BE` : ''}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
        <span>win rate by entry hour</span>
        <span className="ml-auto">
          {selected == null ? (
            'click an hour to filter trades'
          ) : (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="rounded bg-cyan-600/15 px-1.5 py-0.5 text-cyan-300 hover:bg-cyan-600/25"
            >
              {hh(win.start + selected)}–{hh(win.start + selected + 1)} ✕
            </button>
          )}
        </span>
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
  // When set, renders a per-day P&L / win-rate strip (e.g. for a week).
  dayBreakdown?: boolean;
  // Optional node rendered in the header (e.g. a link to the day journal).
  headerAction?: React.ReactNode;
  onClose: () => void;
}

export default function TradesDrilldownModal({
  title,
  subtitle,
  filters,
  currency = 'USD',
  timelineSession,
  dayBreakdown = false,
  headerAction,
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

  const rows: Trade[] = useMemo(() => data?.rows ?? [], [data]);
  const timeline = useMemo(
    () => (timelineSession ? buildTimeline(timelineSession, rows) : null),
    [timelineSession, rows]
  );
  // Selected one-hour segment, keyed by its UTC start hour so it survives the
  // timeline widening when rows reload.
  const [hourStart, setHourStart] = useState<number | null>(null);
  const hourSeg =
    timeline && hourStart != null ? hourStart - timeline.start : null;
  const tableRows =
    timeline && hourSeg != null
      ? timeline.marks.filter((m) => m.seg === hourSeg).map((m) => m.t)
      : rows;

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
      if (t.is_be) {
        // break-even: neither win nor loss
      } else if (t.net_pnl > 0) {
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
    // wins ÷ all trades (break-even counts), same as server summary().
    const pnls = rows.map((t) => t.net_pnl);
    return {
      net,
      count: rows.length,
      winRate: rows.length > 0 ? wins / rows.length : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      avgR: rCount > 0 ? rSum / rCount : null,
      avgWin: wins > 0 ? grossWin / wins : null,
      avgLoss: losses > 0 ? -grossLoss / losses : null,
      expectancy: rows.length > 0 ? net / rows.length : null,
      best: pnls.length ? Math.max(...pnls) : null,
      worst: pnls.length ? Math.min(...pnls) : null,
      wins,
      losses,
    };
  }, [rows]);

  // Per-day breakdown (realized date, as the calendar buckets it).
  const days = useMemo(() => {
    if (!dayBreakdown) return [];
    const m = new Map<string, { day: string; net: number; wins: number; losses: number; count: number }>();
    for (const t of rows) {
      const day = (t.exit_time ?? t.entry_time)?.slice(0, 10);
      if (!day) continue;
      const d = m.get(day) ?? { day, net: 0, wins: 0, losses: 0, count: 0 };
      d.net += t.net_pnl;
      d.count++;
      if (!t.is_be && t.net_pnl > 0) d.wins++;
      else if (!t.is_be && t.net_pnl < 0) d.losses++;
      m.set(day, d);
    }
    return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [rows, dayBreakdown]);

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
      className="tj-modal fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="tj-modal-panel relative my-8 flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
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
          <div className="flex items-center gap-2">
            {headerAction}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
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
            <Stat
              label="Expectancy"
              value={stats.expectancy == null ? '—' : formatMoney(stats.expectancy, currency)}
              valueClass={
                stats.expectancy == null
                  ? 'text-slate-200'
                  : stats.expectancy >= 0
                    ? 'text-emerald-400'
                    : 'text-red-400'
              }
            />
            <Stat
              label="Avg Win"
              value={stats.avgWin == null ? '—' : formatMoney(stats.avgWin, currency)}
              valueClass="text-emerald-400"
            />
            <Stat
              label="Avg Loss"
              value={stats.avgLoss == null ? '—' : formatMoney(stats.avgLoss, currency)}
              valueClass="text-red-400"
            />
            <Stat
              label="Best Trade"
              value={stats.best == null ? '—' : formatMoney(stats.best, currency)}
              valueClass={(stats.best ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <Stat
              label="Worst Trade"
              value={stats.worst == null ? '—' : formatMoney(stats.worst, currency)}
              valueClass={(stats.worst ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
          </div>

          {/* Optional per-day breakdown */}
          {dayBreakdown && days.length > 0 && (
            <div className="border-b border-slate-800 px-6 py-4">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">
                By day
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {days.map((d) => {
                  // wins ÷ all trades, as above.
                  return (
                    <div
                      key={d.day}
                      className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                    >
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        {formatDate(`${d.day}T12:00:00Z`)}
                      </div>
                      <div
                        className={`num text-sm font-semibold ${
                          d.net >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatMoney(d.net, currency)}
                      </div>
                      <div className="num text-[11px] text-slate-400">
                        {d.count}t · {d.wins}W/{d.losses}L ·{' '}
                        {d.count ? `${Math.round((d.wins / d.count) * 100)}%` : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional session entry-time timeline */}
          {timeline && (
            <SessionTimeline
              timeline={timeline}
              currency={currency}
              selected={hourSeg}
              onSelect={(seg) =>
                setHourStart(seg == null ? null : timeline.start + seg)
              }
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
                {tableRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-500">
                      No trades in this hour.
                    </td>
                  </tr>
                )}
                {tableRows.map((t) => (
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
                        <span className="rounded bg-cyan-600/15 px-1.5 py-0.5 text-[11px] font-medium text-cyan-300">
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
