import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MissedTrade } from '../types';
import { formatR, signClass } from '../utils/format';

// Shares the wick vocabulary with trade_wick so missed setups can be analysed
// the same way as taken ones.
const SWEPT_LEVELS: [string, string][] = [
  ['', '— level —'],
  ['asian_high', 'Asian High'],
  ['asian_low', 'Asian Low'],
  ['london_high', 'London High'],
  ['london_low', 'London Low'],
  ['pdh', 'Prev Day High'],
  ['pdl', 'Prev Day Low'],
  ['ny_open', 'NY Open'],
  ['equal_highs', 'Equal Highs'],
  ['equal_lows', 'Equal Lows'],
  ['other', 'Other'],
];

export default function MissedTradesCard({
  account,
  day,
}: {
  account: number | null;
  day: string;
}) {
  const [rows, setRows] = useState<MissedTrade[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New-entry form
  const [instrument, setInstrument] = useState('XAUUSD');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [swept, setSwept] = useState('');
  const [resultR, setResultR] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await api.getMissed({ account, day }));
    } catch (e: any) {
      setErr(e?.message || 'Failed to load missed trades');
    }
  }, [account, day]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.createMissed({
        account_id: account,
        day,
        instrument: instrument.trim() || null,
        direction,
        swept_level: swept || null,
        result_r: resultR === '' ? null : Number(resultR),
        note: note.trim() || null,
      });
      setResultR('');
      setNote('');
      setSwept('');
      load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to log missed trade');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deleteMissed(id);
      setRows((r) => r.filter((x) => x.id !== id));
    } catch (e: any) {
      setErr(e?.message || 'Failed to delete');
    }
  };

  const label = (k: string | null) =>
    SWEPT_LEVELS.find(([v]) => v === (k ?? ''))?.[1] ?? k ?? '—';

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Missed <span className="text-slate-500">({rows.length})</span>
        </h2>
        <span className="text-xs text-slate-500">setups you saw and skipped</span>
      </div>

      {rows.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {rows.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-sm"
            >
              <span className="font-medium text-slate-200">{m.instrument}</span>
              <span className="capitalize text-slate-400">{m.direction}</span>
              <span className="text-xs text-slate-500">{label(m.swept_level)}</span>
              {m.result_r != null && (
                <span className={`num ${signClass(m.result_r)}`}>{formatR(m.result_r)}</span>
              )}
              {m.note && <span className="truncate text-xs text-slate-500">· {m.note}</span>}
              <button
                className="ml-auto text-xs text-slate-500 hover:text-red-400"
                onClick={() => remove(m.id)}
                aria-label="Delete missed trade"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select
          className="input py-1 text-xs"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
        >
          <option>XAUUSD</option>
          <option>US100</option>
        </select>
        <select
          className="input py-1 text-xs"
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'long' | 'short')}
        >
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
        <select
          className="input py-1 text-xs"
          value={swept}
          onChange={(e) => setSwept(e.target.value)}
        >
          {SWEPT_LEVELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          className="input w-24 py-1 text-xs"
          type="number"
          step="any"
          placeholder="result R"
          value={resultR}
          onChange={(e) => setResultR(e.target.value)}
          title="What it would have returned, in R (positive = a winner you skipped)"
        />
        <input
          className="input flex-1 py-1 text-xs"
          placeholder="note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn btn-primary text-xs" onClick={add} disabled={busy}>
          {busy ? 'Logging…' : 'Log missed'}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  );
}
