import { useState } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { DataRow, StatusBadge } from '../terminal';
import DebriefPanel from './DebriefPanel';
import type {
  ContextSnapshotResponse,
  ContextSnapshotPayload,
} from '../../../types';
import '../terminal/terminal.css';

const SIGNAL_COLOR: Record<string, string> = {
  bullish: 'sig-up',
  bearish: 'sig-down',
  neutral: 'sig-muted',
  tailwind: 'sig-up',
  headwind: 'sig-down',
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null) return '—';
  return n.toFixed(d);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sig-panel" style={{ gridColumn: 'span 4' }}>
      <header className="sig-panel-hd"><span>{title}</span></header>
      <div className="sig-panel-bd">{children}</div>
    </div>
  );
}

function RegimeSection({ regime }: { regime: ContextSnapshotPayload['regime'] }) {
  if (!regime) return <Section title="REGIME"><div className="sig-muted">No data</div></Section>;
  const kind = regime.label === 'risk-on' ? 'ok' : regime.label === 'neutral' ? 'muted' : 'err';
  return (
    <Section title="REGIME">
      <div className="flex items-center gap-2 mb-2">
        <StatusBadge kind={kind} label={regime.label.toUpperCase()} />
        <span className="sig-num sig-muted">score {regime.score}</span>
      </div>
      {regime.factors.map(f => (
        <DataRow key={f.name} label={f.name} value={fmt(f.value)} dir={f.signal === 'bullish' ? 'up' : f.signal === 'bearish' ? 'down' : 'flat'} />
      ))}
    </Section>
  );
}

function RatesSection({ rates }: { rates: ContextSnapshotPayload['rates'] }) {
  if (!rates) return null;
  const keys = ['DGS2', 'DGS10', 'DGS30', 'DFII5', 'DFII10', 'T10YIE', 'T5YIE', 'DTWEXBGS', 'FEDFUNDS', 'BAMLH0A0HYM2', 'spread_2s10s'];
  const labels: Record<string, string> = {
    DGS2: '2Y', DGS10: '10Y', DGS30: '30Y', DFII5: 'Real 5Y', DFII10: 'Real 10Y',
    T10YIE: 'BEI 10Y', T5YIE: 'BEI 5Y', DTWEXBGS: 'DXY', FEDFUNDS: 'Fed Funds',
    BAMLH0A0HYM2: 'HY Spread', spread_2s10s: '2s10s',
  };
  return (
    <Section title="RATES">
      {keys.filter(k => rates[k] != null).map(k => (
        <DataRow key={k} label={labels[k] || k} value={fmt(rates[k])} />
      ))}
    </Section>
  );
}

function DriversSection({ drivers }: { drivers: ContextSnapshotPayload['drivers'] }) {
  if (!drivers) return null;
  return (
    <Section title="DRIVERS">
      <div className="flex items-center gap-2 mb-2">
        <StatusBadge kind={drivers.composite.label === 'tailwind' ? 'ok' : drivers.composite.label === 'headwind' ? 'err' : 'muted'} label={drivers.composite.label.toUpperCase()} />
        <span className="sig-num sig-muted">{fmt(drivers.composite.score)}</span>
      </div>
      {drivers.items.map(d => (
        <div key={d.id} className="sig-row">
          <span className="sig-row-label">{d.name || d.id}</span>
          <span className="sig-num sig-muted" style={{ minWidth: 48 }}>z {fmt(d.zScore)}</span>
          <span className={`sig-num ${SIGNAL_COLOR[d.signal] || ''}`} style={{ minWidth: 48 }}>{d.signal}</span>
          <span className="sig-num sig-muted" style={{ minWidth: 48 }}>ρ {fmt(d.correlation)}</span>
        </div>
      ))}
    </Section>
  );
}

function VolSection({ vol }: { vol: ContextSnapshotPayload['vol'] }) {
  if (!vol) return null;
  return (
    <Section title="VOLATILITY">
      <DataRow label="VIX" value={fmt(vol.vix)} />
      <DataRow label="VXN" value={fmt(vol.vxn)} />
      <DataRow label="GVZ" value={fmt(vol.gvz)} />
      <DataRow label="Instrument IV" value={fmt(vol.instrument_iv)} />
      <DataRow label="60d Pctl" value={vol.percentile_60d != null ? `${vol.percentile_60d}%` : '—'} />
      <DataRow label="Exp Move 1d" value={fmt(vol.expected_move_1d)} />
    </Section>
  );
}

