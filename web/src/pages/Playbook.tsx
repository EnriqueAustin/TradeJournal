import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi, filterKey } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import DailyPlanCard from '../components/DailyPlanCard';
import type { NewSetup, Setup } from '../types';
import { formatMoney, formatPct, formatR, signClass } from '../utils/format';

const INSTRUMENTS = ['', 'XAUUSD', 'US100'];

const emptyForm: NewSetup = { name: '', instrument: '', rules: '' };

export default function Playbook() {
  const { filters, accounts, setups, refreshSetups } = useFilters();
  const [form, setForm] = useState<NewSetup>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const currency =
    accounts.find((a) => a.id === filters.account)?.currency ?? 'USD';

  const key = filterKey(filters);
  const stats = useApi(() => api.getSetupStats(filters), [key]);

  const set = <K extends keyof NewSetup>(k: K, v: NewSetup[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormErr('Name is required');
      return;
    }
    setBusy(true);
    setFormErr(null);
    setOk(null);
    try {
      const created = await api.createSetup({
        name: form.name.trim(),
        instrument: form.instrument || null,
        rules: form.rules || null,
      });
      setOk(`Created "${created.name}"`);
      setForm(emptyForm);
      refreshSetups();
      stats.reload();
      setTimeout(() => setOk(null), 2500);
    } catch (e: any) {
      setFormErr(e?.message || 'Failed to create setup');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Setup) => {
    if (!confirm(`Delete setup "${s.name}"? Trades keep their history but are unassigned.`))
      return;
    try {
      await api.deleteSetup(s.id);
      refreshSetups();
      stats.reload();
    } catch (e: any) {
      setFormErr(e?.message || 'Failed to delete setup');
    }
  };

  // Merge setup metadata (rules/instrument) into the perf rows for display.
  const statRows = stats.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Playbook</h1>
        <p className="text-sm text-slate-500">
          Define trading setups and see how each one performs across the current
          filters.
        </p>
      </div>

      <DailyPlanCard account={filters.account} currency={currency} />

      {/* Performance table */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-200">
          Setup Performance
        </div>
        <AsyncBoundary
          loading={stats.loading}
          error={stats.error}
          onRetry={stats.reload}
          isEmpty={statRows.length === 0}
          emptyMessage="No trades match the filters yet."
          loadingLabel="Loading setup stats…"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Setup</th>
                  <th className="px-4 py-2.5 text-right font-medium">Trades</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net P&L</th>
                  <th className="px-4 py-2.5 text-right font-medium">Win Rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg R</th>
                  <th className="px-4 py-2.5 text-right font-medium">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((r) => (
                  <tr
                    key={r.setup_id ?? 'unassigned'}
                    className="border-b border-slate-800/60"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-200">
                      {r.name}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-300">
                      {r.trade_count}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right font-semibold ${signClass(
                        r.net_pnl
                      )}`}
                    >
                      {formatMoney(r.net_pnl, currency)}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-slate-300">
                      {formatPct(r.win_rate)}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right ${signClass(r.avg_r)}`}
                    >
                      {formatR(r.avg_r)}
                    </td>
                    <td
                      className={`num px-4 py-2.5 text-right ${signClass(
                        r.expectancy
                      )}`}
                    >
                      {formatMoney(r.expectancy, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AsyncBoundary>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Setups list */}
        <div className="card overflow-hidden lg:col-span-2">
          <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-200">
            Setups ({setups.length})
          </div>
          {setups.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              No setups yet. Create one on the right.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Instrument</th>
                    <th className="px-4 py-2.5 font-medium">Rules</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {setups.map((s) => (
                    <tr key={s.id} className="border-b border-slate-800/60">
                      <td className="px-4 py-2.5 font-medium text-slate-200">
                        {s.name}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">
                        {s.instrument ?? '—'}
                      </td>
                      <td className="max-w-[280px] px-4 py-2.5 text-slate-400">
                        <span className="line-clamp-2 whitespace-pre-wrap">
                          {s.rules || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => remove(s)}
                          className="text-xs text-slate-500 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Create form */}
        <form onSubmit={submit} className="card flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold text-slate-200">New Setup</h2>
          <div>
            <label className="label" htmlFor="s-name">
              Name
            </label>
            <input
              id="s-name"
              className="input w-full"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="London Breakout"
            />
          </div>
          <div>
            <label className="label" htmlFor="s-inst">
              Instrument (optional)
            </label>
            <select
              id="s-inst"
              className="input w-full"
              value={form.instrument ?? ''}
              onChange={(e) => set('instrument', e.target.value)}
            >
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {i === '' ? 'Any' : i}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-rules">
              Rules
            </label>
            <textarea
              id="s-rules"
              className="input min-h-[90px] w-full resize-y"
              value={form.rules ?? ''}
              onChange={(e) => set('rules', e.target.value)}
              placeholder="Entry / stop / target / conditions…"
            />
          </div>
          <button className="btn btn-primary mt-1" disabled={busy}>
            {busy ? 'Creating…' : 'Create Setup'}
          </button>
          {formErr && <p className="text-sm text-red-400">{formErr}</p>}
          {ok && <p className="text-sm text-emerald-400">{ok}</p>}
        </form>
      </div>
    </div>
  );
}
