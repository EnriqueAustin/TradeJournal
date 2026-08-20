import { useFilters } from '../store/FilterContext';

const INSTRUMENTS = ['All', 'XAUUSD', 'US100'];
const SESSIONS = ['All', 'asia', 'london', 'ny', 'off'];

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
          {accounts.length === 0 && (
            <option value="">
              {accountsLoading ? 'Loading…' : 'No accounts'}
            </option>
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
          className="input min-w-[7rem] capitalize"
          value={filters.session}
          onChange={(e) => setFilters({ session: e.target.value })}
        >
          {SESSIONS.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
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

      <button className="btn ml-auto" onClick={resetFilters}>
        Reset
      </button>

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
