import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import type { Account, NewAccount, TimeCheck } from '../types';
import { formatMoney, formatDate, DISPLAY_TZ } from '../utils/format';

const BROKER_TZS = [
  'Europe/London',
  'UTC',
  'Europe/Athens',
  'Europe/Helsinki',
  'Africa/Johannesburg',
  'America/New_York',
];

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

function BrokerTimePanel({
  accounts,
  onChanged,
}: {
  accounts: Account[];
  onChanged: () => void;
}) {
  const [checks, setChecks] = useState<Record<number, TimeCheck | 'loading' | string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const setTz = async (id: number, tz: string) => {
    try {
      await api.updateAccount(id, { broker_tz: tz });
      onChanged();
    } catch (e: any) {
      setMsg(e?.message || 'Failed to set timezone');
    }
  };

  const check = async (id: number) => {
    setChecks((c) => ({ ...c, [id]: 'loading' }));
    try {
      const r = await api.checkAccountTime(id);
      setChecks((c) => ({ ...c, [id]: r }));
    } catch (e: any) {
      setChecks((c) => ({ ...c, [id]: e?.message || 'check failed' }));
    }
  };

  const realign = async (id: number, name: string) => {
    if (
      !confirm(
        `Re-align existing trade times for "${name}" from its broker timezone to UTC? This shifts stored entry/exit times once and can't be auto-undone.`
      )
    )
      return;
    setBusy(id);
    setMsg(null);
    try {
      const r = await api.realignAccountTimes(id);
      setMsg(
        r.note
          ? `${name}: ${r.note}`
          : `${name}: re-aligned ${r.realigned} trades from ${r.broker_tz}.`
      );
      onChanged();
      check(id);
    } catch (e: any) {
      setMsg(e?.message || 'Re-align failed');
    } finally {
      setBusy(null);
    }
  };

  const renderCheck = (c: TimeCheck | 'loading' | string | undefined) => {
    if (c === undefined) return null;
    if (c === 'loading') return <span className="text-slate-500">checking…</span>;
    if (typeof c === 'string') return <span className="text-red-400">{c}</span>;
    if (c.checked === 0)
      return <span className="text-slate-500">no verifiable trades (need fills + price bars)</span>;
    if (c.aligned)
      return (
        <span className="text-emerald-400">
          ✓ aligned ({c.fit_at_zero}/{c.checked} fills on-candle)
        </span>
      );
    if (c.best_offset_min == null)
      return (
        <span className="text-slate-500">
          inconclusive — fills don't match any candle (bad prices or no bar coverage)
        </span>
      );
    const hrs = (c.best_offset_min / 60).toFixed(0);
    return (
      <span className="text-amber-400">
        ⚠ off by {c.best_offset_min > 0 ? '+' : ''}
        {hrs}h — set Broker TZ so fills land on candles, then re-align
      </span>
    );
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Broker time &amp; alignment</h2>
        <span className="text-xs text-slate-500">display: {DISPLAY_TZ}</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        MT5 stores times in the broker's server timezone. This converts imports to
        UTC so trades line up with price candles. Times display in your local zone.
      </p>
      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
          >
            <span className="min-w-[10rem] font-medium text-slate-200">{a.name}</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Broker TZ
              <select
                className="input py-1 text-xs"
                value={a.broker_tz ?? 'UTC'}
                onChange={(e) => setTz(a.id, e.target.value)}
              >
                {BROKER_TZS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn px-2 py-1 text-xs" onClick={() => check(a.id)}>
              Check alignment
            </button>
            <button
              className="btn px-2 py-1 text-xs"
              disabled={busy === a.id || a.times_realigned === 1}
              onClick={() => realign(a.id, a.name)}
              title={a.times_realigned === 1 ? 'Already re-aligned' : undefined}
            >
              {a.times_realigned === 1
                ? '✓ re-aligned'
                : busy === a.id
                ? 'Re-aligning…'
                : 'Re-align existing'}
            </button>
            <span className="text-xs">{renderCheck(checks[a.id])}</span>
          </div>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-indigo-300">{msg}</p>}
    </div>
  );
}

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

      {data && data.length > 0 && (
        <BrokerTimePanel accounts={data} onChanged={reload} />
      )}

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
