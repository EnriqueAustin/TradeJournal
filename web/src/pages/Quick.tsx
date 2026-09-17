import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import Sheet from '../components/Sheet';
import QuickReview from '../components/trade/QuickReview';
import AddTradeModal from '../components/AddTradeModal';
import MissedTradesCard from '../components/MissedTradesCard';
import { localToday } from '../components/Sidebar';
import { rangeFilters, reviewPath, shiftDay, todayUtc } from '../utils/review';
import {
  DISPLAY_TZ,
  formatDuration,
  formatMoney,
  formatR,
  sessionLabel,
  signClass,
} from '../utils/format';
import type { Trade, TradeDetail } from '../types';

const localDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ }).format(new Date(iso));
const clock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: DISPLAY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/**
 * Quick capture — the phone screen for journaling right after a trade. Today's
 * trades (or the most recent one) as big cards; tap one to grade it, mark the
 * plan, tag mistakes and emotion, add a note and snap a screenshot. Plus
 * shortcuts to log a missed setup or a manual trade. All existing endpoints.
 */
export default function Quick() {
  const { filters, accounts, accountsLoading, setups } = useFilters();
  const today = localToday();
  const [rows, setRows] = useState<Trade[] | null>(null);
  const [isToday, setIsToday] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showMissed, setShowMissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const scope = { profile: filters.profile ?? null };
      // from/to filter on the UTC realized date; pad a day either side and keep
      // the trades whose exit falls on today's local (display-zone) date.
      const utc = todayUtc();
      const r = await api.getTrades(
        { ...rangeFilters(filters.account, shiftDay(utc, -1), shiftDay(utc, 1)), ...scope },
        200,
        0,
        { sort: 'realized', dir: 'desc' }
      );
      const todays = r.rows.filter((t) => localDay(t.exit_time || t.entry_time) === today);
      if (todays.length > 0) {
        setRows(todays);
        setIsToday(true);
      } else {
        const last = await api.getTrades(
          { ...rangeFilters(filters.account, '', ''), ...scope },
          1,
          0,
          { sort: 'realized', dir: 'desc' }
        );
        setRows(last.rows);
        setIsToday(false);
      }
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load trades');
    }
  }, [filters.account, filters.profile, today]);

  useEffect(() => {
    load();
  }, [load]);

  const missedAccount = filters.account ?? accounts[0]?.id ?? null;
  const unreviewed = rows?.filter((t) => t.followed_plan == null).length ?? 0;
  const currencyOf = (t: Trade) => accounts.find((a) => a.id === t.account_id)?.currency ?? 'USD';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <h1 className="hidden text-xl font-semibold text-slate-100 md:block">Quick capture</h1>
        <p className="text-sm text-slate-500">
          {rows == null
            ? 'Loading…'
            : isToday
              ? `${rows.length} trade${rows.length === 1 ? '' : 's'} today · ${unreviewed} unreviewed`
              : rows.length
                ? 'No trades today yet — here is your last one.'
                : 'No trades yet.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn min-h-[48px]" onClick={() => setShowMissed(true)}>
          ◌ Log missed trade
        </button>
        <button type="button" className="btn min-h-[48px]" onClick={() => setShowAdd(true)}>
          + Manual trade
        </button>
      </div>

      {err && (
        <div className="card flex items-center justify-between gap-2 border-red-500/30 p-3 text-sm text-red-400">
          {err}
          <button className="btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {rows != null && rows.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label={isToday ? "Today's trades" : 'Last trade'}>
          {rows.map((t, i) => (
            <li key={t.id}>
              <TradeCard trade={t} currency={currencyOf(t)} onOpen={() => setOpenIdx(i)} />
            </li>
          ))}
        </ul>
      )}

      {rows != null && rows.length > 0 && (
        <Link
          to={reviewPath('day', isToday ? today : localDay(rows[0].exit_time || rows[0].entry_time))}
          className="btn min-h-[44px]"
        >
          Full review with charts →
        </Link>
      )}

      {openIdx != null && rows && rows[openIdx] && (
        <CaptureSheet
          key={rows[openIdx].id}
          tradeId={rows[openIdx].id}
          setups={setups}
          position={`${openIdx + 1} / ${rows.length}`}
          isLast={openIdx === rows.length - 1}
          onChanged={load}
          onNext={() => setOpenIdx(openIdx < rows.length - 1 ? openIdx + 1 : null)}
          onPrev={openIdx > 0 ? () => setOpenIdx(openIdx - 1) : undefined}
          onClose={() => setOpenIdx(null)}
        />
      )}

      {showAdd && <AddTradeModal onClose={() => setShowAdd(false)} onCreated={load} />}

      {showMissed && (
        <Sheet title="Log missed trade" onClose={() => setShowMissed(false)}>
          {accountsLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <MissedTradesCard account={missedAccount} day={today} bare />
          )}
        </Sheet>
      )}
    </div>
  );
}

