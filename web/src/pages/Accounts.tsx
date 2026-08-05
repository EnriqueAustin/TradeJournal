import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import type { NewAccount } from '../types';
import { formatMoney, formatDate } from '../utils/format';

const PLATFORMS = ['MT5', 'MT4', 'cTrader', 'Other'];
const ACCOUNT_TYPES = ['live', 'demo', 'prop'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];

const emptyForm: NewAccount = {
  name: '',
  broker: '',
  platform: 'MT5',
  account_type: 'live',
  currency: 'USD',
  starting_balance: 10000,
  prop_daily_loss: null,
  prop_max_dd: null,
  prop_target: null,
};

export default function Accounts() {
  const { refreshAccounts } = useFilters();
  const { data, loading, error, reload } = useApi(() => api.getAccounts(), []);
  const [form, setForm] = useState<NewAccount>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const isProp = form.account_type === 'prop';

  const set = <K extends keyof NewAccount>(k: K, v: NewAccount[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const num = (v: string): number | null => (v === '' ? null : Number(v));

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
      const payload: NewAccount = {
        ...form,
        prop_daily_loss: isProp ? form.prop_daily_loss : null,
        prop_max_dd: isProp ? form.prop_max_dd : null,
        prop_target: isProp ? form.prop_target : null,
      };
      const created = await api.createAccount(payload);
      setOk(`Created "${created.name}"`);
      setForm(emptyForm);
      reload();
      refreshAccounts();
      setTimeout(() => setOk(null), 2500);
    } catch (e: any) {
      setFormErr(e?.message || 'Failed to create account');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (id: number, name: string) => {
    const confirmed = confirm(
      `Delete account "${name}" and all of its trades, plans, live positions, notes, tags, and screenshots? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingId(id);
    setFormErr(null);
    setOk(null);
    try {
      await api.deleteAccount(id);
      setOk(`Deleted "${name}"`);
      reload();
      refreshAccounts();
      setTimeout(() => setOk(null), 2500);
    } catch (e: any) {
      setFormErr(e?.message || 'Failed to delete account');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Accounts</h1>
        <p className="text-sm text-slate-500">Manage trading accounts.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* List */}
        <div className="card overflow-hidden lg:col-span-2">
          <AsyncBoundary
            loading={loading}
            error={error}
            onRetry={reload}
            isEmpty={!data || data.length === 0}
            emptyMessage="No accounts yet. Create one to get started."
            loadingLabel="Loading accounts…"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Broker</th>
                    <th className="px-4 py-2.5 font-medium">Platform</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Ccy</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Start Bal
                    </th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.map((a) => (
                    <tr key={a.id} className="border-b border-slate-800/60">
                      <td className="px-4 py-2.5 font-medium text-slate-200">
                        {a.name}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{a.broker}</td>
                      <td className="px-4 py-2.5 text-slate-400">
                        {a.platform}
                      </td>
                      <td className="px-4 py-2.5 capitalize text-slate-400">
                        {a.account_type}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">
                        {a.currency}
                      </td>
                      <td className="num px-4 py-2.5 text-right text-slate-300">
                        {formatMoney(a.starting_balance, a.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {formatDate(a.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="text-xs text-slate-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={deletingId === a.id}
                          onClick={() => deleteAccount(a.id, a.name)}
                        >
                          {deletingId === a.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AsyncBoundary>
        </div>

        {/* Create form */}
        <form onSubmit={submit} className="card flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold text-slate-200">New Account</h2>

          <div>
            <label className="label" htmlFor="a-name">
              Name
            </label>
            <input
              id="a-name"
              className="input w-full"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My FTMO Challenge"
            />
          </div>

          <div>
            <label className="label" htmlFor="a-broker">
              Broker
            </label>
            <input
              id="a-broker"
              className="input w-full"
              value={form.broker}
              onChange={(e) => set('broker', e.target.value)}
              placeholder="FTMO"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="a-platform">
                Platform
              </label>
              <select
                id="a-platform"
                className="input w-full"
                value={form.platform}
                onChange={(e) => set('platform', e.target.value)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="a-type">
                Type
              </label>
              <select
                id="a-type"
                className="input w-full capitalize"
                value={form.account_type}
                onChange={(e) => set('account_type', e.target.value)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="a-ccy">
                Currency
              </label>
              <select
                id="a-ccy"
                className="input w-full"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="a-bal">
                Start Balance
              </label>
              <input
                id="a-bal"
                type="number"
                step="any"
                className="input w-full"
                value={form.starting_balance}
                onChange={(e) =>
                  set('starting_balance', Number(e.target.value))
                }
              />
            </div>
          </div>

          {isProp && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="col-span-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                Prop limits
              </div>
              <div>
                <label className="label" htmlFor="a-dl">
                  Daily Loss
                </label>
                <input
                  id="a-dl"
                  type="number"
                  step="any"
                  className="input w-full"
                  value={form.prop_daily_loss ?? ''}
                  onChange={(e) =>
                    set('prop_daily_loss', num(e.target.value))
                  }
                />
              </div>
              <div>
                <label className="label" htmlFor="a-dd">
                  Max DD
                </label>
                <input
                  id="a-dd"
                  type="number"
                  step="any"
                  className="input w-full"
                  value={form.prop_max_dd ?? ''}
                  onChange={(e) => set('prop_max_dd', num(e.target.value))}
                />
              </div>
              <div>
                <label className="label" htmlFor="a-tg">
                  Target
                </label>
                <input
                  id="a-tg"
                  type="number"
                  step="any"
                  className="input w-full"
                  value={form.prop_target ?? ''}
                  onChange={(e) => set('prop_target', num(e.target.value))}
                />
              </div>
            </div>
          )}

          <button className="btn btn-primary mt-1" disabled={busy}>
            {busy ? 'Creating…' : 'Create Account'}
          </button>
          {formErr && <p className="text-sm text-red-400">{formErr}</p>}
          {ok && <p className="text-sm text-emerald-400">{ok}</p>}
        </form>
      </div>
    </div>
  );
}
