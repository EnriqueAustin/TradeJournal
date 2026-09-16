import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import AddTradeModal from '../components/AddTradeModal';
import type { Trade, TradeSort, SortDir, TradeOutcome, TradeNeed } from '../types';
import {
  formatMoney,
  formatR,
  formatDateTime,
  formatNumber,
  formatDuration,
  formatPct,
  sessionLabel,
} from '../utils/format';

const PAGE_SIZE = 25;

// Optional columns the table can show — data the trade already carries but that
// was hidden. Persisted per-browser so a chosen layout sticks.
type OptionalCols = { mae: boolean; mfe: boolean; commission: boolean };
const COLS_KEY = 'trade-journal:trade-columns';
const DEFAULT_COLS: OptionalCols = { mae: false, mfe: false, commission: false };
function loadCols(): OptionalCols {
  try {
    const raw = window.localStorage.getItem(COLS_KEY);
    if (raw) return { ...DEFAULT_COLS, ...(JSON.parse(raw) as Partial<OptionalCols>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_COLS;
}

// Debounce a value so typing in the search box doesn't fire a request per key.
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// A clickable column header that drives server-side sorting.
function SortHeader({
  col,
  label,
  sort,
  dir,
  onSort,
  align = 'left',
}: {
  col: TradeSort;
  label: string;
  sort: TradeSort;
  dir: SortDir;
  onSort: (c: TradeSort) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === col;
  return (
    <th className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-200 ${
          active ? 'text-slate-200' : ''
        }`}
        title={`Sort by ${label}`}
      >
        {label}
        <span className={active ? 'text-cyan-400' : 'text-slate-700'}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

// Small segmented control used for the direction / outcome quick filters.
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs font-medium transition ${
            value === o.value
              ? 'bg-cyan-600 text-white'
              : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// The "needs attention" backfill filters. Each flags a data gap that keeps a
// trade out of the analytics until it's filled in.
const NEED_OPTIONS: { value: TradeNeed; label: string; title: string }[] = [
  { value: 'entry', label: 'Bad entry', title: 'entry price is 0 / missing — breaks replay & R' },
  { value: 'stop', label: 'No stop', title: 'no stop set — no R (set the original risk stop you used)' },
  { value: 'untagged', label: 'Untagged', title: 'no setup assigned and no tags' },
  { value: 'unreviewed', label: 'Unreviewed', title: 'not yet reviewed (followed plan?)' },
];

// Which gaps does this row have? Mirrors the server's `needs` clauses so the
// row can flag itself without another round-trip.
function tradeGaps(t: Trade): TradeNeed[] {
  const g: TradeNeed[] = [];
  if (t.entry_price == null || t.entry_price === 0) g.push('entry');
  if (t.stop_price == null) g.push('stop');
  if (t.setup_id == null && (!t.tags || t.tags.length === 0)) g.push('untagged');
  if (t.followed_plan == null) g.push('unreviewed');
  return g;
}

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

export default function Trades() {
  const { filters, accounts, setups } = useFilters();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<TradeSort>('realized');
  const [dir, setDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'' | 'long' | 'short'>('');
  const [outcome, setOutcome] = useState<TradeOutcome>('');
  const [needs, setNeeds] = useState<TradeNeed[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cols, setCols] = useState<OptionalCols>(loadCols);
  const [showColMenu, setShowColMenu] = useState(false);
  const debouncedSearch = useDebounced(search);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLS_KEY, JSON.stringify(cols));
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [cols]);

  const toggleNeed = (n: TradeNeed) =>
    setNeeds((cur) =>
      cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]
    );

  const currency =
    accounts.find((a) => a.id === filters.account)?.currency ?? 'USD';
  const setupName = (id: number | null) =>
    id == null ? null : setups.find((s) => s.id === id)?.name ?? null;

  const query = useMemo(
    () => ({ sort, dir, q: debouncedSearch, direction, outcome, needs: needs.join(',') }),
    [sort, dir, debouncedSearch, direction, outcome, needs]
  );
  const queryKey = JSON.stringify(query);

  // Reset to first page whenever the filters or the list query change.
  const filtersKey = filterKey(filters);
  useEffect(() => {
    setPage(0);
  }, [filtersKey, queryKey]);

  // Drop any selection when the visible set changes (page, filters, query), so
  // a bulk action can never hit a row the user can no longer see.
  useEffect(() => {
    setSelected(new Set());
  }, [filtersKey, queryKey, page]);

  // Clicking a header toggles direction when it's already the sort column,
  // otherwise switches column and starts descending (largest/newest first).
  const onSort = (c: TradeSort) => {
    if (c === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(c);
      setDir('desc');
    }
  };

  const key = filterKey(filters, page);
  const { data, loading, error, reload } = useApi(
    () => api.getTrades(filters, PAGE_SIZE, page * PAGE_SIZE, query),
    [key, queryKey]
  );
  // Totals over the whole filtered set (not just this page), for the footer.
  const { data: totals, reload: reloadTotals } = useApi(
    () => api.getTradesTotals(filters, query),
    [filterKey(filters), queryKey]
  );

  // Needs-attention counts over the global filters (not the list query), for
  // the summary chip. One totals call per gap plus one for "any gap".
  const { data: needCounts, reload: reloadNeedCounts } = useApi(async () => {
    const all = NEED_OPTIONS.map((o) => o.value);
    const [any, ...each] = await Promise.all([
      api.getTradesTotals(filters, { needs: all.join(',') }),
      ...all.map((n) => api.getTradesTotals(filters, { needs: n })),
    ]);
    const by = {} as Record<TradeNeed, number>;
    all.forEach((n, i) => (by[n] = each[i].count));
    return { any: any.count, by };
  }, [filterKey(filters)]);
  const allNeedsOn = NEED_OPTIONS.every((o) => needs.includes(o.value));

  const filtersActive =
    Boolean(search) || direction !== '' || outcome !== '' || needs.length > 0;

  const rows: Trade[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allOnPageSelected = rows.length > 0 && rows.every((t) => selected.has(t.id));
  const toggleOne = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllOnPage = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (rows.every((t) => next.has(t.id))) rows.forEach((t) => next.delete(t.id));
      else rows.forEach((t) => next.add(t.id));
      return next;
    });

  const runBulk = async (
    body: Parameters<typeof api.bulkTrades>[0],
    confirmMsg?: string
  ) => {
    if (selected.size === 0) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBulkBusy(true);
    try {
      await api.bulkTrades(body);
      setSelected(new Set());
      reload();
      reloadTotals();
      reloadNeedCounts();
    } catch (e) {
      window.alert((e as Error)?.message ?? 'Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  };
  const ids = () => [...selected];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Trades</h1>
          <p className="text-sm text-slate-500">
            {total} trade{total === 1 ? '' : 's'} matching filters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              className="btn text-xs"
              onClick={() => setShowColMenu((v) => !v)}
              title="Show or hide optional columns"
            >
              ⚙ Columns
            </button>
            {showColMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  {([
                    ['mae', 'MAE'],
                    ['mfe', 'MFE'],
                    ['commission', 'Commission'],
                  ] as [keyof OptionalCols, string][]).map(([k, label]) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800"
                        checked={cols[k]}
                        onChange={(e) => setCols((c) => ({ ...c, [k]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="btn text-xs" onClick={() => setShowAdd(true)}>
            + Add trade
          </button>
          <a
            className="btn text-xs"
            href={api.tradesExportUrl(filters, query)}
            download
            title="Download these trades as CSV (matches the current search, filters and sort)"
          >
            ⤓ Export CSV
          </a>
        </div>
      </div>

      {showAdd && (
        <AddTradeModal onClose={() => setShowAdd(false)} onCreated={reload} />
      )}

      {/* Search + quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search instrument or notes…"
          aria-label="Search trades"
        />
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: '' as const, label: 'All' },
            { value: 'long' as const, label: 'Long' },
            { value: 'short' as const, label: 'Short' },
          ]}
        />
        <Segmented
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: '' as TradeOutcome, label: 'Any' },
            { value: 'win' as TradeOutcome, label: 'Wins' },
            { value: 'loss' as TradeOutcome, label: 'Losses' },
            { value: 'be' as TradeOutcome, label: 'B/E' },
          ]}
        />
        {filtersActive && (
          <button
            type="button"
            className="btn text-xs"
            onClick={() => {
              setSearch('');
              setDirection('');
              setOutcome('');
              setNeeds([]);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Needs-attention backfill queue — one click to find the trades whose
          missing data keeps them out of the stats. */}
      <div className="flex flex-wrap items-center gap-2">
        {needCounts ? (
          needCounts.any > 0 ? (
            <button
              type="button"
              onClick={() =>
                setNeeds(allNeedsOn ? [] : NEED_OPTIONS.map((o) => o.value))
              }
              title="Show every trade with at least one data gap"
              className={`rounded border px-2.5 py-1 text-xs font-semibold transition ${
                allNeedsOn
                  ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                  : 'border-amber-500/40 text-amber-400 hover:border-amber-500'
              }`}
            >
              ⚠ <span className="num">{needCounts.any}</span>{' '}
              {needCounts.any === 1 ? 'trade needs' : 'trades need'} attention
            </button>
          ) : (
            <span className="text-xs text-emerald-400">✓ No trades need attention</span>
          )
        ) : (
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Needs attention
          </span>
        )}
        {NEED_OPTIONS.map((o) => {
          const on = needs.includes(o.value);
          const n = needCounts?.by[o.value];
          if (n === 0 && !on) return null;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggleNeed(o.value)}
              title={o.title}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                on
                  ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              {o.label}
              {n != null && <span className="num ml-1 text-slate-500">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <AsyncBoundary
          loading={loading}
          error={error}
          onRetry={reload}
          isEmpty={rows.length === 0}
          emptyMessage="No trades match the current filters. Import a report to get started."
          loadingLabel="Loading trades…"
        >
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-800/50 bg-cyan-950/20 px-3 py-2 text-sm">
              <span className="font-medium text-cyan-300">{selected.size} selected</span>
              <span className="text-slate-600">·</span>
              <label className="flex items-center gap-1.5 text-slate-400">
                Setup
                <select
                  className="input py-1 text-xs"
                  value=""
                  disabled={bulkBusy}
                  onChange={(e) => {
                    const v = e.target.value;
                    runBulk({ ids: ids(), set: { setup_id: v === '' ? null : Number(v) } });
                  }}
                >
                  <option value="" disabled>
                    Assign…
                  </option>
                  <option value="">— Clear setup —</option>
                  {setups.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn px-2 py-1 text-xs"
                disabled={bulkBusy}
                onClick={() => runBulk({ ids: ids(), set: { followed_plan: 1 } })}
              >
                Mark followed
              </button>
              <button
                className="btn px-2 py-1 text-xs"
                disabled={bulkBusy}
                onClick={() => runBulk({ ids: ids(), set: { followed_plan: 0 } })}
              >
                Mark broke
              </button>
              <button
                className="btn px-2 py-1 text-xs"
                disabled={bulkBusy}
                onClick={() => runBulk({ ids: ids(), set: { be_override: 1 } })}
              >
                Mark BE
              </button>
              <button
                className="btn px-2 py-1 text-xs"
                disabled={bulkBusy}
                onClick={() => runBulk({ ids: ids(), set: { be_override: null } })}
                title="Back to automatic BE detection (account R band / $0)"
              >
                Auto BE
              </button>
              <button
                className="btn px-2 py-1 text-xs text-red-400"
                disabled={bulkBusy}
                onClick={() =>
                  runBulk(
                    { ids: ids(), delete: true },
                    `Delete ${selected.size} trade(s)? Their notes, tags and screenshots go with them. This cannot be undone.`
                  )
                }
              >
                Delete
              </button>
              <button
                className="btn ml-auto px-2 py-1 text-xs"
                disabled={bulkBusy}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      aria-label="Select all on page"
                    />
                  </th>
                  <SortHeader col="instrument" label="Instrument" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="direction" label="Dir" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="entry_time" label="Entry" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="exit_time" label="Exit" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="hold_time_sec" label="Hold" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <SortHeader col="size" label="Size" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <SortHeader col="net_pnl" label="Net P&L" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <SortHeader col="r_multiple" label="R" sort={sort} dir={dir} onSort={onSort} align="right" />
                  {cols.mae && <th className="px-4 py-2.5 text-right font-medium">MAE</th>}
                  {cols.mfe && <th className="px-4 py-2.5 text-right font-medium">MFE</th>}
                  {cols.commission && <th className="px-4 py-2.5 text-right font-medium">Comm</th>}
                  <SortHeader col="session" label="Session" sort={sort} dir={dir} onSort={onSort} />
                  <th className="px-4 py-2.5 font-medium">Setup</th>
                  <th className="px-4 py-2.5 font-medium">Tags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/trades/${t.id}`)}
                    className={`group cursor-pointer border-b border-slate-800/60 transition hover:bg-slate-800/40 ${
                      selected.has(t.id) ? 'bg-slate-800/50' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                        checked={selected.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                        aria-label={`Select trade ${t.id}`}
                      />
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-200">
                      <span className="inline-flex items-center gap-1.5">
                        <Link
                          to={`/trades/${t.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-cyan-400 focus:text-cyan-400 focus:outline-none focus:underline"
                        >
                          {t.instrument}
                        </Link>
                        {(() => {
                          const gaps = tradeGaps(t);
                          return gaps.length ? (
                            // Subtle by default (most rows have some gap); lights
                            // up on row hover. The summary chip carries the signal.
                            <span
                              className="text-[11px] leading-none text-slate-700 transition group-hover:text-amber-400"
                              aria-label="Needs attention"
                              title={`Needs attention: ${gaps
                                .map(
                                  (g) =>
                                    NEED_OPTIONS.find((o) => o.value === g)?.label ?? g
                                )
                                .join(', ')}`}
                            >
                              ●
                            </span>
                          ) : null;
                        })()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DirectionBadge dir={t.direction} />
                    </td>
                    <td className="num px-4 py-2.5 text-slate-400">
                      {formatDateTime(t.entry_time)}
                    </td>
                    <td className="num px-4 py-2.5 text-slate-400">
                      {formatDateTime(t.exit_time)}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-400">
                      {formatDuration(t.hold_time_sec)}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-300">
                      {formatNumber(t.size, 2)}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right font-semibold ${
                        t.is_be
                          ? 'text-slate-300'
                          : t.net_pnl >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {t.is_be ? (
                        <span
                          className="mr-1.5 rounded bg-slate-600/40 px-1 py-0.5 text-[11px] font-semibold text-slate-300"
                          title={t.be_override === 1 ? 'Marked break-even manually' : 'Break-even (within the account R band)'}
                        >
                          BE
                        </span>
                      ) : null}
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
                      {t.r_derived ? (
                        <span
                          className="ml-0.5 text-slate-500"
                          title="Derived from the account's default risk — no stop was recorded"
                        >
                          ~
                        </span>
                      ) : null}
                    </td>
                    {cols.mae && (
                      <td className="num px-4 py-2.5 text-right text-slate-400">
                        {t.mae == null ? '—' : formatNumber(t.mae, 2)}
                      </td>
                    )}
                    {cols.mfe && (
                      <td className="num px-4 py-2.5 text-right text-slate-400">
                        {t.mfe == null ? '—' : formatNumber(t.mfe, 2)}
                      </td>
                    )}
                    {cols.commission && (
                      <td className="num px-4 py-2.5 text-right text-slate-400">
                        {t.commission == null ? '—' : formatMoney(t.commission, currency)}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-slate-400">
                      {sessionLabel(t.session)}
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
                    <td className="px-4 py-2.5 text-slate-500">
                      {t.tags && t.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {t.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag.id}
                              className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[11px] text-slate-300"
                              title={`${tag.category}: ${tag.name}`}
                            >
                              {tag.name}
                            </span>
                          ))}
                          {t.tags.length > 3 && (
                            <span className="text-[11px] text-slate-500">
                              +{t.tags.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && totals.count > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-700 bg-slate-900/60 text-xs font-semibold">
                    <td className="px-3 py-2.5" />
                    <td className="px-4 py-2.5 text-slate-300" colSpan={2}>
                      Totals · {totals.count} trade{totals.count === 1 ? '' : 's'}
                      {totals.win_rate != null && (
                        <span className="ml-1 font-normal text-slate-500">
                          ({formatPct(totals.win_rate)} win{totals.be ? ` · ${totals.be} BE` : ''})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5" colSpan={2} />
                    <td className="num px-4 py-2.5 text-right text-slate-400">
                      {formatDuration(totals.hold_time_sec)}
                    </td>
                    <td className="px-4 py-2.5" />
                    <td
                      className={`num px-4 py-2.5 text-right ${
                        totals.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {formatMoney(totals.net_pnl, currency)}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right ${
                        (totals.total_r ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {formatR(totals.total_r)}
                    </td>
                    {cols.mae && <td className="px-4 py-2.5" />}
                    {cols.mfe && <td className="px-4 py-2.5" />}
                    {cols.commission && (
                      <td className="num px-4 py-2.5 text-right text-slate-400">
                        {formatMoney(totals.commission, currency)}
                      </td>
                    )}
                    <td className="px-4 py-2.5" colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </AsyncBoundary>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span className="num">
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <span className="num px-1">
              {page + 1} / {totalPages}
            </span>
            <button
              className="btn"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
