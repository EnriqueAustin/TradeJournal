import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import DailyPlanCard from '../components/DailyPlanCard';
import MissedTradesCard from '../components/MissedTradesCard';
import ShareLinkButton from '../components/ShareLinkButton';
import Markdown from '../components/Markdown';
import { ReminderSettingsButton, ReviewReminderBanner } from '../components/ReviewReminders';
import type { Filters, JournalDay } from '../types';
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
  // Saved recaps open rendered (markdown); an empty day opens straight in Write.
  const [recapPreview, setRecapPreview] = useState(false);

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
      setRecapPreview(!!d.recap?.body?.trim());
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

  // Most recent trading day on or before the viewed day's account (the server
  // falls back to the first account when none is picked, so mirror that).
  // Trades sort newest-realized first; the journal buckets on the same date.
  const [lastDay, setLastDay] = useState<string | null>(null);
  const journalAccount = account ?? accounts[0]?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    const f: Filters = {
      account: journalAccount,
      instrument: 'All',
      session: 'All',
      setup: 'All',
      from: '',
      to: today(),
      rMin: '',
      rMax: '',
    };
    api
      .getTrades(f, 1, 0)
      .then((r) => {
        const t = r.rows[0];
        if (!cancelled) setLastDay((t?.exit_time ?? t?.entry_time ?? '').slice(0, 10) || null);
      })
      .catch(() => {
        if (!cancelled) setLastDay(null);
      });
    return () => {
      cancelled = true;
    };
  }, [journalAccount]);

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
          {lastDay && (
            <button
              className="btn px-2 py-1 text-xs"
              onClick={() => setDay(lastDay)}
              disabled={day === lastDay}
              title="Jump to the most recent day with trades"
            >
              Last trading day
            </button>
          )}
          <Link className="btn px-2 py-1 text-xs" to={`/report/week/${day}`}>
            Week review →
          </Link>
          <Link className="btn px-2 py-1 text-xs" to={`/report/month/${day.slice(0, 7)}`}>
            Month report →
          </Link>
          <ShareLinkButton kind="day" refId={day} accountId={account} />
          <ReminderSettingsButton />
        </div>
      </div>

      <ReviewReminderBanner account={account} profile={filters.profile ?? null} />

      {err && <div className="card border-red-500/30 p-3 text-sm text-red-400">{err}</div>}

      {!loading && data && trades.length === 0 && lastDay && lastDay !== day && (
        <button
          className="card flex items-center justify-between gap-3 border-amber-500/40 p-3 text-left text-sm hover:border-amber-500"
          onClick={() => setDay(lastDay)}
        >
          <span className="text-slate-300">
            No trades on this day. Last trading day was{' '}
            <span className="font-semibold text-amber-400">{weekday(lastDay)}</span>.
          </span>
          <span className="text-amber-400">Open →</span>
        </button>
      )}

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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">
            Trades <span className="text-slate-500">({trades.length})</span>
            {trades.some((t) => t.followed_plan == null) && (
              <span className="ml-2 text-xs font-normal text-amber-400">
                {trades.filter((t) => t.followed_plan == null).length} unreviewed
              </span>
            )}
          </h2>
          {trades.length > 0 && (
            <div className="flex gap-2">
              <Link className="btn btn-primary px-3 py-1 text-xs" to={`/review/day/${day}`}>
                Review day →
              </Link>
              <Link className="btn px-2 py-1 text-xs" to={`/review/week/${day}`}>
                Review week
              </Link>
            </div>
          )}
        </div>
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
            <div className="flex overflow-hidden rounded-lg border border-slate-800 text-xs">
              {([['Write', false], ['Preview', true]] as const).map(([label, v]) => (
                <button
                  key={label}
                  onClick={() => setRecapPreview(v)}
                  className={`px-2.5 py-1 font-semibold ${
                    recapPreview === v
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={saveRecap}
              disabled={savingRecap || !recapDirty}
            >
              {savingRecap ? 'Saving…' : 'Save Recap'}
            </button>
          </div>
        </div>
        {recapPreview ? (
          <div
            className="min-h-[60px] cursor-text rounded-lg border border-slate-800 bg-slate-900/30 p-3"
            onDoubleClick={() => setRecapPreview(false)}
            title="Double-click to edit"
          >
            <Markdown source={recap} empty={<p className="text-sm text-slate-500">Nothing written yet.</p>} />
          </div>
        ) : (
          <textarea
            className="input min-h-[120px] w-full resize-y"
            value={recap}
            onChange={(e) => {
              setRecap(e.target.value);
              setRecapDirty(true);
            }}
            placeholder="How did the day go against the plan? What worked, what to carry into tomorrow…"
          />
        )}
        <p className="mt-1 text-[11px] text-slate-500">
          Markdown: **bold**, - lists, - [ ] tasks, ## headings · #123 links a trade, @2026-09-15 a day
        </p>
        {data?.recap?.updated_at && !recapDirty && (
          <p className="mt-2 text-xs text-slate-500">Last saved {data.recap.updated_at}</p>
        )}
      </div>
    </div>
  );
}
