import { useState, useMemo } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { useApi } from '../hooks/useApi';
import { AsyncBoundary } from '../components/states';
import type { Account, NewAccount, TimeCheck } from '../types';
import { formatMoney, formatDate, DISPLAY_TZ } from '../utils/format';
import { FIRM_OPTIONS, getPlanOptions, getPreset, getPhaseRules } from '../data/propPresets';

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

const emptyForm: NewAccount & { _firm: string; _plan: string } = {
  name: '',
  broker: '',
  platform: 'MT5',
  account_type: 'live',
  currency: 'USD',
  starting_balance: 10000,
  prop_daily_loss: null,
  prop_max_dd: null,
  prop_target: null,
  prop_firm: null,
  prop_plan: null,
  prop_phase: 0,
  prop_dd_type: null,
  prop_min_days: null,
  prop_profit_split: null,
  prop_news_window_min: null,
  prop_weekend_hold: null,
  prop_consistency_pct: null,
  prop_min_hold_sec: null,
  prop_hold_deduct_threshold_pct: null,
  prop_safety_buffer_pct: null,
  prop_max_inactivity_days: null,
  _firm: '',
  _plan: '',
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
  type FormState = NewAccount & { _firm: string; _plan: string };

  const { refreshAccounts } = useFilters();
  const { data, loading, error, reload } = useApi(() => api.getAccounts(), []);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const isProp = form.account_type === 'prop';
  const planOptions = useMemo(() => getPlanOptions(form._firm), [form._firm]);
  const selectedPreset = useMemo(
    () => (form._firm && form._plan ? getPreset(form._firm, form._plan) : null),
    [form._firm, form._plan],
  );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const applyPreset = (firmKey: string, planKey: string) => {
    const preset = getPreset(firmKey, planKey);
    if (!preset) return;
    const bal = form.starting_balance || 10000;
    const isInstant = preset.phases.length === 0;
    const phase = isInstant ? 0 : 1;
    const rules = getPhaseRules(preset, phase);
    setForm((f) => ({
      ...f,
      _firm: firmKey,
      _plan: planKey,
      prop_firm: firmKey,
      prop_plan: planKey,
      prop_phase: phase,
      prop_daily_loss: Math.round(bal * (rules.daily_loss_pct / 100) * 100) / 100,
      prop_max_dd: Math.round(bal * (rules.max_dd_pct / 100) * 100) / 100,
      prop_target: rules.target_pct ? Math.round(bal * (rules.target_pct / 100) * 100) / 100 : null,
      prop_dd_type: rules.dd_type,
      prop_min_days: rules.min_trading_days || null,
      prop_profit_split: preset.funded.profit_split,
      prop_min_hold_sec: preset.min_hold_sec,
      prop_hold_deduct_threshold_pct: preset.hold_deduct_threshold_pct,
      prop_safety_buffer_pct: preset.safety_buffer_pct,
      prop_max_inactivity_days: preset.max_inactivity_days,
      prop_news_window_min: preset.news_window_min,
      prop_weekend_hold: preset.weekend_hold ? 1 : 0,
      prop_consistency_pct: preset.consistency_pct,
    }));
  };

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
      const { _firm, _plan, ...rest } = form;
      const payload: NewAccount = {
        ...rest,
        prop_daily_loss: isProp ? form.prop_daily_loss : null,
        prop_max_dd: isProp ? form.prop_max_dd : null,
        prop_target: isProp ? form.prop_target : null,
        prop_firm: isProp ? form.prop_firm : null,
        prop_plan: isProp ? form.prop_plan : null,
        prop_phase: isProp ? form.prop_phase : 0,
        prop_dd_type: isProp ? form.prop_dd_type : null,
        prop_min_days: isProp ? form.prop_min_days : null,
        prop_profit_split: isProp ? form.prop_profit_split : null,
        prop_news_window_min: isProp ? form.prop_news_window_min : null,
        prop_weekend_hold: isProp ? form.prop_weekend_hold : null,
        prop_consistency_pct: isProp ? form.prop_consistency_pct : null,
        prop_min_hold_sec: isProp ? form.prop_min_hold_sec : null,
        prop_hold_deduct_threshold_pct: isProp ? form.prop_hold_deduct_threshold_pct : null,
        prop_safety_buffer_pct: isProp ? form.prop_safety_buffer_pct : null,
        prop_max_inactivity_days: isProp ? form.prop_max_inactivity_days : null,
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
                onChange={(e) => {
                  const bal = Number(e.target.value);
                  set('starting_balance', bal);
                  if (form._firm && form._plan && bal > 0) {
                    const preset = getPreset(form._firm, form._plan);
                    if (preset) {
                      const rules = getPhaseRules(preset, form.prop_phase ?? 1);
                      setForm((f) => ({
                        ...f,
                        starting_balance: bal,
                        prop_daily_loss: Math.round(bal * (rules.daily_loss_pct / 100) * 100) / 100,
                        prop_max_dd: Math.round(bal * (rules.max_dd_pct / 100) * 100) / 100,
                        prop_target: rules.target_pct ? Math.round(bal * (rules.target_pct / 100) * 100) / 100 : null,
                      }));
                    }
                  }
                }}
              />
            </div>
          </div>

          {isProp && (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Prop firm preset
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="a-firm">Firm</label>
                  <select
                    id="a-firm"
                    className="input w-full"
                    value={form._firm}
                    onChange={(e) => {
                      const fk = e.target.value;
                      setForm((f) => ({ ...f, _firm: fk, _plan: '', prop_firm: fk || null, prop_plan: null }));
                    }}
                  >
                    <option value="">Select firm...</option>
                    {FIRM_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="a-plan">Challenge type</label>
                  <select
                    id="a-plan"
                    className="input w-full"
                    value={form._plan}
                    disabled={!form._firm || form._firm === 'custom'}
                    onChange={(e) => {
                      const pk = e.target.value;
                      if (pk && form._firm) applyPreset(form._firm, pk);
                      else setForm((f) => ({ ...f, _plan: pk, prop_plan: pk || null }));
                    }}
                  >
                    <option value="">Select type...</option>
                    {planOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedPreset && (
                <div className="flex flex-wrap gap-1.5 text-xs text-slate-400">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5">
                    {form.prop_dd_type === 'trailing' ? 'Trailing' : 'Static'} DD
                  </span>
                  {selectedPreset.phases.length > 0 && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      Phase {form.prop_phase}/{selectedPreset.phases.length}
                    </span>
                  )}
                  {selectedPreset.phases.length === 0 && (
                    <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-indigo-300">
                      Instant Funded
                    </span>
                  )}
                  <span className="rounded bg-slate-800 px-1.5 py-0.5">
                    {selectedPreset.funded.profit_split}% split
                  </span>
                  {!selectedPreset.weekend_hold && (
                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-300">
                      No weekend hold
                    </span>
                  )}
                  {selectedPreset.news_window_min > 0 && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      {selectedPreset.news_window_min}min news window
                    </span>
                  )}
                  {selectedPreset.consistency_pct && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      {selectedPreset.consistency_pct}% consistency
                    </span>
                  )}
                  {selectedPreset.min_hold_sec && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      {selectedPreset.min_hold_sec}s min hold
                    </span>
                  )}
                  {selectedPreset.safety_buffer_pct && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      {selectedPreset.safety_buffer_pct}% safety buffer
                    </span>
                  )}
                  {selectedPreset.max_inactivity_days && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">
                      {selectedPreset.max_inactivity_days}d inactivity limit
                    </span>
                  )}
                </div>
              )}

              {selectedPreset && selectedPreset.phases.length > 1 && (
                <div>
                  <label className="label" htmlFor="a-phase">Starting phase</label>
                  <select
                    id="a-phase"
                    className="input w-full"
                    value={form.prop_phase ?? 1}
                    onChange={(e) => {
                      const phase = Number(e.target.value);
                      if (form._firm && form._plan) {
                        const preset = getPreset(form._firm, form._plan)!;
                        const rules = getPhaseRules(preset, phase);
                        const bal = form.starting_balance || 10000;
                        setForm((f) => ({
                          ...f,
                          prop_phase: phase,
                          prop_daily_loss: Math.round(bal * (rules.daily_loss_pct / 100) * 100) / 100,
                          prop_max_dd: Math.round(bal * (rules.max_dd_pct / 100) * 100) / 100,
                          prop_target: rules.target_pct ? Math.round(bal * (rules.target_pct / 100) * 100) / 100 : null,
                          prop_dd_type: rules.dd_type,
                          prop_min_days: rules.min_trading_days || null,
                        }));
                      }
                    }}
                  >
                    {selectedPreset.phases.map((_, i) => (
                      <option key={i + 1} value={i + 1}>Phase {i + 1}</option>
                    ))}
                    <option value={0}>Funded</option>
                  </select>
                </div>
              )}

              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Limits {selectedPreset ? '(auto-filled)' : ''}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label" htmlFor="a-dl">Daily Loss</label>
                  <input
                    id="a-dl"
                    type="number"
                    step="any"
                    className="input w-full"
                    value={form.prop_daily_loss ?? ''}
                    onChange={(e) => set('prop_daily_loss', num(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="a-dd">
                    Max DD {form.prop_dd_type ? `(${form.prop_dd_type})` : ''}
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
                  <label className="label" htmlFor="a-tg">Target</label>
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
