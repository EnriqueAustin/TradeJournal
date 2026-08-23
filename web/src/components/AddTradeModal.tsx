import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';

// Defined at module scope: a component declared inside the modal body would be
// a new type every render, remounting the input and dropping focus per keystroke.
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
      />
    </div>
  );
}

// Manual trade entry. Import and the EA cover the normal paths; this is for a
// trade taken off-platform, or a correction. The server derives session, hold
// time, gross/net P&L and R-multiple, so only the essentials are asked for.
export default function AddTradeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { accounts, setups, filters } = useFilters();
  const [accountId, setAccountId] = useState<number | ''>(filters.account || accounts[0]?.id || '');
  const [instrument, setInstrument] = useState('XAUUSD');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entryTime, setEntryTime] = useState('');
  const [exitTime, setExitTime] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [size, setSize] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [commission, setCommission] = useState('');
  const [setupId, setSetupId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // datetime-local gives "YYYY-MM-DDTHH:mm" with no zone; treat it as UTC so it
  // lines up with how trades are stored and how sessions are derived.
  const toIso = (v: string) => (v ? new Date(`${v}:00Z`).toISOString() : null);

  const submit = async () => {
    setErr(null);
    if (!accountId) return setErr('Pick an account.');
    if (!instrument.trim()) return setErr('Instrument is required.');
    if (!entryTime) return setErr('Entry time is required.');
    setBusy(true);
    try {
      await api.createTrade({
        account_id: accountId,
        instrument: instrument.trim(),
        direction,
        entry_time: toIso(entryTime),
        exit_time: toIso(exitTime),
        entry_price: entryPrice,
        exit_price: exitPrice,
        size,
        stop_price: stopPrice,
        target_price: targetPrice,
        commission,
        setup_id: setupId || null,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr((e as Error)?.message ?? 'Could not create the trade.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Add trade</h2>
          <button className="btn text-xs" onClick={onClose}>✕</button>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-400">
            {err}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Account</label>
            <select
              className="input w-full"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <Field label="Instrument" value={instrument} onChange={setInstrument} placeholder="XAUUSD" />
          <div>
            <label className="label">Direction</label>
            <select
              className="input w-full"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'long' | 'short')}
            >
              <option value="long">long</option>
              <option value="short">short</option>
            </select>
          </div>

          <div>
            <label className="label">Entry time (UTC)</label>
            <input
              className="input w-full"
              type="datetime-local"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Exit time (UTC)</label>
            <input
              className="input w-full"
              type="datetime-local"
              value={exitTime}
              onChange={(e) => setExitTime(e.target.value)}
            />
          </div>
          <Field label="Size" value={size} onChange={setSize} placeholder="0.10" />

          <Field label="Entry price" value={entryPrice} onChange={setEntryPrice} placeholder="2400.00" />
          <Field label="Exit price" value={exitPrice} onChange={setExitPrice} placeholder="2410.00" />
          <Field label="Commission" value={commission} onChange={setCommission} placeholder="0" />

          <Field label="Stop price" value={stopPrice} onChange={setStopPrice} placeholder="optional — enables R" />
          <Field label="Target price" value={targetPrice} onChange={setTargetPrice} placeholder="optional" />
          <div>
            <label className="label">Setup</label>
            <select
              className="input w-full"
              value={setupId}
              onChange={(e) => setSetupId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">—</option>
              {setups.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Session, hold time, gross/net P&L and R-multiple are derived on save.
          Add a stop price to get an R-multiple.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn text-xs" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary text-xs" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save trade'}
          </button>
        </div>
      </div>
    </div>
  );
}
