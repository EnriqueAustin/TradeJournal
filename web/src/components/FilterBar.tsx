import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useFilters } from '../store/FilterContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import Sheet from './Sheet';
import type { Filters } from '../types';
import { sessionLabel } from '../utils/format';

const INSTRUMENTS = ['All', 'XAUUSD', 'US100'];
const SESSIONS = ['All', 'asia', 'london', 'ny', 'off'];

// Today as a UTC YYYY-MM-DD. from/to filter on the UTC realized date, and the
// calendar, goals and prop daily-loss all bucket days in UTC — anchoring the
// presets in the display zone made "Today" skip trades closed in the first
// hours after local midnight (still yesterday in UTC).
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// { from, to } for each preset. 'week' is Monday-based, matching the calendar.
function presetRange(preset: string): { from: string; to: string } {
  const today = todayKey();
  const d = new Date(`${today}T00:00:00Z`);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // Mon=0
      return { from: addDays(today, -dow), to: today };
    }
    case 'mtd':
      return { from: today.slice(0, 8) + '01', to: today };
    case 'ytd':
      return { from: today.slice(0, 4) + '-01-01', to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    default:
      return { from: '', to: '' };
  }
}

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'All' },
];


// Inline label + control, so the whole bar fits on one row where width allows.
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const stacked = useContext(StackedCtx);
  const labelEl = (
    <label
      htmlFor={htmlFor}
      className="text-[11px] font-bold uppercase"
      style={{ color: 'var(--term-muted)', letterSpacing: '0.04em' }}
    >
      {label}
    </label>
  );
  if (stacked) {
    // Sheet layout: label above, controls share the full width.
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        <div className="flex items-center gap-2 [&>input]:min-w-0 [&>input]:flex-1 [&>select]:min-w-0 [&>select]:flex-1">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {labelEl}
      {children}
    </div>
  );
}

// True inside the mobile filter sheet, so Field stacks its label.
const StackedCtx = createContext(false);

type Variant = 'full' | 'account';

/** How many filters differ from "everything" — the badge on the mobile button. */
function activeCount(f: Filters, variant: Variant): number {
  let n = f.account != null ? 1 : 0;
  if (variant === 'account') return n;
  if (f.instrument && f.instrument !== 'All') n++;
  if (f.session && f.session !== 'All') n++;
  if (f.setup && f.setup !== 'All') n++;
  if (f.from || f.to) n++;
  if (f.rMin !== '' || f.rMax !== '') n++;
  return n;
}

/**
 * Global filter bar. `full` on report/list pages; `account` on pages scoped to
 * one account that ignore the other filters (Journal, Week report, Replay,
 * Backtest), so the account can still be switched there.
 *
 * Below md the controls collapse into a "Filters (n)" button that opens a
 * bottom sheet with the same fields stacked.
 */
export default function FilterBar({ variant = 'full' }: { variant?: Variant }) {
  const mobile = useIsMobile();
  const { filters } = useFilters();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!mobile) setOpen(false);
  }, [mobile]);

  if (!mobile) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-1.5"
        style={{
          borderColor: 'var(--term-border-2)',
          background: 'linear-gradient(180deg, var(--term-panel-hd), var(--term-bg-2))',
        }}
      >
        <FilterFields variant={variant} />
      </div>
    );
  }

  const n = activeCount(filters, variant);
  return (
    <div
      className="flex items-center gap-2 border-b px-3 py-1.5"
      style={{
        borderColor: 'var(--term-border-2)',
        background: 'var(--term-bg-2)',
      }}
    >
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden>⚲</span> Filters{n > 0 ? ` (${n})` : ''}
      </button>
      <FilterSummary variant={variant} />
      {open && (
        <Sheet title="Filters" onClose={() => setOpen(false)}>
          <StackedCtx.Provider value={true}>
            <div className="flex flex-col gap-4">
              <FilterFields variant={variant} />
            </div>
          </StackedCtx.Provider>
          <button
            type="button"
            className="btn btn-primary mt-5 w-full"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </Sheet>
      )}
    </div>
  );
}

