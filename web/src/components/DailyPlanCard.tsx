import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ChecklistItem, DailyPlan } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseChecklist(json: string | null): ChecklistItem[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => ({ item: String(x?.item ?? ''), done: !!x?.done }))
      .filter((x) => x.item);
  } catch {
    return [];
  }
}

export default function DailyPlanCard({
  account,
  currency,
}: {
  account: number | null;
  currency: string;
}) {
  const [day, setDay] = useState<string>(today);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [bias, setBias] = useState('');
  const [levels, setLevels] = useState('');
  const [riskCap, setRiskCap] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getPlan(account, day);
        if (cancelled) return;
        setPlan(p);
        setBias(p.bias ?? '');
        setLevels(p.key_levels ?? '');
        setRiskCap(p.risk_cap == null ? '' : String(p.risk_cap));
        setNotes(p.notes ?? '');
        setItems(parseChecklist(p.checklist_json));
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load plan');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, day]);

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : null;

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const saved = await api.savePlan({
        account_id: account,
        day,
        bias: bias.trim() || null,
        key_levels: levels.trim() || null,
        risk_cap: riskCap === '' ? null : Number(riskCap),
        notes: notes.trim() || null,
        checklist_json: items.length ? JSON.stringify(items) : null,
      });
      setPlan(saved);
      setMsg('Saved');
      setTimeout(() => setMsg(null), 2000);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    setItems((xs) => [...xs, { item: t, done: false }]);
    setNewItem('');
  };

  const toggle = (i: number) =>
    setItems((xs) => xs.map((x, k) => (k === i ? { ...x, done: !x.done } : x)));

  const remove = (i: number) =>
    setItems((xs) => xs.filter((_, k) => k !== i));

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-200">Daily Plan</h2>
          <input
            type="date"
            className="input py-1"
            value={day}
            onChange={(e) => setDay(e.target.value || today())}
          />
          {pct != null && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                pct === 100
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              Checklist {done}/{total} · {pct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-sm text-emerald-400">{msg}</span>}
          {err && <span className="text-sm text-red-400">{err}</span>}
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save Plan'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="plan-bias">Bias</label>
          <input
            id="plan-bias"
            className="input w-full"
            value={bias}
            onChange={(e) => setBias(e.target.value)}
            placeholder="e.g. XAUUSD long above 2340, US100 neutral"
          />
        </div>
        <div>
          <label className="label" htmlFor="plan-levels">Key Levels</label>
          <input
            id="plan-levels"
            className="input w-full"
            value={levels}
            onChange={(e) => setLevels(e.target.value)}
            placeholder="2338, 2352 · 20180, 20260"
          />
        </div>
        <div>
          <label className="label" htmlFor="plan-risk">
            Risk cap ({currency})
          </label>
          <input
            id="plan-risk"
            type="number"
            step="any"
            className="input w-full"
            value={riskCap}
            onChange={(e) => setRiskCap(e.target.value)}
            placeholder="e.g. 200"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Pre-trade checklist</label>
        <ul className="mb-2 flex flex-col gap-1.5">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2.5 py-1.5"
            >
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => toggle(i)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              <span
                className={`flex-1 text-sm ${
                  it.done ? 'text-slate-500 line-through' : 'text-slate-200'
                }`}
              >
                {it.item}
              </span>
              <button
                onClick={() => remove(i)}
                className="text-xs text-slate-500 hover:text-red-400"
                aria-label="Remove item"
              >
                ×
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="text-sm text-slate-500">No items yet — add one below.</li>
          )}
        </ul>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="e.g. Session opened, spread OK, above session VWAP"
          />
          <button className="btn" onClick={addItem} disabled={!newItem.trim()}>
            Add
          </button>
        </div>
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="plan-notes">Notes</label>
        <textarea
          id="plan-notes"
          className="input min-h-[70px] w-full resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="News, macro context, emotional state, hard rules for today…"
        />
      </div>
      {plan?.updated_at && (
        <p className="mt-3 text-xs text-slate-500">Last saved {plan.updated_at}</p>
      )}
    </div>
  );
}
