import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { FieldDef, TradeFieldValue } from '../types';

// Custom per-trade variables — numeric or enum values you can later correlate
// with outcome in the Leak Finder. Definitions are shared (per account or
// global); values are per trade.
export default function CustomFieldsCard({
  tradeId,
  account,
}: {
  tradeId: number;
  account: number | null;
}) {
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'number' | 'enum'>('number');
  const [newOptions, setNewOptions] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([
        api.getFieldDefs(account),
        api.getTradeFields(tradeId),
      ]);
      setDefs(d);
      const map: Record<number, string> = {};
      for (const row of v as TradeFieldValue[]) {
        map[row.def_id] =
          row.type === 'number'
            ? row.value_num == null
              ? ''
              : String(row.value_num)
            : row.value_text ?? '';
      }
      setValues(map);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load custom fields');
    }
  }, [tradeId, account]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (defId: number, value: string) => {
    setValues((m) => ({ ...m, [defId]: value }));
    try {
      await api.setTradeField(tradeId, defId, value === '' ? null : value);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    }
  };

  const addDef = async () => {
    if (!newName.trim()) return;
    try {
      const options =
        newType === 'enum'
          ? newOptions.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
      await api.createFieldDef({ account_id: account, name: newName.trim(), type: newType, options });
      setNewName('');
      setNewOptions('');
      setAdding(false);
      load();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add field');
    }
  };

  const parseOptions = (json: string | null): string[] => {
    if (!json) return [];
    try {
      const a = JSON.parse(json);
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Custom Fields</h2>
        <button className="text-xs text-cyan-400 hover:underline" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ New field'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded border border-slate-800 bg-slate-900/40 p-2.5">
          <input
            className="input py-1 text-xs"
            placeholder="Field name (e.g. Conviction)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select
            className="input py-1 text-xs"
            value={newType}
            onChange={(e) => setNewType(e.target.value as 'number' | 'enum')}
          >
            <option value="number">number</option>
            <option value="enum">enum</option>
          </select>
          {newType === 'enum' && (
            <input
              className="input flex-1 py-1 text-xs"
              placeholder="options, comma-separated"
              value={newOptions}
              onChange={(e) => setNewOptions(e.target.value)}
            />
          )}
          <button className="btn btn-primary text-xs" onClick={addDef} disabled={!newName.trim()}>
            Add
          </button>
        </div>
      )}

      {defs.length === 0 ? (
        <p className="text-sm text-slate-500">
          No custom fields yet — add one to record a variable (spread, ADR used, conviction…).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {defs.map((d) => (
            <div key={d.id}>
              <label className="label">{d.name}</label>
              {d.type === 'enum' ? (
                <select
                  className="input w-full py-1"
                  value={values[d.id] ?? ''}
                  onChange={(e) => save(d.id, e.target.value)}
                >
                  <option value="">—</option>
                  {parseOptions(d.options_json).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input w-full py-1"
                  type="number"
                  step="any"
                  value={values[d.id] ?? ''}
                  onChange={(e) => setValues((m) => ({ ...m, [d.id]: e.target.value }))}
                  onBlur={(e) => save(d.id, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  );
}
