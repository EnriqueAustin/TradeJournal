import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { TradeDetail as TTradeDetail, WickLevel, WickSession } from '../../types';

const WICK_LEVELS: { value: WickLevel; label: string }[] = [
  { value: 'asian_high', label: 'Asian High' },
  { value: 'asian_low', label: 'Asian Low' },
  { value: 'london_high', label: 'London High' },
  { value: 'london_low', label: 'London Low' },
  { value: 'pdh', label: 'Prev Day High' },
  { value: 'pdl', label: 'Prev Day Low' },
  { value: 'ny_open', label: 'NY Open' },
  { value: 'equal_highs', label: 'Equal Highs' },
  { value: 'equal_lows', label: 'Equal Lows' },
  { value: 'other', label: 'Other' },
];
const WICK_SESSIONS: { value: WickSession; label: string }[] = [
  { value: 'asia', label: 'Asia' },
  { value: 'london', label: 'London' },
  { value: 'ny', label: 'New York' },
  { value: 'off', label: 'Off-hours' },
];

// Structured "Wicks Don't Lie" setup tagging: which liquidity the entry swept,
// the session, how much of the wick filled, and whether it faked out first.
// Feeds the Wick-Fill Edge breakdown on Analytics.
export default function WickSetupPanel({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const w = trade.wick;
  const [swept, setSwept] = useState<string>(w?.swept_level ?? '');
  const [session, setSession] = useState<string>(w?.strat_session ?? '');
  const [fill, setFill] = useState<string>(w?.fill_pct != null ? String(w.fill_pct) : '');
  const [fakeout, setFakeout] = useState<boolean>(w?.fakeout === 1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    setSwept(trade.wick?.swept_level ?? '');
    setSession(trade.wick?.strat_session ?? '');
    setFill(trade.wick?.fill_pct != null ? String(trade.wick.fill_pct) : '');
    setFakeout(trade.wick?.fakeout === 1);
  }, [trade.id, trade.wick]);

  // Auto-detect the swept level + session from the trade's entry context and
  // prefill the form (does not save — you review, then Save).
  const autoDetect = async () => {
    setDetecting(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.suggestWick(trade.id);
      if (r.suggestion.strat_session) setSession(r.suggestion.strat_session);
      if (r.suggestion.swept_level) setSwept(r.suggestion.swept_level);
      if (r.suggestion.matched && r.detail) {
        setMsg(`Detected: swept ${r.detail.level} @ ${r.detail.price}`);
      } else if (r.suggestion.strat_session) {
        setMsg(`Session set to ${r.suggestion.strat_session} — no clear sweep at entry, pick the level.`);
      } else {
        setMsg('Not enough data near entry to detect.');
      }
    } catch (e: any) {
      setErr(e?.message || 'Detect failed');
    } finally {
      setDetecting(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await api.saveWick(trade.id, {
        swept_level: (swept || null) as WickLevel | null,
        strat_session: (session || null) as WickSession | null,
        fill_pct: fill === '' ? null : Number(fill),
        fakeout: fakeout ? 1 : 0,
      });
      setMsg('Saved');
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Wick-Fill Setup</h2>
        <button
          className="btn text-xs"
          onClick={autoDetect}
          disabled={detecting}
          title="Detect swept level & session from the entry"
        >
          {detecting ? 'Detecting…' : '✨ Auto-detect'}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="wick-level">Liquidity Swept</label>
          <select
            id="wick-level"
            className="input"
            value={swept}
            onChange={(e) => setSwept(e.target.value)}
          >
            <option value="">— none —</option>
            {WICK_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="wick-session">Session</label>
          <select
            id="wick-session"
            className="input"
            value={session}
            onChange={(e) => setSession(e.target.value)}
          >
            <option value="">— none —</option>
            {WICK_SESSIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="wick-fill">Wick Fill %</label>
          <input
            id="wick-fill"
            type="number"
            min={0}
            max={100}
            step="any"
            className="input w-28"
            value={fill}
            onChange={(e) => setFill(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={fakeout}
            onChange={(e) => setFakeout(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-800"
          />
          Faked out first
        </label>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="text-sm text-emerald-400">{msg}</span>}
        {err && <span className="text-sm text-red-400">{err}</span>}
      </div>
    </div>
  );
}
