import { useState } from 'react';
import { useFilters } from '../store/FilterContext';
import { profilesApi, PROFILE_COLOURS, type Profile } from '../api/profiles';

const INSTRUMENTS = ['', 'XAUUSD', 'US100'];
const HINT_KEY = 'trade-journal:profiles-hint-dismissed';

function hintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function ColourPicker({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
      {PROFILE_COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className="h-5 w-5"
          style={{
            background: c,
            borderRadius: 999,
            outline: value === c ? '2px solid var(--term-text-hi)' : 'none',
            outlineOffset: 1,
          }}
        />
      ))}
    </div>
  );
}

function ProfileRow({ p, onChanged }: { p: Profile; onChanged: () => void }) {
  const [name, setName] = useState(p.name);
  const [err, setErr] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof profilesApi.update>[1]) => {
    setErr(null);
    try {
      await profilesApi.update(p.id, patch);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    }
  };
  const remove = async () => {
    if (!confirm(`Delete profile "${p.name}"? Its accounts and trades stay; they just become unassigned.`)) return;
    try {
      await profilesApi.remove(p.id);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Delete failed');
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: 'var(--term-border)' }}>
      <span
        aria-hidden
        className="flex h-6 w-6 items-center justify-center text-[11px] font-bold uppercase"
        style={{ borderRadius: 999, background: p.colour || 'var(--term-amber)', color: '#0b1411' }}
      >
        {p.name.charAt(0)}
      </span>
      <input
        className="input w-36"
        aria-label="Profile name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== p.name && save({ name })}
      />
      <ColourPicker value={p.colour} onChange={(colour) => save({ colour })} />
      <select
        className="input"
        aria-label="Default instrument"
        value={p.default_instrument ?? ''}
        onChange={(e) => save({ default_instrument: e.target.value || null })}
      >
        {INSTRUMENTS.map((i) => (
          <option key={i} value={i}>
            {i || 'No default instrument'}
          </option>
        ))}
      </select>
      <span className="text-xs" style={{ color: 'var(--term-muted)' }}>
        {p.account_count} account{p.account_count === 1 ? '' : 's'}
      </span>
      <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-400" onClick={remove}>
        Delete
      </button>
      {err && <span className="w-full text-xs text-red-400">{err}</span>}
    </li>
  );
}

/** Profiles: per-trader grouping of accounts, switched from the sidebar. */
export default function ProfilesPanel() {
  const { profiles, refreshProfiles, refreshAccounts } = useFilters();
  const [name, setName] = useState('');
  const [colour, setColour] = useState(PROFILE_COLOURS[0]);
  const [instrument, setInstrument] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(hintDismissed);

  const changed = () => {
    refreshProfiles();
    refreshAccounts();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Name is required');
    setBusy(true);
    setErr(null);
    try {
      await profilesApi.create({ name, colour, default_instrument: instrument || null });
      setName('');
      setColour(PROFILE_COLOURS[(profiles.length + 1) % PROFILE_COLOURS.length]);
      changed();
    } catch (e: any) {
      setErr(e?.message || 'Failed to create profile');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="card flex flex-col">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--term-border)' }}>
        <h2 className="text-sm font-semibold text-slate-200">Profiles</h2>
        <span className="text-xs" style={{ color: 'var(--term-muted)' }}>
          Who trades which accounts. Switch in the sidebar.
        </span>
      </div>

      {profiles.length === 0 && !dismissed && (
        <div
          className="mx-4 mt-3 flex items-start gap-3 border px-3 py-2.5 text-xs"
          style={{ borderColor: 'var(--term-amber)', borderRadius: 2, color: 'var(--term-text)' }}
          role="note"
        >
          <div className="flex-1">
            <div className="font-semibold" style={{ color: 'var(--term-amber)' }}>
              Set up profiles
            </div>
            Sharing this journal? Create a profile per trader (e.g. one for XAUUSD, one for US100),
            then assign each account below. The sidebar switcher then keeps each dashboard to that
            trader’s accounts and instrument.
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-300" onClick={dismiss} aria-label="Dismiss hint">
            ✕
          </button>
        </div>
      )}

      {profiles.length > 0 && (
        <ul>
          {profiles.map((p) => (
            <ProfileRow key={`${p.id}:${p.name}`} p={p} onChanged={changed} />
          ))}
        </ul>
      )}

      <form onSubmit={create} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          className="input w-36"
          placeholder="New profile name"
          aria-label="New profile name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <ColourPicker value={colour} onChange={setColour} />
        <select
          className="input"
          aria-label="New profile default instrument"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {i || 'No default instrument'}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add profile'}
        </button>
        {err && <span className="text-xs text-red-400">{err}</span>}
      </form>
    </div>
  );
}
