import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import type { Trade, TradeSort, SortDir, TradeOutcome } from '../types';
import {
  formatMoney,
  formatR,
  formatDateTime,
  formatNumber,
  sessionLabel,
} from '../utils/format';

const PAGE_SIZE = 25;

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
        <span className={active ? 'text-indigo-400' : 'text-slate-700'}>
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
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
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
  const debouncedSearch = useDebounced(search);

  const currency =
    accounts.find((a) => a.id === filters.account)?.currency ?? 'USD';
  const setupName = (id: number | null) =>
    id == null ? null : setups.find((s) => s.id === id)?.name ?? null;

  const query = useMemo(
    () => ({ sort, dir, q: debouncedSearch, direction, outcome }),
    [sort, dir, debouncedSearch, direction, outcome]
  );
  const queryKey = JSON.stringify(query);

  // Reset to first page whenever the filters or the list query change.
  const filtersKey = filterKey(filters);
  useEffect(() => {
    setPage(0);
  }, [filtersKey, queryKey]);

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

  const filtersActive =
    Boolean(search) || direction !== '' || outcome !== '';

  const rows: Trade[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Trades</h1>
          <p className="text-sm text-slate-500">
            {total} trade{total === 1 ? '' : 's'} matching filters.
          </p>
        </div>
        <a
          className="btn text-xs"
          href={api.tradesExportUrl(filters, query)}
          download
          title="Download these trades as CSV (matches the current search, filters and sort)"
        >
          ⤓ Export CSV
        </a>
      </div>

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
            }}
          >
            Clear
          </button>
        )}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <SortHeader col="instrument" label="Instrument" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="direction" label="Dir" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="entry_time" label="Entry" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="exit_time" label="Exit" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader col="size" label="Size" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <SortHeader col="net_pnl" label="Net P&L" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <SortHeader col="r_multiple" label="R" sort={sort} dir={dir} onSort={onSort} align="right" />
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
                    <td className="num px-4 py-2.5 text-slate-400">
                      {formatDateTime(t.exit_time)}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-300">
                      {formatNumber(t.size, 2)}
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
                      {sessionLabel(t.session)}
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
