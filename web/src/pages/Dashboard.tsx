import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import LivePositions from '../components/LivePositions';
import { ReminderSettingsButton, ReviewReminderBanner } from '../components/ReviewReminders';
import { DashboardProvider, WIDGETS, type DashboardCtx, type WidgetDef } from '../components/dashboard/widgets';
import {
  defaultLayout,
  loadLayout,
  saveLayout,
  moveWidget,
  stepWidget,
  toggleIn,
  type LayoutState,
} from '../components/dashboard/layout';
import type { PropStats } from '../types';
import { formatMoney, formatPct } from '../utils/format';

const RECENT_TRADES = 8;

// UTC month, matching the server's realized-date buckets.
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function PropBanner({ p, currency }: { p: PropStats; currency: string }) {
  const hasLimits = p.day_loss_limit != null || p.max_dd_limit != null || p.target != null;
  if (!hasLimits) return null;

  const statusMap = {
    ok: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-400',
    warn: 'border-amber-800/60 bg-amber-950/30 text-amber-400',
    breach: 'border-red-800/60 bg-red-950/30 text-red-400',
  } as const;

  function MiniMeter({ label, pct, danger }: { label: string; pct: number | null; danger?: boolean }) {
    if (pct == null) return null;
    const w = Math.min(100, Math.max(0, pct * 100));
    const color = pct >= 1 ? 'bg-red-500' : pct >= 0.8 ? 'bg-amber-500' : danger === false ? 'bg-cyan-500' : 'bg-emerald-500';
    return (
      <div className="min-w-[100px] flex-1">
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-slate-500">
          <span>{label}</span>
          <span className="num">{formatPct(pct)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${statusMap[p.status]}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide">
            {p.status === 'ok' ? 'OK' : p.status === 'warn' ? 'Warning' : 'Breach'}
          </span>
          <span className="num text-xs opacity-70">Equity {formatMoney(p.current_equity, currency)}</span>
          {p.dd_type && (
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
              {p.dd_type === 'trailing' ? 'trailing' : 'static'} DD
            </span>
          )}
          {p.phase > 0 && <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px]">Phase {p.phase}</span>}
        </div>
        <div className="flex flex-1 items-center gap-4">
          <MiniMeter label="Daily Loss" pct={p.day_loss_used_pct} />
          <MiniMeter label={`Max DD${p.dd_type === 'trailing' ? ' (trail)' : ''}`} pct={p.max_dd_used_pct} />
          <MiniMeter label="Target" pct={p.target_progress_pct} danger={false} />
        </div>
      </div>
    </div>
  );
}

// $ / R unit toggle — switches P&L-denominated tiles and the equity curve
// between money and R-multiples (risk units), the way rival journals do.
function UnitToggle({ unit, onChange }: { unit: 'money' | 'r'; onChange: (u: 'money' | 'r') => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-800">
      {(['money', 'r'] as const).map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          className={`px-2.5 py-1 text-xs font-semibold ${
            unit === u ? 'bg-cyan-600 text-white' : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
          }`}
        >
          {u === 'money' ? '$' : 'R'}
        </button>
      ))}
    </div>
  );
}

const WIDE = 'lg:col-span-12';
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

