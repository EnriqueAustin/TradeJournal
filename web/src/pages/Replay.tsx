import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { UTCTimestamp } from 'lightweight-charts';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useFilters } from '../store/FilterContext';
import { AsyncBoundary } from '../components/states';
import ReplayGrid from '../components/ReplayGrid';
import SocialShareModal from '../components/SocialShareModal';
import { frameTimes, snapToBar } from '../utils/replay';
import type { ReplayResponse, ReplayFrame, Trade, TradeDetail } from '../types';
import { formatMoney, formatDateTime } from '../utils/format';

const SPEEDS = [
  { label: '0.5×', ms: 700 },
  { label: '1×', ms: 350 },
  { label: '2×', ms: 150 },
  { label: '4×', ms: 60 },
];

// Timeframes requested for replay — from the finest OANDA candle (S5, gold
// only) up to H1. The driver (timeline) uses the finest that actually has bars;
// the grid shows the four finest available.
const REQUEST_TFS = ['S5', 'M1', 'M5', 'M15', 'M30', 'H1'];
const GRID_MAX = 4;
const TF_SEC: Record<string, number> = {
  S5: 5, M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600,
};

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
    () => api.getReplay(tradeId as number, REQUEST_TFS),
    [tradeId]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Replay</h1>
          <p className="text-sm text-slate-500">
            Step through the price action around a trade across timeframes.
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
          {replay.data && (
            <ReplayView
              key={tradeId}
              data={replay.data}
              tradeId={tradeId}
              onPrimaryChange={replay.reload}
            />
          )}
        </AsyncBoundary>
      )}
    </div>
  );
}