// One-line hint of what's applied, next to the mobile Filters button.
function FilterSummary({ variant }: { variant: Variant }) {
  const { filters, accounts } = useFilters();
  const parts: string[] = [];
  const acct = accounts.find((a) => a.id === filters.account);
  parts.push(acct ? acct.name : 'All accounts');
  if (variant === 'full') {
    if (filters.instrument !== 'All') parts.push(filters.instrument);
    if (filters.session !== 'All') parts.push(sessionLabel(filters.session));
    if (filters.from || filters.to) parts.push(`${filters.from || '…'} → ${filters.to || '…'}`);
  }
  return (
    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--term-muted)' }}>
      {parts.join(' · ')}
    </span>
  );
}

function FilterFields({ variant }: { variant: Variant }) {
  const stacked = useContext(StackedCtx);
  const {
    filters,
    setFilters,
    resetFilters,
    accounts,
    accountsLoading,
    accountsError,
    setups,
    activeProfile,
  } = useFilters();

  return (
    <>
      <Field label="Account" htmlFor="f-account">
        <select
          id="f-account"
          className="input min-w-[9rem]"
          value={filters.account ?? ''}
          disabled={accountsLoading || accounts.length === 0}
          onChange={(e) =>
            setFilters({ account: e.target.value ? Number(e.target.value) : null })
          }
        >
          {accounts.length === 0 ? (
            <option value="">
              {accountsLoading ? 'Loading…' : activeProfile ? 'No accounts in profile' : 'No accounts'}
            </option>
          ) : (
            <option value="">
              {activeProfile ? `All ${activeProfile.name} accounts` : 'All accounts'}
            </option>
          )}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>

      {variant === 'full' && (
        <>
          <Field label="Inst" htmlFor="f-instrument">
            <select
              id="f-instrument"
              className="input"
              value={filters.instrument}
              onChange={(e) => setFilters({ instrument: e.target.value })}
            >
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Session" htmlFor="f-session">
            <select
              id="f-session"
              className="input"
              value={filters.session}
              onChange={(e) => setFilters({ session: e.target.value })}
            >
              {SESSIONS.map((s) => (
                <option key={s} value={s}>
                  {sessionLabel(s)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Setup" htmlFor="f-setup">
            <select
              id="f-setup"
              className="input max-w-[10rem]"
              value={filters.setup}
              onChange={(e) => setFilters({ setup: e.target.value })}
            >
              <option value="All">All</option>
              {setups.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Dates" htmlFor="f-from">
            <input
              id="f-from"
              type="date"
              className="input"
              aria-label="From"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => setFilters({ from: e.target.value })}
            />
            <span className="text-slate-600">–</span>
            <input
              id="f-to"
              type="date"
              className="input"
              aria-label="To"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => setFilters({ to: e.target.value })}
            />
          </Field>

          <Field label="R">
            <input
              type="number"
              step="any"
              className="input w-14"
              placeholder="min"
              aria-label="R min"
              value={filters.rMin}
              onChange={(e) => setFilters({ rMin: e.target.value })}
            />
            <span className="text-slate-600">–</span>
            <input
              type="number"
              step="any"
              className="input w-14"
              placeholder="max"
              aria-label="R max"
              value={filters.rMax}
              onChange={(e) => setFilters({ rMax: e.target.value })}
            />
          </Field>

          <div className={stacked ? 'grid grid-cols-4 gap-2' : 'ml-auto flex flex-wrap items-center gap-1'}>
            {PRESETS.map((p) => {
              const r = presetRange(p.key);
              const active = filters.from === r.from && filters.to === r.to;
              return (
                <button
                  key={p.key}
                  className={`btn px-2 py-1 text-[11px] uppercase ${
                    active ? 'border-cyan-500 text-cyan-300' : ''
                  }`}
                  aria-pressed={active}
                  onClick={() => setFilters(r)}
                >
                  {p.label}
                </button>
              );
            })}
            <button className="btn px-2 py-1 text-[11px]" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </>
      )}

      {accountsError && (
        <span
          className="w-full text-[11px] uppercase"
          style={{ color: 'var(--term-red)', letterSpacing: '0.04em' }}
        >
          {accountsError}
        </span>
      )}
    </>
  );
}