function PositioningSection({ positioning }: { positioning: ContextSnapshotPayload['positioning'] }) {
  if (!positioning) return null;
  return (
    <Section title="POSITIONING">
      <DataRow label="COT Net MM" value={positioning.cot_net_mm?.toLocaleString() ?? '—'} />
      <DataRow label="% Long" value={fmt(positioning.cot_pct_long, 1)} />
      <DataRow label="WoW Δ" value={positioning.cot_wow_delta?.toLocaleString() ?? '—'} dir={positioning.cot_wow_delta != null ? (positioning.cot_wow_delta > 0 ? 'up' : positioning.cot_wow_delta < 0 ? 'down' : 'flat') : undefined} />
      <DataRow label="1Y Pctl" value={positioning.cot_percentile_1y != null ? `${positioning.cot_percentile_1y}%` : '—'} />
      <DataRow label="ETF Tonnes" value={fmt(positioning.etf_tonnes, 1)} />
      <DataRow label="ETF Δ" value={fmt(positioning.etf_daily_delta, 1)} dir={positioning.etf_daily_delta != null ? (positioning.etf_daily_delta > 0 ? 'up' : positioning.etf_daily_delta < 0 ? 'down' : 'flat') : undefined} />
      <DataRow label="ETF Trend" value={positioning.etf_trend ?? '—'} />
    </Section>
  );
}

function EventsSection({ events }: { events: ContextSnapshotPayload['upcoming_events'] }) {
  if (!events || !events.length) return null;
  return (
    <Section title="UPCOMING EVENTS">
      {events.map((e, i) => (
        <div key={i} className="sig-row">
          <span className="sig-row-label" style={{ flex: 1 }}>{e.name}</span>
          <span className="sig-num sig-muted">{new Date(e.ts).toISOString().slice(5, 16).replace('T', ' ')}</span>
          <span className={`sig-badge sig-badge--${e.impact === 'high' ? 'err' : e.impact === 'medium' ? 'warn' : 'muted'}`} style={{ marginLeft: 8 }}>{e.impact}</span>
        </div>
      ))}
    </Section>
  );
}

function NewsSection({ news }: { news: ContextSnapshotPayload['recent_news'] }) {
  if (!news || !news.length) return null;
  return (
    <Section title="RECENT NEWS">
      {news.map((n, i) => (
        <div key={i} className="sig-row" style={{ alignItems: 'flex-start' }}>
          <span className={`sig-num ${n.sentiment != null ? (n.sentiment > 0.1 ? 'sig-up' : n.sentiment < -0.1 ? 'sig-down' : 'sig-muted') : 'sig-muted'}`} style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'currentColor', marginTop: 6, marginRight: 6, flexShrink: 0 }} />
          <span className="sig-row-label" style={{ flex: 1, whiteSpace: 'normal' }}>{n.headline}</span>
          <span className="sig-num sig-muted" style={{ flexShrink: 0, marginLeft: 8 }}>{n.source}</span>
        </div>
      ))}
    </Section>
  );
}

function LevelsSection({ levels, entryPrice }: { levels: ContextSnapshotPayload['key_levels']; entryPrice?: number }) {
  if (!levels) return null;
  return (
    <Section title="KEY LEVELS">
      {levels.above.map((l, i) => (
        <DataRow key={`a${i}`} label={l.label} value={fmt(l.price)} dir="up" />
      ))}
      {entryPrice != null && <DataRow label="» ENTRY" value={fmt(entryPrice)} />}
      {levels.below.map((l, i) => (
        <DataRow key={`b${i}`} label={l.label} value={fmt(l.price)} dir="down" />
      ))}
    </Section>
  );
}