function ReplayView({
  data,
  tradeId,
  onPrimaryChange,
}: {
  data: ReplayResponse;
  tradeId: number;
  onPrimaryChange: () => void;
}) {
  const frames = data.frames;
  const hasAnyBars = frames.some((f) => f.bars.length > 0);

  // Frames that actually have bars, finest first.
  const framesWithBars = useMemo(
    () =>
      frames
        .filter((f) => f.bars.length > 0)
        .sort((a, b) => (TF_SEC[a.tf] ?? 1e9) - (TF_SEC[b.tf] ?? 1e9)),
    [frames]
  );

  // Driver = smallest TF that actually has bars — its bars define the timeline.
  const driver: ReplayFrame | null = framesWithBars[0] ?? null;

  // TFs the user can pick as the single-view primary (only those with bars).
  const primaryTfs = useMemo(
    () => framesWithBars.map((f) => f.tf),
    [framesWithBars]
  );

  const timeline = useMemo(
    () => (driver ? frameTimes(driver.bars) : []),
    [driver]
  );
  const total = timeline.length;

  // Reveal starts at the entry bar of the driver timeline.
  const entryIdx = useMemo(() => {
    if (!driver) return 0;
    const snap = snapToBar(timeline, data.markers.entry?.t);
    if (snap == null) return Math.min(10, total);
    const i = timeline.findIndex((t) => t === snap);
    return i === -1 ? Math.min(10, total) : i + 1;
  }, [driver, timeline, data.markers.entry, total]);

  const [reveal, setReveal] = useState(entryIdx);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const [layout, setLayout] = useState<'grid' | 'single'>('grid');
  const [showBox, setShowBox] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [tradeDetail, setTradeDetail] = useState<TradeDetail | null>(null);
  const timerRef = useRef<number | null>(null);

  const openShare = async () => {
    try {
      const full = await api.getTrade(tradeId);
      setTradeDetail(full);
    } catch {
      /* ignore, fallback synthetic trade will be used */
    }
    setShowShare(true);
  };

  // Frames shown: the four finest-with-bars in grid view, just the primary TF
  // in single view.
  const shownFrames = useMemo(() => {
    if (layout === 'grid') return framesWithBars.slice(0, GRID_MAX);
    const primary =
      frames.find((f) => f.tf === data.primary_tf && f.bars.length > 0) ??
      driver ??
      frames.find((f) => f.tf === data.primary_tf);
    return primary ? [primary] : frames;
  }, [layout, frames, framesWithBars, data.primary_tf, driver]);

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
  const clamped = Math.max(1, Math.min(reveal, total));
  const revealTime: UTCTimestamp | undefined =
    total > 0 ? timeline[clamped - 1] : undefined;
  const currentIso =
    revealTime != null ? new Date((revealTime as number) * 1000).toISOString() : null;

  const setPrimary = async (tf: string) => {
    if (tf === data.primary_tf) return;
    try {
      await api.patchTrade(tradeId, { preferred_tf: tf });
      onPrimaryChange();
    } catch {
      /* non-fatal — highlight just won't persist */
    }
  };

  if (!hasAnyBars) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        No price bars found for {data.instrument}. Import bars on the Import page
        (any of {REQUEST_TFS.join(', ')}) to enable replay.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-200">
              {data.instrument} · {data.direction}
            </h2>
            <div className="flex items-center gap-1">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Primary
              </span>
              {primaryTfs.map((tf) => (
                <button
                  key={tf}
                  className={`btn px-2 py-0.5 text-xs ${
                    tf === data.primary_tf
                      ? 'border-indigo-500 text-indigo-300'
                      : ''
                  }`}
                  onClick={() => setPrimary(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                className={`btn px-2 py-0.5 text-xs ${
                  layout === 'single' ? 'border-indigo-500 text-indigo-300' : ''
                }`}
                onClick={() => setLayout('single')}
                title="Single chart (primary timeframe)"
              >
                ▭ 1
              </button>
              <button
                className={`btn px-2 py-0.5 text-xs ${
                  layout === 'grid' ? 'border-indigo-500 text-indigo-300' : ''
                }`}
                onClick={() => setLayout('grid')}
                title="Four-chart grid"
              >
                ▦ 4
              </button>
              <button
                className={`btn px-2 py-0.5 text-xs ${
                  showBox ? 'border-indigo-500 text-indigo-300' : ''
                }`}
                onClick={() => setShowBox((v) => !v)}
                title="Show / hide the position indicator"
              >
                ◱ Box
              </button>
              <button
                onClick={openShare}
                className="btn px-2 py-0.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/40"
                title="Generate social share graphic"
              >
                📸 Share Card
              </button>
            </div>
            <div className="num text-xs text-slate-500">
              {driver && <>{driver.tf} bar {clamped} / {total}</>}
              {currentIso && <> · {formatDateTime(currentIso)}</>}
            </div>
          </div>
        </div>

        <ReplayGrid
          frames={shownFrames}
          markers={data.markers}
          direction={data.direction}
          revealTime={revealTime}
          primaryTf={data.primary_tf}
          showBox={showBox}
        />

        {/* Playback bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2">
            <button
              className="btn px-3 text-xs"
              onClick={() => setReveal(1)}
              title="Jump to start"
            >
              ⏮
            </button>
            <button
              className="btn px-3 text-xs"
              onClick={() => { setPlaying(false); setReveal((r) => Math.max(1, r - 1)); }}
              title="Step backward 1 bar"
            >
              ◀ Step
            </button>
            <button
              className="btn px-4 text-xs font-semibold text-indigo-400"
              onClick={() => {
                if (atEnd) setReveal(1);
                setPlaying((p) => !p);
              }}
            >
              {playing ? '⏸ Pause' : atEnd ? '↺ Replay' : '▶ Play'}
            </button>
            <button
              className="btn px-3 text-xs"
              onClick={() => { setPlaying(false); setReveal((r) => Math.min(total, r + 1)); }}
              title="Step forward 1 bar"
            >
              Step ▶
            </button>
            <button
              className="btn px-3 text-xs"
              onClick={() => setReveal(total)}
              title="Jump to latest"
            >
              ⏭
            </button>
          </div>

          {/* Speed picker */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Speed
            </span>
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
      </div>

      {/* Trade summary */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Entry" value={data.markers.entry?.price ?? '—'} />
        <Stat label="Exit" value={data.markers.exit?.price ?? '—'} />
        <Stat label="Stop" value={data.markers.stop?.price ?? '—'} />
        <Stat label="Target" value={data.markers.target?.price ?? '—'} />
      </div>

      {showShare && (
        <SocialShareModal
          trade={
            tradeDetail || {
              id: tradeId,
              account_id: 1,
              instrument: data.instrument,
              direction: data.direction,
              entry_time: data.markers.entry?.t || '',
              exit_time: data.markers.exit?.t || '',
              entry_price: data.markers.entry?.price || 0,
              exit_price: data.markers.exit?.price || 0,
              stop_price: data.markers.stop?.price ?? null,
              target_price: data.markers.target?.price ?? null,
              size: 1,
              gross_pnl: 0,
              commission: 0,
              swap: 0,
              net_pnl: 0,
              r_multiple: null,
              mae: null,
              mfe: null,
              hold_time_sec: null,
              session: 'london',
              source: 'replay',
              ext_id: null,
              setup_id: null,
              created_at: new Date().toISOString(),
              executions: [],
              tags: [],
              notes: [],
              screenshots: [],
            }
          }
          frames={data.frames}
          onClose={() => setShowShare(false)}
        />
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
