import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useFilters } from '../../store/FilterContext';
import type { TradeDetail as TTradeDetail } from '../../types';

// Setup assignment plus entry / stop / target corrections. Stop and target drive
// R and the chart's position box.
export default function RiskLevelsCard({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const { setups } = useFilters();
  const [entry, setEntry] = useState(trade.entry_price?.toString() ?? '');
  const [stop, setStop] = useState(trade.stop_price?.toString() ?? '');
  const [target, setTarget] = useState(trade.target_price?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [setupSaving, setSetupSaving] = useState(false);

  useEffect(() => {
    setEntry(trade.entry_price?.toString() ?? '');
    setStop(trade.stop_price?.toString() ?? '');
    setTarget(trade.target_price?.toString() ?? '');
  }, [trade.id, trade.entry_price, trade.stop_price, trade.target_price]);

  const saveSetup = async (value: string) => {
    setSetupSaving(true);
    setSaveErr(null);
    try {
      await api.patchTrade(trade.id, {
        setup_id: value === '' ? null : Number(value),
      });
      onChanged();
    } catch (e: any) {
      setSaveErr(e?.message || 'Failed to save setup');
    } finally {
      setSetupSaving(false);
    }
  };

  const saveLevels = async () => {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await api.patchTrade(trade.id, {
        // Entry only sent when it's a real, non-zero correction — guards the
        // 8 corrupt entry_price=0 imports without touching good rows.
        ...(entry !== '' && Number(entry) > 0 ? { entry_price: Number(entry) } : {}),
        stop_price: stop === '' ? null : Number(stop),
        target_price: target === '' ? null : Number(target),
      });
      setSaveMsg('Saved');
      onChanged();
    } catch (e: any) {
      setSaveErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  };

  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Setup &amp; Risk Levels</h2>
      <div className="mb-3">
        <label className="label" htmlFor="td-setup">
          Setup
        </label>
        <select
          id="td-setup"
          className="input w-full"
          value={trade.setup_id == null ? '' : String(trade.setup_id)}
          disabled={setupSaving}
          onChange={(e) => saveSetup(e.target.value)}
        >
          <option value="">— Unassigned —</option>
          {setups.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
              {s.instrument ? ` (${s.instrument})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['entry', 'Entry', entry, setEntry],
            ['stop', 'Stop', stop, setStop],
            ['target', 'Target', target, setTarget],
          ] as const
        ).map(([id, label, value, set]) => (
          <div key={id} className="min-w-0">
            <label className="label" htmlFor={id}>
              {label}
            </label>
            <input
              id={id}
              type="number"
              step="any"
              className="input num w-full"
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-primary" onClick={saveLevels} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveMsg && <span className="text-sm text-emerald-400">{saveMsg}</span>}
        {saveErr && <span className="text-sm text-red-400">{saveErr}</span>}
      </div>
      {trade.stop_price == null && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
          No stop imported. MT5 statements only keep the <em>final</em> stop —
          if you trailed it to break-even or into profit, that's on the wrong
          side of entry and gets dropped, so the original risk stop is lost.
          Enter the stop you actually used at entry to unlock R.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        R multiple recomputes from stop distance when the trade is refetched.
        Fix a bad-import entry price here (e.g. Match-Trader rows that came in
        at 0) to unlock replay and R — P&amp;L is left untouched.
      </p>
    </div>
  );
}