export default function Dashboard() {
  const { filters, accounts } = useFilters();
  const [month, setMonth] = useState(currentMonth);
  // The calendar and heatmap are also scoped by the date range, so a month
  // outside it would render empty. When the range moves off the picked month,
  // follow it to the range's last month.
  useEffect(() => {
    const fromM = filters.from ? filters.from.slice(0, 7) : '';
    const toM = filters.to ? filters.to.slice(0, 7) : '';
    setMonth((m) => {
      if (toM && m > toM) return toM;
      if (fromM && m < fromM) return toM || fromM;
      return m;
    });
  }, [filters.from, filters.to]);
  const [unit, setUnit] = useState<'money' | 'r'>('money');

  // "2026-08" → "August 2026", for cards that follow the month picker but don't
  // own one.
  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [month]);

  const currency = useMemo(
    () => accounts.find((a) => a.id === filters.account)?.currency ?? 'USD',
    [accounts, filters.account]
  );
  const isProp = useMemo(
    () => accounts.find((a) => a.id === filters.account)?.account_type === 'prop',
    [accounts, filters.account]
  );

  const key = filterKey(filters);

  const summary = useApi(() => api.getSummary(filters), [key]);
  const reportCard = useApi(() => api.getReportCard(filters), [key]);
  // Most recent trade matching the filters (trades sort newest-realized first).
  // The calendar + heatmap open on its month rather than the current one, which
  // is often empty; once the user picks a month by hand we stop following it.
  // Also feeds the Recent Trades widget.
  const latest = useApi(() => api.getTrades(filters, RECENT_TRADES, 0), [key]);
  const lastTradeMonth = useMemo(() => {
    const t = latest.data?.rows[0];
    return (t?.exit_time ?? t?.entry_time ?? '').slice(0, 7);
  }, [latest.data]);
  const monthPicked = useRef(false);
  useEffect(() => {
    if (lastTradeMonth && !monthPicked.current) setMonth(lastTradeMonth);
  }, [lastTradeMonth]);
  const pickMonth = (m: string) => {
    monthPicked.current = true;
    setMonth(m);
  };

  const prop = useApi(() => (isProp ? api.getProp(filters) : Promise.resolve(null)), [key, isProp]);

  const ctx: DashboardCtx = {
    filters,
    fkey: key,
    currency,
    unit,
    month,
    monthLabel,
    pickMonth,
    lastTradeMonth,
    summary,
    reportCard,
    latest,
  };

  // ----- layout (per profile, localStorage) -----
  const profile = filters.profile ?? null;
  const [layout, setLayoutState] = useState<LayoutState>(() => loadLayout(profile, WIDGETS));
  useEffect(() => setLayoutState(loadLayout(profile, WIDGETS)), [profile]);
  const setLayout = (next: LayoutState) => {
    setLayoutState(next);
    saveLayout(profile, next);
  };
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);

  const visible = layout.order
    .filter((id) => !layout.hidden.includes(id))
    .map((id) => BY_ID.get(id))
    .filter((w): w is WidgetDef => !!w);
  const hiddenDefs = WIDGETS.filter((w) => layout.hidden.includes(w.id));
  const isDefault = JSON.stringify(layout) === JSON.stringify(defaultLayout(WIDGETS));

  // The equity card spans two rows beside a stacked pair of 4-col cards (Edge
  // Score + Discipline by default) — only when that pair actually follows it,
  // otherwise the row-span would leave a hole.
  const narrow = (w?: WidgetDef) => !!w && w.span === 'lg:col-span-4' && !layout.wide.includes(w.id);
  const spanClass = (w: WidgetDef, i: number) => {
    if (layout.wide.includes(w.id)) return WIDE;
    if (w.span === 'lg:col-span-8' && narrow(visible[i + 1]) && narrow(visible[i + 2])) {
      return 'lg:col-span-8 lg:row-span-2';
    }
    return w.span;
  };

  return (
    <DashboardProvider value={ctx}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="hidden items-baseline gap-3 md:flex">
            <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
            <p className="text-sm text-slate-500">Performance across the selected filters.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/quick" className="btn btn-primary text-xs" title="Grade and note today's trades">
              + Quick capture
            </Link>
            {/* Drag-and-drop layout editing is a desktop affordance. */}
            <button
              className={`btn hidden text-xs md:inline-flex ${editing ? 'btn-primary' : ''}`}
              onClick={() => setEditing((e) => !e)}
              title="Show, hide, reorder and resize dashboard widgets"
            >
              {editing ? 'Done' : 'Customise'}
            </button>
            <ReminderSettingsButton />
            <UnitToggle unit={unit} onChange={setUnit} />
          </div>
        </div>

        {editing && (
          <div className="card hidden flex-col gap-2 border-dashed md:flex border-cyan-500/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                Drag widgets by their handle (or use ↑ ↓) to reorder · ⇔ toggles wide · ✕ hides. Saved
                {profile == null ? ' for All profiles' : ' for this profile'}.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn text-xs"
                  disabled={isDefault}
                  onClick={() => {
                    if (window.confirm('Reset the dashboard to the default layout?')) {
                      setLayoutState(defaultLayout(WIDGETS));
                      saveLayout(profile, null);
                    }
                  }}
                >
                  Reset layout
                </button>
                <button className="btn btn-primary text-xs" onClick={() => setEditing(false)}>
                  Done
                </button>
              </div>
            </div>
            {hiddenDefs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-slate-500">Hidden:</span>
                {hiddenDefs.map((w) => (
                  <button
                    key={w.id}
                    className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
                    title={w.description}
                    onClick={() => setLayout({ ...layout, hidden: toggleIn(layout.hidden, w.id, false) })}
                  >
                    + {w.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ReviewReminderBanner account={filters.account} profile={filters.profile ?? null} />

        {/* Live open positions (rendered only when EA snapshot present) */}
        <LivePositions account={filters.account} currency={currency} />

        {/* Prop status banner */}
        {isProp && prop.data && <PropBanner p={prop.data} currency={currency} />}

        {visible.length === 0 && (
          <div className="card p-6 text-center text-sm text-slate-500">
            Every widget is hidden.{' '}
            <button className="text-cyan-400 hover:underline" onClick={() => setEditing(true)}>
              Customise
            </button>{' '}
            to add some back.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {visible.map((w, i) => {
            const { Component } = w;
            const isWide = layout.wide.includes(w.id);
            const hint = dropHint?.id === w.id ? dropHint : null;
            return (
              <div
                key={w.id}
                className={`relative min-w-0 ${spanClass(w, i)} ${
                  editing ? 'rounded-xl outline-dashed outline-1 outline-offset-2 outline-slate-700' : ''
                } ${dragId === w.id ? 'opacity-40' : ''}`}
                onDragOver={
                  editing && dragId
                    ? (e) => {
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const after =
                          r.width > r.height * 1.5
                            ? e.clientX > r.left + r.width / 2
                            : e.clientY > r.top + r.height / 2;
                        if (hint?.after !== after || !hint) setDropHint({ id: w.id, after });
                      }
                    : undefined
                }
                onDragLeave={editing ? () => setDropHint((h) => (h?.id === w.id ? null : h)) : undefined}
                onDrop={
                  editing && dragId
                    ? (e) => {
                        e.preventDefault();
                        if (dragId !== w.id) setLayout(moveWidget(layout, dragId, w.id, hint?.after ?? false));
                        setDragId(null);
                        setDropHint(null);
                      }
                    : undefined
                }
              >
                {hint && dragId && dragId !== w.id && (
                  <div
                    className={`pointer-events-none absolute z-20 rounded bg-cyan-400 ${
                      hint.after ? '-right-2.5 top-0 h-full w-1' : '-left-2.5 top-0 h-full w-1'
                    }`}
                  />
                )}
                {editing && (
                  <div className="mb-1.5 flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1 text-xs">
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', w.id);
                        setDragId(w.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropHint(null);
                      }}
                      className="cursor-grab select-none px-1 text-slate-500 hover:text-slate-200 active:cursor-grabbing"
                      title="Drag to reorder"
                      aria-label={`Drag ${w.title}`}
                    >
                      ⠿
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-300" title={w.description}>
                      {w.title}
                    </span>
                    <button
                      className="rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
                      onClick={() => setLayout(stepWidget(layout, w.id, -1))}
                      disabled={i === 0}
                      title="Move up"
                      aria-label={`Move ${w.title} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
                      onClick={() => setLayout(stepWidget(layout, w.id, 1))}
                      disabled={i === visible.length - 1}
                      title="Move down"
                      aria-label={`Move ${w.title} down`}
                    >
                      ↓
                    </button>
                    {!w.full && (
                      <button
                        className={`rounded px-1.5 hover:bg-slate-800 ${isWide ? 'text-cyan-400' : 'text-slate-400 hover:text-slate-100'}`}
                        onClick={() => setLayout({ ...layout, wide: toggleIn(layout.wide, w.id, !isWide) })}
                        title={isWide ? 'Normal width' : 'Full width'}
                        aria-pressed={isWide}
                      >
                        ⇔ {isWide ? 'Wide' : 'Normal'}
                      </button>
                    )}
                    <button
                      className="rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-red-400"
                      onClick={() => setLayout({ ...layout, hidden: toggleIn(layout.hidden, w.id, true) })}
                      title="Hide widget"
                      aria-label={`Hide ${w.title}`}
                    >
                      ✕
                    </button>
                  </div>
                )}
                <div className={editing ? 'pointer-events-none select-none' : 'h-full'}>
                  <Component />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardProvider>
  );
}