function TradeCard({
  trade: t,
  currency,
  onOpen,
}: {
  trade: Trade;
  currency: string;
  onOpen: () => void;
}) {
  const grade = t.tags?.find((g) => g.category === 'grade')?.name ?? null;
  const mistakes = t.tags?.filter((g) => g.category === 'mistake').length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`card flex w-full flex-col gap-2 p-4 text-left transition active:scale-[0.99] ${
        t.followed_plan == null ? 'border-amber-500/50' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-slate-100">{t.instrument}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            t.direction === 'long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
          }`}
        >
          {t.direction}
        </span>
        <span className={`num ml-auto text-lg font-semibold ${t.is_be ? 'text-slate-300' : signClass(t.net_pnl)}`}>
          {formatMoney(t.net_pnl, currency)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="num">
          {clock(t.entry_time)}–{clock(t.exit_time)}
        </span>
        <span>· {sessionLabel(t.session)}</span>
        <span>· {formatDuration(t.hold_time_sec)}</span>
        <span className={`num ml-auto text-sm ${signClass(t.r_multiple)}`}>{formatR(t.r_multiple)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {t.followed_plan == null ? (
          <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-amber-400">
            Tap to review
          </span>
        ) : t.followed_plan ? (
          <span className="rounded-full border border-emerald-500/50 px-2 py-0.5 text-emerald-400">
            ✓ Followed plan
          </span>
        ) : (
          <span className="rounded-full border border-red-500/50 px-2 py-0.5 text-red-400">✗ Broke plan</span>
        )}
        {grade && (
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300">Grade {grade}</span>
        )}
        {mistakes > 0 && (
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-400">
            {mistakes} mistake{mistakes === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </button>
  );
}

function CaptureSheet({
  tradeId,
  setups,
  position,
  isLast,
  onChanged,
  onNext,
  onPrev,
  onClose,
}: {
  tradeId: number;
  setups: { id: number; name: string }[];
  position: string;
  isLast: boolean;
  onChanged: () => void;
  onNext: () => void;
  onPrev?: () => void;
  onClose: () => void;
}) {
  const [trade, setTrade] = useState<TradeDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadTrade = useCallback(async () => {
    try {
      setTrade(await api.getTrade(tradeId));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load trade');
    }
  }, [tradeId]);
  useEffect(() => {
    loadTrade();
  }, [loadTrade]);

  const changed = useCallback(() => {
    loadTrade();
    onChanged();
  }, [loadTrade, onChanged]);

  return (
    <Sheet
      fullHeight
      onClose={onClose}
      title={
        trade ? (
          <span className="flex items-center gap-2">
            <span className="num text-xs text-slate-500">{position}</span>
            {trade.instrument} <span className="capitalize text-slate-400">{trade.direction}</span>
            <span className={`num ${signClass(trade.net_pnl)}`}>{formatR(trade.r_multiple)}</span>
            <Link to={`/trades/${trade.id}`} className="ml-auto text-xs font-normal text-cyan-400">
              Details
            </Link>
          </span>
        ) : (
          'Loading…'
        )
      }
    >
      {err && <p className="text-sm text-red-400">{err}</p>}
      {trade && (
        <QuickReview
          trade={trade}
          setups={setups}
          onChanged={changed}
          onNext={onNext}
          onPrev={onPrev}
          isLast={isLast}
          nextLabel={isLast ? 'Done' : 'Next'}
          keyboard={false}
          withScreenshot
          bare
        />
      )}
    </Sheet>
  );
}
