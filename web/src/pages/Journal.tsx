import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import DailyPlanCard from '../components/DailyPlanCard';
import MissedTradesCard from '../components/MissedTradesCard';
import type { JournalDay } from '../types';
import {
  formatMoney,
  formatR,
  formatPct,
  formatDateTime,
  sessionLabel,
  signClass,
} from '../utils/format';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function Journal() {
  const { filters, accounts } = useFilters();
  const account = filters.account ?? null;
  const currency =
    accounts.find((a) => a.id === account)?.currency ?? accounts[0]?.currency ?? 'USD';

  const [params, setParams] = useSearchParams();
  const [day, setDayState] = useState<string>(() => params.get('day') || today());
  const [data, setData] = useState<JournalDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [recap, setRecap] = useState('');
  const [recapDirty, setRecapDirty] = useState(false);
  const [savingRecap, setSavingRecap] = useState(false);
  const [recapMsg, setRecapMsg] = useState<string | null>(null);

  const setDay = useCallback(
    (d: string) => {
      const next = d || today();
      setDayState(next);
      setParams((p) => {
        p.set('day', next);
        return p;
      });
    },
    [setParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.getJournalDay(account, day);
      setData(d);
      setRecap(d.recap?.body ?? '');
      setRecapDirty(false);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load the day');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [account, day]);

  useEffect(() => {
    load();
  }, [load]);

  const saveRecap = async () => {
    setSavingRecap(true);
    setRecapMsg(null);
    try {
      await api.saveJournalRecap(account, day, recap.trim());
      setRecapDirty(false);
      setRecapMsg('Saved');
      setTimeout(() => setRecapMsg(null), 2000);
      load();
    } catch (e: any) {
      setRecapMsg(e?.message || 'Save failed');
    } finally {
      setSavingRecap(false);
    }
  };

  const stats = data?.stats;
  const trades = data?.trades ?? [];
  const isToday = day === today();

  const tiles = useMemo(
    () => [
      { label: 'Net P&L', value: formatMoney(stats?.net_pnl ?? 0, currency), cls: signClass(stats?.net_pnl ?? 0) },
      { label: 'Trades', value: String(stats?.trade_count ?? 0), cls: 'text-slate-200' },
      { label: 'Win rate', value: formatPct(stats?.win_rate ?? null), cls: 'text-slate-200' },
      { label: 'Total R', value: formatR(stats?.total_r ?? null), cls: signClass(stats?.total_r ?? 0) },
    ],
    [stats, currency]
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-1">
      {/* Date navigator */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Journal</h1>
          <p className="text-sm text-slate-400">{weekday(day)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn px-2 py-1" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">
            ‹
          </button>
          <input
            type="date"
            className="input py-1"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <button
            className="btn px-2 py-1"
            onClick={() => setDay(shiftDay(day, 1))}
            disabled={isToday}
            aria-label="Next day"
          >
            ›
          </button>
          <button className="btn px-2 py-1 text-xs" onClick={() => setDay(today())} disabled={isToday}>
            Today
          </button>
          <Link className="btn px-2 py-1 text-xs" to={`/report/week/${day}`}>
            Week review →
          </Link>
        </div>
      </div>

      {err && <div className="card border-red-500/30 p-3 text-sm text-red-400">{err}</div>}

      {/* Plan (editable, driven by this page's day) */}
      <DailyPlanCard account={account} currency={currency} day={day} hideDatePicker />

      {/* Realised stats for the day */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Realised</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="label">{t.label}</div>
              <div className={`num text-xl font-semibold ${t.cls}`}>{t.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trades taken */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">
          Trades <span className="text-slate-500">({trades.length})</span>
        </h2>
        {loading && trades.length === 0 ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : trades.length === 0 ? (
          <p className="text-sm text-slate-500">No trades on this day.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 pr-3 font-medium">Instrument</th>
                  <th className="py-1.5 pr-3 font-medium">Dir</th>
                  <th className="py-1.5 pr-3 font-medium">Session</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Net</th>
                  <th className="py-1.5 pr-3 text-right font-medium">R</th>
                  <th className="py-1.5 font-medium">Plan</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 pr-3">
                      <Link className="text-cyan-400 hover:underline" to={`/trades/${t.id}`}>
                        {formatDateTime(t.entry_time).replace(/^.*,\s*/, '')}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-slate-200">{t.instrument}</td>
                    <td className="py-2 pr-3 text-slate-300 capitalize">{t.direction}</td>
                    <td className="py-2 pr-3 text-slate-300">{sessionLabel(t.session)}</td>
                    <td className={`num py-2 pr-3 text-right ${signClass(t.net_pnl)}`}>
                      {formatMoney(t.net_pnl, currency)}
                    </td>
                    <td className={`num py-2 pr-3 text-right ${signClass(t.r_multiple)}`}>
                      {formatR(t.r_multiple)}
                      {t.r_derived ? <span className="ml-0.5 text-slate-500" title="Derived R (no stop)">~</span> : null}
                    </td>
                    <td className="py-2">
                      {t.followed_plan == null ? (
                        <span className="text-xs text-slate-600">—</span>
                      ) : t.followed_plan ? (
                        <span className="text-xs text-emerald-400">followed</span>
                      ) : (
                        <span className="text-xs text-red-400">broke</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Missed trades — setups seen and skipped */}
      <MissedTradesCard account={account} day={day} />

      {/* End-of-day recap */}
      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Recap</h2>
          <div className="flex items-center gap-2">
            {recapMsg && <span className="text-sm text-emerald-400">{recapMsg}</span>}
            <button
              className="btn btn-primary"
              onClick={saveRecap}
              disabled={savingRecap || !recapDirty}
            >
              {savingRecap ? 'Saving…' : 'Save Recap'}
            </button>
          </div>
        </div>
        <textarea
          className="input min-h-[120px] w-full resize-y"
          value={recap}
          onChange={(e) => {
            setRecap(e.target.value);
            setRecapDirty(true);
          }}
          placeholder="How did the day go against the plan? What worked, what to carry into tomorrow…"
        />
        {data?.recap?.updated_at && !recapDirty && (
          <p className="mt-2 text-xs text-slate-500">Last saved {data.recap.updated_at}</p>
        )}
      </div>
    </div>
  );
}
