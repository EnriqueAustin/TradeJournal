import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { api } from '../../../api/client';
import { useApi, filterKey } from '../../../hooks/useApi';
import type { ResearchPriceResponse, EventMarker, ExplainMoveResponse, LevelsResponse } from '../../../types';
import type { Bar } from '../../../types';
import CandleChart, { type ChartMarker, type PriceLineSpec } from '../../../components/CandleChart';
import type { UTCTimestamp } from 'lightweight-charts';
import { Panel, StatusBadge, TickerCell } from '../terminal';

const TIMEFRAMES = ['S5', 'M1', 'M5', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1'] as const;
type TF = (typeof TIMEFRAMES)[number];

const TF_LABELS: Record<TF, string> = {
  S5: '5s', M1: '1m', M5: '5m', M15: '15m', M30: '30m',
  H1: '1H', H2: '2H', H4: '4H', D1: '1D',
};

// S5 (5-second) is ingested only for the focus instrument (gold).
const S5_INSTRUMENTS = new Set(['XAUUSD']);

// Colour per level type — magenta for intraday liquidity pools, dim for prior
// day/week structure. Shared by the chart lines and the level-picker swatches.
const LEVEL_COLOR: Record<string, string> = {
  session: '#c07bff',   // magenta — intraday session pools
  structure: '#7d8f88', // dim — prior day/week H-L
  liquidity: '#f0a020', // amber — equal-high/low resting liquidity
};
const DRAWABLE_TYPES = new Set(['session', 'structure', 'liquidity']);
const HIDDEN_LEVELS_KEY = 'sig-hidden-levels';

function loadHiddenLevels(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_LEVELS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

// Dropdown to choose which key levels are drawn on the chart. A checkbox per
// level (grouped session vs structure) plus All/None; the choice persists.
function LevelsMenu({
  levels,
  hidden,
  onToggle,
  onSetAll,
}: {
  levels: { label: string; type: string }[];
  hidden: Set<string>;
  onToggle: (label: string) => void;
  onSetAll: (hideAll: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const shownCount = levels.filter((l) => !hidden.has(l.label)).length;
  const groups: [string, typeof levels][] = [
    ['Session', levels.filter((l) => l.type === 'session')],
    ['Liquidity', levels.filter((l) => l.type === 'liquidity')],
    ['Structure', levels.filter((l) => l.type === 'structure')],
  ];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="sig-tab"
        onClick={() => setOpen((v) => !v)}
        title="Choose which levels to show"
        style={{ fontSize: '0.6rem' }}
      >
        LVLS {shownCount}/{levels.length} ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 210,
            minWidth: 160, background: 'var(--sig-panel-hd)',
            border: '1px solid var(--sig-border)', borderRadius: 4,
            padding: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button className="sig-tab" style={{ flex: 1, fontSize: '0.58rem' }} onClick={() => onSetAll(false)}>
              All
            </button>
            <button className="sig-tab" style={{ flex: 1, fontSize: '0.58rem' }} onClick={() => onSetAll(true)}>
              None
            </button>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {groups.map(([name, items]) =>
              items.length === 0 ? null : (
                <div key={name} style={{ marginBottom: 4 }}>
                  <div
                    style={{
                      fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: 'var(--sig-muted)', padding: '2px 2px',
                    }}
                  >
                    {name}
                  </div>
                  {items.map((l) => (
                    <label
                      key={l.label}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '3px 2px', fontSize: '0.68rem', cursor: 'pointer',
                        color: 'var(--sig-text)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden.has(l.label)}
                        onChange={() => onToggle(l.label)}
                        style={{ accentColor: LEVEL_COLOR[l.type] }}
                      />
                      <span
                        style={{
                          width: 10, height: 2, background: LEVEL_COLOR[l.type],
                          display: 'inline-block', flexShrink: 0,
                        }}
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface PricePanelProps {
  instrument: string;
  livePrice?: number;
}

function freshnessAge(lastOk: number | null): string {
  if (!lastOk) return 'no data';
  const secs = Math.floor((Date.now() - lastOk) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function ExplainPanel({ data, onClose }: { data: ExplainMoveResponse; onClose: () => void }) {
  return (
    <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--sig-border)', paddingTop: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <span style={{ fontWeight: 700, color: 'var(--sig-amber)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Explain This Move
        </span>
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          {data.cached && <StatusBadge kind="muted" label="CACHED" />}
          {data.model && <span style={{ fontSize: '0.55rem', color: 'var(--sig-muted-text)' }}>{data.model}</span>}
          <button className="sig-tab" onClick={onClose} style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem' }}>✕</button>
        </div>
      </div>

      {data.explanation ? (
        <div style={{ fontSize: '0.72rem', lineHeight: 1.5, maxHeight: '16rem', overflowY: 'auto' }}>
          {data.explanation.split('\n').map((line, i) => {
            const t = line.trim();
            if (!t) return null;
            if (t.startsWith('**') && t.includes('**')) {
              const bold = t.match(/\*\*(.*?)\*\*/)?.[1] ?? '';
              const rest = t.replace(/\*\*.*?\*\*/, '').trim();
              return (
                <p key={i} style={{ marginBottom: '0.3rem' }}>
                  <strong style={{ color: 'var(--sig-green)' }}>{bold}</strong>
                  {rest ? ` ${rest}` : ''}
                </p>
              );
            }
            if (t.startsWith('- ') || t.startsWith('• ') || /^\d+\.\s/.test(t)) {
              return <p key={i} className="sig-brief-bullet">{t}</p>;
            }
            return <p key={i} style={{ marginBottom: '0.3rem' }}>{t}</p>;
          })}
        </div>
      ) : (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          {data.error ?? 'Explanation unavailable'}
        </div>
      )}

      {data.evidence && (
        <details style={{ marginTop: '0.3rem', fontSize: '0.65rem', color: 'var(--sig-muted-text)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--sig-cyan)' }}>Evidence ({data.evidence.nearbyNews.length} news, {data.evidence.nearbyEvents.length} events)</summary>
          <div style={{ marginTop: '0.2rem', maxHeight: '8rem', overflowY: 'auto' }}>
            {data.evidence.nearbyNews.map((n, i) => (
              <div key={i} style={{ marginBottom: '0.15rem' }}>
                <span style={{ color: 'var(--sig-muted-text)' }}>{new Date(n.ts).toISOString().slice(11, 16)}</span>{' '}
                {n.headline}
                {n.sentiment != null && (
                  <span style={{ color: n.sentiment > 0 ? 'var(--sig-green)' : n.sentiment < 0 ? 'var(--sig-red)' : 'var(--sig-muted-text)' }}>
                    {' '}[{n.sentiment.toFixed(2)}]
                  </span>
                )}
              </div>
            ))}
            {data.evidence.nearbyEvents.map((e, i) => (
              <div key={`ev-${i}`} style={{ marginBottom: '0.15rem' }}>
                <span style={{ color: 'var(--sig-amber)' }}>EVENT</span>{' '}
                {e.name} ({e.country})
                {e.actual != null && ` actual: ${e.actual} vs ${e.consensus}`}
              </div>
            ))}
            {data.evidence.correlatedMoves.map((cm, i) => (
              <div key={`cm-${i}`} style={{ marginBottom: '0.15rem' }}>
                <span style={{ color: 'var(--sig-cyan)' }}>{cm.symbol}</span>{' '}
                <span style={{ color: cm.move > 0 ? 'var(--sig-green)' : 'var(--sig-red)' }}>
                  {cm.move > 0 ? '+' : ''}{cm.move}%
                </span>
              </div>
            ))}
            <div>Regime: <span style={{ color: 'var(--sig-amber)' }}>{data.evidence.regime}</span></div>
          </div>
        </details>
      )}
    </div>
  );
}

export default function PricePanel({ instrument, livePrice }: PricePanelProps) {
  const [tf, setTf] = useState<TF>('H1');
  const [explainData, setExplainData] = useState<ExplainMoveResponse | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hiddenLevels, setHiddenLevels] = useState<Set<string>>(loadHiddenLevels);
  const [showKZ, setShowKZ] = useState<boolean>(() => {
    try { return localStorage.getItem('sig-killzones') === '1'; } catch { return false; }
  });
  // Freeze the chart view: pan/zoom stays put while live price keeps ticking in,
  // instead of snapping back to a fit on every update.
  const [freezeView, setFreezeView] = useState<boolean>(() => {
    try { return localStorage.getItem('sig-freeze-view') === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('sig-killzones', showKZ ? '1' : '0'); } catch { /* ignore */ }
  }, [showKZ]);

  useEffect(() => {
    try { localStorage.setItem('sig-freeze-view', freezeView ? '1' : '0'); } catch { /* ignore */ }
  }, [freezeView]);

  // Persist which levels are hidden across sessions.
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_LEVELS_KEY, JSON.stringify([...hiddenLevels]));
    } catch { /* ignore */ }
  }, [hiddenLevels]);

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const { data, loading, error, reload } = useApi<ResearchPriceResponse>(
    () => api.getResearchPrice(instrument, tf),
    [filterKey(instrument, tf)]
  );

  const { data: markersData } = useApi<{ instrument: string; markers: EventMarker[] }>(
    () => {
      const from = data?.bars?.[0]?.ts;
      const to = data?.bars?.[data.bars.length - 1]?.ts;
      return api.getEventMarkers(instrument, from, to);
    },
    [filterKey(instrument, data?.bars?.[0]?.ts, data?.bars?.[data?.bars?.length - 1]?.ts)]
  );

  // Session liquidity levels (Asian/London range, NY open) + prior-day structure
  // drawn as horizontal lines — the pools a session-timed sweep strategy trades.
  const { data: levelsData } = useApi<LevelsResponse>(
    () => api.getLevels(instrument),
    [instrument]
  );

  // All levels the chart can draw (session pools + prior day/week structure).
  const drawableLevels = useMemo(
    () => (levelsData?.levels ?? []).filter((l) => DRAWABLE_TYPES.has(l.type)),
    [levelsData]
  );

  const priceLines: PriceLineSpec[] = useMemo(
    () =>
      drawableLevels
        .filter((l) => !hiddenLevels.has(l.label))
        .map((l) => ({ price: l.price, color: LEVEL_COLOR[l.type], title: l.label })),
    [drawableLevels, hiddenLevels]
  );

  const toggleLevel = useCallback((label: string) => {
    setHiddenLevels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const setAllLevels = useCallback(
    (hideAll: boolean) => {
      setHiddenLevels(hideAll ? new Set(drawableLevels.map((l) => l.label)) : new Set());
    },
    [drawableLevels]
  );

  const chartMarkers: ChartMarker[] = useMemo(() => {
    if (!markersData?.markers?.length) return [];
    return markersData.markers.map((m) => ({
      time: Math.floor(m.ts / 1000) as UTCTimestamp,
      position: 'belowBar' as const,
      color: m.impact === 'high' ? '#ef4444' : '#f59e0b',
      shape: 'arrowUp' as const,
      text: m.name.length > 20 ? m.name.slice(0, 18) + '…' : m.name,
    }));
  }, [markersData]);

  const bars: Bar[] = useMemo(() => {
    if (!data?.bars?.length) return [];
    const mapped = data.bars
      .filter((b) => b.o != null && b.h != null && b.l != null && b.c != null)
      .map((b) => ({
        t: new Date(b.ts).toISOString(),
        open: b.o!,
        high: b.h!,
        low: b.l!,
        close: b.c!,
        volume: b.v ?? 0,
      }));
    if (livePrice != null && mapped.length > 0) {
      const last = mapped[mapped.length - 1];
      mapped[mapped.length - 1] = {
        ...last,
        close: livePrice,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
      };
    }
    return mapped;
  }, [data, livePrice]);

  const handleExport = useCallback(() => {
    window.open(`/api/research/price/${instrument}/export?tf=${tf}`, '_blank');
  }, [instrument, tf]);

  const handleExplain = useCallback(async () => {
    if (!bars.length) return;
    setExplaining(true);
    try {
      const last = bars[bars.length - 1];
      const direction = last.close >= last.open ? 'up' : 'down';
      const magnitude = Math.abs((last.close - last.open) / last.open * 100);
      const timestamp = new Date(last.t).getTime();
      const result = await api.explainMove({ instrument, timestamp, timeframe: tf, direction, magnitude });
      setExplainData(result);
    } catch {
      setExplainData(null);
    } finally {
      setExplaining(false);
    }
  }, [bars, instrument, tf]);

  const freshLabel = data?.freshness
    ? `OANDA · ${freshnessAge(data.freshness.last_ok)}`
    : 'OANDA';

  const freshKind = data?.freshness?.status === 'ok' ? 'ok' as const
    : data?.freshness?.status === 'error' ? 'err' as const
    : 'muted' as const;

  const dp = instrument === 'XAUUSD' ? 2 : 1;
  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : null;
  const prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;
  const liveDelta = lastClose != null && prevClose != null ? lastClose - prevClose : null;

  return (
    <Panel
      title={`${instrument} · Price`}
      tag={`${data?.count ?? 0} bars`}
      span={8}
      className={fullscreen ? 'sig-panel-fs' : ''}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {livePrice != null && (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <TickerCell value={livePrice} dp={dp} colorize={false} />
              <TickerCell value={liveDelta} dp={dp} signed colorize />
            </span>
          )}
          <StatusBadge kind={freshKind} label={freshLabel} />
          <button
            className="sig-tab"
            onClick={handleExplain}
            disabled={explaining || !bars.length}
            title="Explain last candle move"
            style={{ fontSize: '0.6rem', opacity: explaining ? 0.5 : 1 }}
          >
            {explaining ? '…' : 'WHY?'}
          </button>
          <button className="sig-tab" onClick={handleExport} title="CSV Export">
            CSV
          </button>
          <button className="sig-tab" onClick={reload} title="Refresh">
            ⟳
          </button>
          {drawableLevels.length > 0 && (
            <LevelsMenu
              levels={drawableLevels}
              hidden={hiddenLevels}
              onToggle={toggleLevel}
              onSetAll={setAllLevels}
            />
          )}
          <button
            className={`sig-tab${showKZ ? ' is-active' : ''}`}
            onClick={() => setShowKZ((v) => !v)}
            title="Shade London / NY kill zones"
            style={{ fontSize: '0.6rem', color: showKZ ? 'var(--sig-amber)' : undefined }}
          >
            KZ
          </button>
          <button
            className={`sig-tab${freezeView ? ' is-active' : ''}`}
            onClick={() => setFreezeView((v) => !v)}
            title={
              freezeView
                ? 'View frozen — pan/zoom freely; price still updates. Click to unlock & re-center.'
                : 'Freeze view so panning/zooming stays put when price updates'
            }
            style={{ fontSize: '0.6rem', color: freezeView ? 'var(--sig-amber)' : undefined }}
          >
            {freezeView ? '🔒 VIEW' : '🔓 VIEW'}
          </button>
          <button
            className="sig-tab"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
          >
            {fullscreen ? '⤢' : '⛶'}
          </button>
        </div>
      }
    >
      {/* TF switcher */}
      <div className="sig-tf-bar">
        {TIMEFRAMES.filter((t) => t !== 'S5' || S5_INSTRUMENTS.has(instrument)).map((t) => (
          <button
            key={t}
            className={`sig-tf-btn${t === tf ? ' is-active' : ''}`}
            onClick={() => setTf(t)}
          >
            {TF_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Chart */}
      {loading && !bars.length && (
        <div className="sig-ph">Loading {instrument} {tf}…</div>
      )}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          {error}
        </div>
      )}
      {bars.length > 0 && (
        <div className={`sig-chart-wrap${fullscreen ? ' sig-chart-wrap-fs' : ''}`}>
          {/* Remount per instrument so the price scale auto-fits the new symbol
              instead of staying pinned to the previous symbol's price range.
              height=0 → the chart fills the wrapper (autoSize) in fullscreen. */}
          <CandleChart key={instrument} bars={bars} height={fullscreen ? 0 : 340} markers={chartMarkers} priceLines={priceLines} showKillZones={showKZ} freezeView={freezeView} />
        </div>
      )}
      {!loading && !error && bars.length === 0 && (
        <div className="sig-ph">
          No data — click ⟳ or wait for OANDA ingest
        </div>
      )}

      {/* Explain-this-move panel */}
      {explaining && (
        <div className="sig-ph" style={{ marginTop: '0.5rem', borderTop: '1px solid var(--sig-border)', paddingTop: '0.5rem' }}>
          Analyzing move…
        </div>
      )}
      {explainData && !explaining && (
        <ExplainPanel data={explainData} onClose={() => setExplainData(null)} />
      )}
    </Panel>
  );
}
