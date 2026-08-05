import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { UTCTimestamp } from 'lightweight-charts';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useFilters } from '../store/FilterContext';
import { AsyncBoundary } from '../components/states';
import CandleChart, {
  type ChartMarker,
  type PriceLineSpec,
} from '../components/CandleChart';
import type { ReplayResponse, Trade } from '../types';
import { formatMoney, formatDateTime } from '../utils/format';

const SPEEDS = [
  { label: '0.5×', ms: 700 },
  { label: '1×', ms: 350 },
  { label: '2×', ms: 150 },
  { label: '4×', ms: 60 },
];

function toTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

// Snap a marker time to the nearest bar time <= it (markers must land on a bar).
function snapToBar(barTimes: UTCTimestamp[], iso?: string): UTCTimestamp | null {
  if (!iso || barTimes.length === 0) return null;
  const target = toTime(iso);
  let best: UTCTimestamp | null = null;
  for (const bt of barTimes) {
    if (bt <= target) best = bt;
    else break;
  }
  return best ?? barTimes[0];
}

export default function Replay() {
  const { filters } = useFilters();
  const [params, setParams] = useSearchParams();
  const tradeId = params.get('trade') ? Number(params.get('trade')) : null;

  // Trade picker source (respects global filters).
  const tradesQuery = useApi(
    () => api.getTrades(filters, 100, 0),
    [JSON.stringify(filters)]
  );
  const trades = tradesQuery.data?.rows ?? [];

  // Default the selection to the first available trade.
  useEffect(() => {
    if (tradeId == null && trades.length > 0) {
      setParams({ trade: String(trades[0].id) }, { replace: true });
    }
  }, [tradeId, trades, setParams]);

  const replay = useApi<ReplayResponse>(
    () => api.getReplay(tradeId as number, 'M1'),
    [tradeId]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Replay</h1>
          <p className="text-sm text-slate-500">
            Step through the price action around a trade.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="replay-trade">
            Trade
          </label>
          <select
            id="replay-trade"
            className="input min-w-[16rem]"
            value={tradeId ?? ''}
            onChange={(e) =>
              setParams(e.target.value ? { trade: e.target.value } : {})
            }
          >
            {trades.length === 0 && <option value="">No trades</option>}
            {trades.map((t: Trade) => (
              <option key={t.id} value={t.id}>
                #{t.id} · {t.instrument} {t.direction} ·{' '}
                {formatDateTime(t.entry_time)} · {formatMoney(t.net_pnl)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tradeId == null ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Select a trade to replay.
        </div>
      ) : (
        <AsyncBoundary
          loading={replay.loading}
          error={replay.error}
          onRetry={replay.reload}
          loadingLabel="Loading bars…"
        >
          {replay.data && <ReplayView data={replay.data} />}
        </AsyncBoundary>
      )}
    </div>
  );
}

function ReplayView({ data }: { data: ReplayResponse }) {
  const bars = data.bars;
  const total = bars.length;

  const barTimes = useMemo(
    () => bars.map((b) => toTime(b.t)).sort((a, b) => a - b),
    [bars]
  );

  const entrySnap = snapToBar(barTimes, data.markers.entry?.t);
  const exitSnap = snapToBar(barTimes, data.markers.exit?.t);

  const markers: ChartMarker[] = useMemo(() => {
    const m: ChartMarker[] = [];
    if (entrySnap != null && data.markers.entry) {
      m.push({
        time: entrySnap,
        position: data.direction === 'long' ? 'belowBar' : 'aboveBar',
        color: '#6366f1',
        shape: data.direction === 'long' ? 'arrowUp' : 'arrowDown',
        text: `Entry ${data.markers.entry.price}`,
      });
    }
    if (exitSnap != null && data.markers.exit) {
      m.push({
        time: exitSnap,
        position: data.direction === 'long' ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: 'square',
        text: `Exit ${data.markers.exit.price}`,
      });
    }
    return m.sort((a, b) => (a.time as number) - (b.time as number));
  }, [entrySnap, exitSnap, data]);

  const priceLines: PriceLineSpec[] = useMemo(() => {
    const lines: PriceLineSpec[] = [];
    if (data.markers.stop)
      lines.push({ price: data.markers.stop.price, color: '#ef4444', title: 'Stop' });
    if (data.markers.target)
      lines.push({
        price: data.markers.target.price,
        color: '#10b981',
        title: 'Target',
      });
    return lines;
  }, [data]);

  // Index of the entry bar — replay starts revealed up to entry.
  const entryIdx = useMemo(() => {
    if (entrySnap == null) return Math.min(10, total);
    const i = barTimes.findIndex((t) => t === entrySnap);
    return i === -1 ? Math.min(10, total) : i + 1;
  }, [entrySnap, barTimes, total]);

  const [reveal, setReveal] = useState(entryIdx);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const timerRef = useRef<number | null>(null);

  // Reset when the trade (bars) changes.
  useEffect(() => {
    setReveal(entryIdx);
    setPlaying(false);
  }, [entryIdx, total]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => {
      setReveal((r) => {
        if (r >= total) {
          setPlaying(false);
          return r;
        }
        return r + 1;
      });
    }, speed);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [playing, speed, total]);

  const atEnd = reveal >= total;
  const revealedBar = bars[Math.max(0, Math.min(reveal, total) - 1)];

  return (
    <div className="flex flex-col gap-4">
      {total === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          No price bars found for {data.instrument} {data.tf}. Import bars on the
          Import page to enable replay.
        </div>
      ) : (
        <>
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-200">
                {data.instrument} · {data.tf} · {data.direction}
              </h2>
              <div className="num text-xs text-slate-500">
                bar {Math.min(reveal, total)} / {total}
                {revealedBar && (
                  <>
                    {' · '}
                    {formatDateTime(revealedBar.t)} · close {revealedBar.close}
                  </>
                )}
              </div>
            </div>
            <CandleChart
              bars={bars}
              reveal={reveal}
              markers={markers}
              priceLines={priceLines}
              lockRange
            />
          </div>

          {/* Controls */}
          <div className="card flex flex-wrap items-center gap-3 p-4">
            <button
              className="btn btn-primary"
              onClick={() => {
                if (atEnd) setReveal(entryIdx);
                setPlaying((p) => !p);
              }}
            >
              {playing ? '❚❚ Pause' : atEnd ? '↻ Replay' : '▶ Play'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setReveal((r) => Math.max(1, r - 1));
              }}
            >
              ◀ Step
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setReveal((r) => Math.min(total, r + 1));
              }}
            >
              Step ▶
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setReveal(entryIdx);
              }}
            >
              ⟲ Reset
            </button>

            <input
              type="range"
              min={1}
              max={total}
              value={Math.min(reveal, total)}
              onChange={(e) => {
                setPlaying(false);
                setReveal(Number(e.target.value));
              }}
              className="min-w-[10rem] flex-1 accent-indigo-500"
            />

            <div className="flex items-center gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s.ms}
                  className={`btn px-2 py-1 text-xs ${
                    speed === s.ms ? 'border-indigo-500 text-indigo-300' : ''
                  }`}
                  onClick={() => setSpeed(s.ms)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Trade summary */}
          <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Stat label="Entry" value={data.markers.entry?.price ?? '—'} />
            <Stat label="Exit" value={data.markers.exit?.price ?? '—'} />
            <Stat label="Stop" value={data.markers.stop?.price ?? '—'} />
            <Stat label="Target" value={data.markers.target?.price ?? '—'} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="num mt-0.5 text-sm text-slate-200">{value}</div>
    </div>
  );
}
