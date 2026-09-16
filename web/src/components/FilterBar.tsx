import type { ReactNode } from 'react';
import { useFilters } from '../store/FilterContext';
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
  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-bold uppercase"
        style={{ color: 'var(--term-muted)', letterSpacing: '0.04em' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Global filter bar. `full` on report/list pages; `account` on pages scoped to
 * one account that ignore the other filters (Journal, Week report, Replay,
 * Backtest), so the account can still be switched there.
 */
export default function FilterBar({ variant = 'full' }: { variant?: 'full' | 'account' }) {
  const {
    filters,
    setFilters,
    resetFilters,
    accounts,
    accountsLoading,
    accountsError,
    setups,
  } = useFilters();

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-1.5"
      style={{
        borderColor: 'var(--term-border-2)',
        background: 'linear-gradient(180deg, var(--term-panel-hd), var(--term-bg-2))',
      }}
    >
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
            <option value="">{accountsLoading ? 'Loading…' : 'No accounts'}</option>
          ) : (
            <option value="">All accounts</option>
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

          <div className="ml-auto flex flex-wrap items-center gap-1">
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
    </div>
  );
}
