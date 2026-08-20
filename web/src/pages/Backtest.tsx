import { useEffect, useMemo, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import { AsyncBoundary } from '../components/states';
import CandleChart, { type ChartMarker } from '../components/CandleChart';
import StatTile from '../components/StatTile';
import type { Bar, Trade, StatsSummary, BarSeriesInfo, Direction } from '../types';
import {
  formatMoney,
  formatR,
  formatPct,
  formatNumber,
  formatDateTime,
  signClass,
} from '../utils/format';

interface Pending {
  entry?: { t: string; price: number };
  exit?: { t: string; price: number };
}

function toTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

export default function Backtest() {
  const { filters, accounts, setups } = useFilters();
  const currency =
    accounts.find((a) => a.id === filters.account)?.currency ?? 'USD';

  const [series, setSeries] = useState<BarSeriesInfo[]>([]);
  const [instrument, setInstrument] = useState('XAUUSD');
  const [tf, setTf] = useState('M1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [setupId, setSetupId] = useState('');

  const [bars, setBars] = useState<Bar[]>([]);
  const [loadingBars, setLoadingBars] = useState(false);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [pending, setPending] = useState<Pending>({});
  const [direction, setDirection] = useState<Direction>('long');
  const [size, setSize] = useState('1');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [resultsLoading, setResultsLoading] = useState(true);

  // Load available bar series once for the instrument/tf pickers.
  useEffect(() => {
    api
      .getBarSeries()
      .then((s) => {
        setSeries(s);
        if (s.length > 0) {
          setInstrument((cur) =>
            s.some((x) => x.instrument === cur) ? cur : s[0].instrument
          );
          setTf((cur) => (s.some((x) => x.tf === cur) ? cur : s[0].tf));
        }
      })
      .catch(() => setSeries([]));
  }, []);

  const instruments = useMemo(() => {
    const set = new Set<string>(['XAUUSD', 'US100']);
    for (const s of series) set.add(s.instrument);
    return [...set];
  }, [series]);
  const tfs = useMemo(() => {
    const set = new Set<string>(['S5', 'M1']);
    for (const s of series) set.add(s.tf);
    const ORDER = ['S5', 'S15', 'S30', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
    return [...set].sort(
      (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)
    );
  }, [series]);

  const refreshResults = () => {
    setResultsLoading(true);
    setResultsError(null);
    Promise.all([
      api.getBacktestTrades({ account: filters.account, instrument }),
      api.getBacktestStats({ account: filters.account, instrument }),
    ])
      .then(([t, s]) => {
        setTrades(t.rows);
        setStats(s);
      })
      .catch((e) => setResultsError(e?.message || 'Failed to load results'))
      .finally(() => setResultsLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshResults, [filters.account, instrument]);

  const loadBars = async () => {
    setLoadingBars(true);
    setBarsError(null);
    setPending({});
    try {
      const res = await api.runBacktest({
        instrument,
        tf,
        from: from || undefined,
        to: to || undefined,
        setup_id: setupId ? Number(setupId) : null,
      });
      setBars(res.bars);
      setLoaded(true);
    } catch (e: any) {
      setBarsError(e?.message || 'Failed to load bars');
      setBars([]);
    } finally {
      setLoadingBars(false);
    }
  };

  const onClickPrice = (t: string, price: number) => {
    const rounded = Number(price.toFixed(2));
    setPending((p) => {
      if (!p.entry) return { entry: { t, price: rounded } };
      if (!p.exit) {
        // auto-suggest direction from entry→exit
        setDirection(rounded >= p.entry.price ? 'long' : 'short');
        return { ...p, exit: { t, price: rounded } };
      }
      return { entry: { t, price: rounded } };
    });
  };

  const pendingMarkers: ChartMarker[] = useMemo(() => {
    const m: ChartMarker[] = [];
    if (pending.entry)
      m.push({
        time: toTime(pending.entry.t),
        position: 'belowBar',
        color: '#6366f1',
        shape: 'arrowUp',
        text: `Entry ${pending.entry.price}`,
      });
    if (pending.exit)
      m.push({
        time: toTime(pending.exit.t),
        position: 'aboveBar',
        color: '#f59e0b',
        shape: 'square',
        text: `Exit ${pending.exit.price}`,
      });
    return m.sort((a, b) => (a.time as number) - (b.time as number));
  }, [pending]);

  const save = async () => {
    if (!pending.entry || !pending.exit) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await api.saveBacktestTrade({
        instrument,
        tf,
        direction,
        entry_time: pending.entry.t,
        exit_time: pending.exit.t,
        entry_price: pending.entry.price,
        exit_price: pending.exit.price,
        size: Number(size) || 1,
        stop_price: stop ? Number(stop) : null,
        target_price: target ? Number(target) : null,
        setup_id: setupId ? Number(setupId) : null,
        account_id: filters.account,
      });
      setPending({});
      setStop('');
      setTarget('');
      refreshResults();
    } catch (e: any) {
      setSaveErr(e?.message || 'Failed to save trade');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: number) => {
    try {
      await api.deleteBacktestTrade(id);
      refreshResults();
    } catch {
      /* ignore */
    }
  };

  const bothPicked = pending.entry && pending.exit;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Backtest</h1>
        <p className="text-sm text-slate-500">
          Load historical bars, then click the chart to log a hypothetical entry
          and exit. Backtest trades are kept separate from real stats.
        </p>
      </div>

      {/* Controls */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="bt-inst">
            Instrument
          </label>
          <select
            id="bt-inst"
            className="input"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
          >
            {instruments.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="bt-tf">
            Timeframe
          </label>
          <select
            id="bt-tf"
            className="input"
            value={tf}
            onChange={(e) => setTf(e.target.value)}
          >
            {tfs.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="bt-from">
            From
          </label>
          <input
            id="bt-from"
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="bt-to">
            To
          </label>
          <input
            id="bt-to"
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="bt-setup">
            Setup
          </label>
          <select
            id="bt-setup"
            className="input"
            value={setupId}
            onChange={(e) => setSetupId(e.target.value)}
          >
            <option value="">— none —</option>
            {setups.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={loadBars} disabled={loadingBars}>
          {loadingBars ? 'Loading…' : 'Load bars'}
        </button>
      </div>

      {barsError && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {barsError}
        </div>
      )}

      {/* Chart */}
      {loaded && (
        <div className="card p-4">
          {bars.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No bars for {instrument} {tf} in this range. Import bars first.
            </div>
          ) : (
            <>
              <div className="mb-2 text-xs text-slate-500">
                {bars.length} bars ·{' '}
                {pending.entry
                  ? pending.exit
                    ? 'entry + exit picked — review below'
                    : 'click to set exit'
                  : 'click a candle to set entry'}
              </div>
              <CandleChart
                bars={bars}
                markers={pendingMarkers}
                onClickPrice={onClickPrice}
              />
            </>
          )}
        </div>
      )}

      {/* Pending trade form */}
      {bothPicked && (
        <div className="card flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold text-slate-200">New backtest trade</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Direction</label>
              <select
                className="input"
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
              >
                <option value="long">long</option>
                <option value="short">short</option>
              </select>
            </div>
            <div>
              <label className="label">Size</label>
              <input
                className="input w-24"
                type="number"
                step="any"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Entry</label>
              <div className="num input w-28 bg-slate-900/60">
                {pending.entry?.price}
              </div>
            </div>
            <div>
              <label className="label">Exit</label>
              <div className="num input w-28 bg-slate-900/60">
                {pending.exit?.price}
              </div>
            </div>
            <div>
              <label className="label">Stop</label>
              <input
                className="input w-28"
                type="number"
                step="any"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Target</label>
              <input
                className="input w-28"
                type="number"
                step="any"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save trade'}
            </button>
            <button className="btn" onClick={() => setPending({})}>
              Clear
            </button>
          </div>
          <div className="text-xs text-slate-500">
            Entry {formatDateTime(pending.entry?.t)} → Exit{' '}
            {formatDateTime(pending.exit?.t)}
          </div>
          {saveErr && <p className="text-sm text-red-400">{saveErr}</p>}
        </div>
      )}

      {/* Results summary */}
      <AsyncBoundary
        loading={resultsLoading}
        error={resultsError}
        onRetry={refreshResults}
        loadingLabel="Loading results…"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Net P&L"
            value={formatMoney(stats?.net_pnl, currency)}
            valueClass={signClass(stats?.net_pnl)}
          />
          <StatTile label="Trades" value={stats?.trade_count ?? 0} />
          <StatTile label="Win Rate" value={formatPct(stats?.win_rate)} />
          <StatTile
            label="Profit Factor"
            value={stats ? formatNumber(stats.profit_factor, 2) : '—'}
          />
          <StatTile
            label="Expectancy"
            value={formatMoney(stats?.expectancy, currency)}
            valueClass={signClass(stats?.expectancy)}
          />
          <StatTile label="Avg R" value={formatR(stats?.avg_r)} />
        </div>

        {/* Results table */}
        <div className="card overflow-hidden">
          {trades.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No backtest trades yet for {instrument}. Log one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Instrument</th>
                    <th className="px-4 py-2.5 font-medium">Dir</th>
                    <th className="px-4 py-2.5 font-medium">Entry</th>
                    <th className="px-4 py-2.5 font-medium">Exit</th>
                    <th className="px-4 py-2.5 text-right font-medium">Size</th>
                    <th className="px-4 py-2.5 text-right font-medium">Net P&L</th>
                    <th className="px-4 py-2.5 text-right font-medium">R</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} className="border-b border-slate-800/60">
                      <td className="px-4 py-2.5 font-medium text-slate-200">
                        {t.instrument}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            t.direction === 'long'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-red-500/15 text-red-400'
                          }`}
                        >
                          {t.direction}
                        </span>
                      </td>
                      <td className="num px-4 py-2.5 text-slate-400">
                        {formatDateTime(t.entry_time)}
                      </td>
                      <td className="num px-4 py-2.5 text-slate-400">
                        {formatDateTime(t.exit_time)}
                      </td>
                      <td className="num px-4 py-2.5 text-right text-slate-300">
                        {formatNumber(t.size, 2)}
                      </td>
                      <td
                        className={`num px-4 py-2.5 text-right font-semibold ${signClass(
                          t.net_pnl
                        )}`}
                      >
                        {formatMoney(t.net_pnl, currency)}
                      </td>
                      <td
                        className={`num px-4 py-2.5 text-right ${
                          t.r_multiple == null ? 'text-slate-500' : signClass(t.r_multiple)
                        }`}
                      >
                        {formatR(t.r_multiple)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          className="text-slate-500 hover:text-red-400"
                          onClick={() => del(t.id)}
                          aria-label="Delete backtest trade"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AsyncBoundary>
    </div>
  );
}