function CorrelationsSection({ correlations }: { correlations: ContextSnapshotPayload['correlations'] }) {
  if (!correlations || !Object.keys(correlations.pairs).length) return null;
  return (
    <Section title={`CORRELATIONS (${correlations.window}d)`}>
      {Object.entries(correlations.pairs).map(([pair, corr]) => (
        <DataRow key={pair} label={pair.replace('_', ' / ')} value={fmt(corr, 3)} dir={corr > 0.3 ? 'up' : corr < -0.3 ? 'down' : 'flat'} />
      ))}
    </Section>
  );
}

function SeasonalitySection({ seasonality }: { seasonality: ContextSnapshotPayload['seasonality'] }) {
  if (!seasonality) return null;
  return (
    <Section title="SEASONALITY">
      {seasonality.month && (
        <>
          <DataRow label={`${seasonality.month.name} Avg`} value={`${fmt(seasonality.month.avg_return)}%`} dir={seasonality.month.avg_return > 0 ? 'up' : seasonality.month.avg_return < 0 ? 'down' : 'flat'} />
          <DataRow label={`${seasonality.month.name} Win%`} value={`${seasonality.month.win_rate}%`} />
        </>
      )}
      {seasonality.dow && (
        <>
          <DataRow label={`${seasonality.dow.name} Avg`} value={`${fmt(seasonality.dow.avg_return)}%`} dir={seasonality.dow.avg_return > 0 ? 'up' : seasonality.dow.avg_return < 0 ? 'down' : 'flat'} />
          <DataRow label={`${seasonality.dow.name} Win%`} value={`${seasonality.dow.win_rate}%`} />
        </>
      )}
    </Section>
  );
}

function SnapshotView({ snapshot, entryPrice }: { snapshot: ContextSnapshotResponse; entryPrice?: number }) {
  const p = snapshot.payload;
  return (
    <div className="sig" style={{ padding: 0 }}>
      {/* Header bar */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <StatusBadge kind="warn" label="SNAPSHOT" />
        <span className="sig-num sig-amber">{p.instrument}</span>
        {p.price && <span className="sig-num">{fmt(p.price.last)}</span>}
        <span className="sig-muted text-xs">
          {new Date(snapshot.ts).toISOString().slice(0, 16).replace('T', ' ')} UTC
        </span>
      </div>

      {/* Grid of sections */}
      <div className="sig-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
        {p.price && (
          <Section title="PRICE">
            <DataRow label="Last" value={fmt(p.price.last)} />
            <DataRow label="Open" value={fmt(p.price.daily_open)} />
            <DataRow label="High" value={fmt(p.price.daily_high)} />
            <DataRow label="Low" value={fmt(p.price.daily_low)} />
            <DataRow label="Prev Close" value={fmt(p.price.prev_close)} />
          </Section>
        )}
        <RegimeSection regime={p.regime} />
        <RatesSection rates={p.rates} />
        <DriversSection drivers={p.drivers} />
        <VolSection vol={p.vol} />
        <PositioningSection positioning={p.positioning} />
        <EventsSection events={p.upcoming_events} />
        <NewsSection news={p.recent_news} />
        <LevelsSection levels={p.key_levels} entryPrice={entryPrice} />
        <CorrelationsSection correlations={p.correlations} />
        <SeasonalitySection seasonality={p.seasonality} />
      </div>
    </div>
  );
}

export default function ContextTab({ tradeId, instrument, entryPrice }: {
  tradeId: number;
  instrument: string;
  entryPrice?: number;
}) {
  const { data, loading, error, reload } = useApi<ContextSnapshotResponse>(
    () => api.getSnapshot(tradeId),
    [tradeId]
  );
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      await api.captureSnapshot(tradeId, instrument);
      reload();
    } finally {
      setCapturing(false);
    }
  };

  if (loading) return <div className="card p-5 text-slate-400">Loading market context…</div>;

  if (error || !data) {
    return (
      <div className="card p-5">
        <p className="text-slate-400 mb-3">No market context snapshot found for this trade.</p>
        <button className="btn btn-primary" onClick={handleCapture} disabled={capturing}>
          {capturing ? 'Capturing…' : 'Capture Now'}
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <SnapshotView snapshot={data} entryPrice={entryPrice} />
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 16 }}>
        <DebriefPanel tradeId={tradeId} />
      </div>
    </div>
  );
}
