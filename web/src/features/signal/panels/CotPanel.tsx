import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { CotResponse } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';
import { TickerCell } from '../terminal';

function PercentileBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct > 80 ? 'var(--sig-red)' : pct < 20 ? 'var(--sig-green)' : 'var(--sig-amber)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--sig-bg-2)', borderRadius: 2, position: 'relative', minWidth: 60 }}>
        <div style={{
          position: 'absolute', left: `${pct}%`, top: -1, width: 4, height: 10,
          borderRadius: 1, background: color, transform: 'translateX(-2px)',
        }} />
        {/* 10/90 extreme markers */}
        <div style={{ position: 'absolute', left: '10%', top: 0, width: 1, height: 8, background: 'var(--sig-border-2)' }} />
        <div style={{ position: 'absolute', left: '90%', top: 0, width: 1, height: 8, background: 'var(--sig-border-2)' }} />
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 10, color, minWidth: 30, textAlign: 'right' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function NetChart({ history }: { history: CotResponse['history'] }) {
  const W = 280, H = 50;
  if (history.length < 3) return null;

  const nets = history.map(r => r.mm_long - r.mm_short);
  const max = Math.max(...nets.map(Math.abs), 1);

  const midY = H / 2;
  const points = nets.map((n, i) => {
    const x = (i / (nets.length - 1)) * W;
    const y = midY - (n / max) * (H / 2 - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const fillPoints = [`0,${midY}`, ...points, `${W},${midY}`];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 4 }}>
      <line x1={0} x2={W} y1={midY} y2={midY} stroke="var(--sig-border-2)" strokeWidth={0.5} />
      <polygon points={fillPoints.join(' ')} fill="var(--sig-cyan)" opacity={0.1} />
      <polyline points={points.join(' ')} fill="none" stroke="var(--sig-cyan)" strokeWidth={1.2} />
    </svg>
  );
}

export default function CotPanel() {
  const { data, loading, error, reload } = useApi<CotResponse>(
    () => api.getCot(),
    []
  );

  return (
    <Panel
      title="COT Positioning"
      tag="CFTC · GOLD"
      span={4}
      right={
        <>
          {data?.current.extreme && <StatusBadge kind="warn" label="EXTREME" />}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </>
      }
    >
      {loading && <div className="sig-ph">Loading COT data…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No COT data — run POST /ingest/cftc
        </div>
      )}
      {data && (
        <>
          <DataRow
            label="Net MM"
            value={
              <TickerCell
                value={data.current.mmNet}
                dp={0}
              />
            }
          />
          <DataRow
            label="% Long"
            value={<span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.current.pctLong.toFixed(1)}%</span>}
          />
          <DataRow
            label="WoW Δ"
            value={
              <TickerCell
                value={data.current.wowChange}
                dp={0}
              />
            }
          />
          <div className="sig-section-label" style={{ marginTop: 4 }}>Percentile (1Y)</div>
          <PercentileBar value={data.current.percentile1y} />
          <NetChart history={data.history} />
        </>
      )}
    </Panel>
  );
}
