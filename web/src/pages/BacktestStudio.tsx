import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import {
  DISPLAY_TZ,
  formatMoney,
  formatNumber,
  formatPct,
  formatR,
  signClass,
} from '../utils/format';
import { ReplayEngine } from '../backtest/engine';
import { useReplayCursor } from '../backtest/useReplay';
import { useBroker } from '../backtest/useBroker';
import type { ClosedTrade } from '../backtest/broker';
import Transport from '../backtest/Transport';
import OrderTicket from '../backtest/OrderTicket';
import StudioChart from '../backtest/chart/StudioChart';
import type { PositionBox } from '../components/CandleChart';
import type { BtSession, BarSeriesInfo, StatsSummary } from '../types';

function toIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

// Format a cursor time (unix seconds) in the app's display timezone.
function cursorLabel(sec: number): string {
  return new Date(sec * 1000).toLocaleString('en-GB', {
    timeZone: DISPLAY_TZ,
    hour12: false,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BacktestStudio() {
  const { filters, accounts } = useFilters();

  const [sessions, setSessions] = useState<BtSession[]>([]);
  const [current, setCurrent] = useState<BtSession | null>(null);
  const [engine, setEngine] = useState<ReplayEngine | null>(null);
  const [series, setSeries] = useState<BarSeriesInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-session form.
  const [instrument, setInstrument] = useState('XAUUSD');
  const [baseTf, setBaseTf] = useState('M1');
  const [startAt, setStartAt] = useState('');

  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [log, setLog] = useState<ClosedTrade[]>([]);

  const cursor = useReplayCursor(engine);
  const engineRef = useRef<ReplayEngine | null>(null);
  engineRef.current = engine;

  const currentRef = useRef<BtSession | null>(current);
  currentRef.current = current;

  const account =
    accounts.find((a) => a.id === current?.account_id) ??
    accounts.find((a) => a.id === filters.account) ??
    accounts[0];
  const currency = account?.currency ?? 'USD';
  const startingBalance = account?.starting_balance ?? 10000;

  const refreshStats = useCallback((sessionId: number) => {
    api.getBtSessionStats(sessionId).then(setStats).catch(() => setStats(null));
  }, []);

  // Persist each closed trade to the session, then refresh the session stats.
  const handleClose = useCallback(
    (trade: ClosedTrade) => {
      setLog((prev) => [trade, ...prev]);
      const session = currentRef.current;
      if (!session) return;
      api
        .saveBacktestTrade({
          instrument: session.instrument,
          tf: session.base_tf,
          direction: trade.side,
          entry_time: toIso(trade.entryTime),
          exit_time: toIso(trade.exitTime),
          entry_price: trade.entryPrice,
          exit_price: trade.exitPrice,
          size: trade.size,
          stop_price: trade.sl,
          target_price: trade.tp,
          account_id: session.account_id,
          bt_session_id: session.id,
        })
        .then(() => refreshStats(session.id))
        .catch(() => {});
    },
    [refreshStats]
  );

  const { broker, state: brokerState } = useBroker(engine, handleClose);

  // Shade the open position on the chart (entry line + risk/reward zones),
  // reusing CandleChart's PositionBox. The right edge tracks the replay cursor.
  const positionBox: PositionBox | null = useMemo(() => {
    const p = brokerState?.position;
    if (!p || !cursor) return null;
    return {
      direction: p.side,
      entryTime: p.entryTime as UTCTimestamp,
      rightTime: Math.max(cursor.time, p.entryTime) as UTCTimestamp,
      entryPrice: p.entryPrice,
      stopPrice: p.sl,
      targetPrice: p.tp,
      targetIsTP: p.tp != null,
    };
  }, [brokerState?.position, cursor?.time]);

  const balance = startingBalance + (brokerState?.realized ?? 0);

  // Load session list + available bar series once.
  useEffect(() => {
    api.listBtSessions(filters.account).then(setSessions).catch(() => setSessions([]));
    api
      .getBarSeries()
      .then((s) => {
        setSeries(s);
        if (s.length) {
          setInstrument((c) => (s.some((x) => x.instrument === c) ? c : s[0].instrument));
        }
      })
      .catch(() => setSeries([]));
  }, [filters.account]);

  // Tear down the engine on unmount.
  useEffect(() => () => engineRef.current?.destroy(), []);

  const instruments = useMemo(() => {
    const set = new Set<string>(['XAUUSD', 'US100']);
    for (const s of series) set.add(s.instrument);
    return [...set];
  }, [series]);

  const tfs = useMemo(() => {
    const set = new Set<string>(['M1', 'M5', 'M15', 'M30', 'H1']);
    for (const s of series) set.add(s.tf);
    return [...set];
  }, [series]);

  // Persist the cursor position (throttled) so a session resumes where you left.
  const lastSaved = useRef(0);
  useEffect(() => {
    if (!current || !cursor || cursor.total === 0) return;
    const now = Date.now();
    if (now - lastSaved.current < 1500) return;
    lastSaved.current = now;
    const iso = new Date(cursor.time * 1000).toISOString();
    api.updateBtSession(current.id, { cursor_time: iso }).catch(() => {});
  }, [cursor?.time, current]);

  async function openSession(session: BtSession) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getBtSessionBars(session.id, [session.base_tf]);
      const frame = data.frames[0];
      const bars = frame?.bars ?? [];
      const startSec = session.cursor_time
        ? Math.floor(new Date(session.cursor_time).getTime() / 1000)
        : null;
      engineRef.current?.destroy();
      const eng = new ReplayEngine(bars, startSec);
      setEngine(eng);
      setCurrent(session);
      setLog([]);
      refreshStats(session.id);
      if (!bars.length)
        setError(`No ${session.base_tf} bars stored for ${session.instrument}. Import or fetch bars first.`);
    } catch (e: any) {
      setError(e?.message || 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }

  async function createSession() {
    setLoading(true);
    setError(null);
    try {
      const s = await api.createBtSession({
        instrument,
        base_tf: baseTf,
        account_id: filters.account,
        start_time: startAt ? new Date(startAt).toISOString() : null,
        cursor_time: startAt ? new Date(startAt).toISOString() : null,
        name: `${instrument} ${baseTf} · ${new Date().toLocaleDateString('en-GB')}`,
      });
      setSessions((prev) => [s, ...prev]);
      await openSession(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to create session');
      setLoading(false);
    }
  }

  async function deleteSession(id: number) {
    await api.deleteBtSession(id).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (current?.id === id) {
      engineRef.current?.destroy();
      setEngine(null);
      setCurrent(null);
    }
  }

  function closeSession() {
    engineRef.current?.destroy();
    setEngine(null);
    setCurrent(null);
  }

  // ---- Lobby: pick or create a session ----
  if (!current || !engine) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Backtest Studio</h1>
          <p className="text-sm text-slate-500">
            FXReplay-style bar replay: rewind the market, press play, and trade forward
            through unseen price. Start a new session or resume one below.
          </p>
        </div>

        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label" htmlFor="st-inst">Instrument</label>
            <select id="st-inst" className="input" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
              {instruments.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="st-tf">Base timeframe</label>
            <select id="st-tf" className="input" value={baseTf} onChange={(e) => setBaseTf(e.target.value)}>
              {tfs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="st-start">Start at (optional)</label>
            <input id="st-start" type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={createSession} disabled={loading}>
            {loading ? 'Starting…' : 'Start session'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-300">
            {error}
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Sessions
          </div>
          {sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No sessions yet. Start one above.
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <button className="flex-1 text-left hover:text-indigo-300" onClick={() => openSession(s)}>
                    <span className="font-medium text-slate-200">{s.name || `Session ${s.id}`}</span>
                    <span className="ml-2 text-slate-500">
                      {s.instrument} · {s.base_tf}
                      {s.cursor_time ? ` · at ${cursorLabel(Math.floor(new Date(s.cursor_time).getTime() / 1000))}` : ''}
                    </span>
                  </button>
                  <button className="text-slate-500 hover:text-red-400" onClick={() => deleteSession(s.id)} aria-label="Delete session">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ---- Active workspace ----
  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3">
      {/* Top bar: session + transport */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-2">
          <button className="btn" onClick={closeSession} title="Back to sessions">←</button>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-100">{current.name || `Session ${current.id}`}</div>
            <div className="text-[11px] text-slate-500">{current.instrument} · {current.base_tf}</div>
          </div>
        </div>
        <div className="ml-auto flex-1 min-w-[320px]">
          {cursor && <Transport engine={engine} cursor={cursor} barTimeLabel={cursorLabel} />}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-300">{error}</div>
      )}

      {/* Workspace grid: left tools · chart · right panel */}
      <div className="grid flex-1 grid-cols-[44px_1fr_320px] gap-3 overflow-hidden">
        {/* Left rail — drawing tools (Phase 4) */}
        <div className="card flex flex-col items-center gap-2 py-3 text-slate-600">
          <span className="text-[10px] uppercase">Tools</span>
          <span className="text-xs">soon</span>
        </div>

        {/* Chart */}
        <div className="card overflow-hidden p-2">
          <StudioChart engine={engine} height={0} windowSize={130} positionBox={positionBox} />
        </div>

        {/* Right rail — order ticket · stats · trade log */}
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="card p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Order ticket
            </div>
            {broker && brokerState ? (
              <OrderTicket
                broker={broker}
                state={brokerState}
                balance={balance}
                currency={currency}
                defaultRiskPct={current.risk_pct ?? 1}
              />
            ) : (
              <div className="text-xs text-slate-500">Loading…</div>
            )}
          </div>

          <div className="card p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Session stats
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <Meta label="Net P&L" value={formatMoney(stats?.net_pnl, currency)} cls={signClass(stats?.net_pnl)} />
              <Meta label="Trades" value={String(stats?.trade_count ?? 0)} />
              <Meta label="Win rate" value={formatPct(stats?.win_rate)} />
              <Meta label="Profit factor" value={stats ? formatNumber(stats.profit_factor, 2) : '—'} />
              <Meta label="Expectancy" value={formatMoney(stats?.expectancy, currency)} cls={signClass(stats?.expectancy)} />
              <Meta label="Avg R" value={formatR(stats?.avg_r)} />
            </div>
          </div>

          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              This session ({log.length})
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {log.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-500">
                  No trades yet — place one from the ticket.
                </div>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {log.map((t, i) => (
                    <li key={i} className="flex items-center justify-between rounded border border-slate-800 px-2 py-1">
                      <span className={t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                        {t.side} · {t.reason}
                      </span>
                      <span className={`num ${signClass(t.grossPnl)}`}>
                        {formatMoney(t.grossPnl, currency)}
                        {t.r != null ? ` · ${formatNumber(t.r, 2)}R` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`num ${cls || 'text-slate-300'}`}>{value}</dd>
    </div>
  );
}
