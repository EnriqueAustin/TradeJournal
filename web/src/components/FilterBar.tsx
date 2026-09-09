import { useFilters } from '../store/FilterContext';
import { sessionLabel, DISPLAY_TZ } from '../utils/format';

const INSTRUMENTS = ['All', 'XAUUSD', 'US100'];
const SESSIONS = ['All', 'asia', 'london', 'ny', 'off'];

// Today in the display zone as YYYY-MM-DD (from/to compare against the UTC
// realized date, but a trader thinks in their own clock, so anchor there).
function todayKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA yields YYYY-MM-DD
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

export default function FilterBar() {
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
      className="flex flex-wrap items-end gap-2 border-b px-4 py-2"
      style={{
        borderColor: 'var(--term-border-2)',
        background: 'linear-gradient(180deg, var(--term-panel-hd), var(--term-bg-2))',
      }}
    >
      <div>
        <label className="label" htmlFor="f-account">
          Account
        </label>
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
              {accountsLoading ? 'Loading…' : 'No accounts'}
            </option>
          ) : (
            <option value="">All accounts</option>
          )}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="f-instrument">
          Instrument
        </label>
        <select
          id="f-instrument"
          className="input min-w-[7rem]"
          value={filters.instrument}
          onChange={(e) => setFilters({ instrument: e.target.value })}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="f-session">
          Session
        </label>
        <select
          id="f-session"
          className="input min-w-[7rem]"
          value={filters.session}
          onChange={(e) => setFilters({ session: e.target.value })}
        >
          {SESSIONS.map((s) => (
            <option key={s} value={s}>
              {sessionLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="f-setup">
          Setup
        </label>
        <select
          id="f-setup"
          className="input min-w-[8rem]"
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
      </div>

      <div>
        <label className="label" htmlFor="f-from">
          From
        </label>
        <input
          id="f-from"
          type="date"
          className="input"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => setFilters({ from: e.target.value })}
        />
      </div>

      <div>
        <label className="label" htmlFor="f-to">
          To
        </label>
        <input
          id="f-to"
          type="date"
          className="input"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => setFilters({ to: e.target.value })}
        />
      </div>

      <div>
        <label className="label">R range</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="any"
            className="input w-16"
            placeholder="min"
            value={filters.rMin}
            onChange={(e) => setFilters({ rMin: e.target.value })}
          />
          <span className="text-slate-600">–</span>
          <input
            type="number"
            step="any"
            className="input w-16"
            placeholder="max"
            value={filters.rMax}
            onChange={(e) => setFilters({ rMax: e.target.value })}
          />
        </div>
      </div>

      <div className="ml-auto flex items-end gap-2">
        <div>
          <label className="label">Range preset</label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                className="btn px-2 py-1 text-[10px] uppercase"
                onClick={() => setFilters(presetRange(p.key))}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" onClick={resetFilters}>
          Reset
        </button>
      </div>

      {accountsError && (
        <span
          className="w-full text-[10px] uppercase"
          style={{ color: 'var(--term-red)', letterSpacing: '0.08em' }}
        >
          {accountsError}
        </span>
      )}
    </div>
  );
}
