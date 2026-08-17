import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { Panel, StatusBadge } from '../terminal';
import type { EdgeAnalytics, EdgeBucket } from '../../../types';
import '../terminal/terminal.css';

const DIM_LABELS: Record<string, string> = {
  regime: 'Risk Regime',
  driver_composite: 'Driver Composite',
  vol_regime: 'Vol Regime',
  session: 'Session',
  dow: 'Day of Week',
  event_proximity: 'Event Proximity',
};

function WinBar({ winRate }: { winRate: number }) {
  const color = winRate > 55 ? 'var(--sig-green, #00ff88)' : winRate < 45 ? 'var(--sig-red, #ff4444)' : 'var(--sig-amber, #ffbb00)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
        <div style={{ width: `${Math.min(winRate, 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span className="sig-num" style={{ color, fontSize: 11 }}>{winRate}%</span>
    </div>
  );
}

function DimensionTable({ name, buckets }: { name: string; buckets: EdgeBucket[] }) {
  return (
    <div className="sig-panel" style={{ gridColumn: 'span 6' }}>
      <header className="sig-panel-hd"><span>{DIM_LABELS[name] || name}</span></header>
      <div className="sig-panel-bd">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 60px 60px 70px', gap: '2px 8px', fontSize: 11 }}>
          <span className="sig-muted" style={{ fontWeight: 600 }}>Bucket</span>
          <span className="sig-muted" style={{ fontWeight: 600 }}>N</span>
          <span className="sig-muted" style={{ fontWeight: 600 }}>Win%</span>
          <span className="sig-muted" style={{ fontWeight: 600 }}>Avg R</span>
          <span className="sig-muted" style={{ fontWeight: 600 }}>Expect</span>
          <span className="sig-muted" style={{ fontWeight: 600 }}>Avg P&L</span>
          {buckets.map(b => (
            <div key={b.bucket} style={{ display: 'contents' }}>
              <span className="sig-num">{b.bucket.replace(/_/g, ' ')}</span>
              <span className="sig-num sig-muted">{b.trades_n}</span>
              <WinBar winRate={b.win_rate} />
              <span className={`sig-num ${b.avg_r != null ? (b.avg_r > 0 ? 'sig-up' : b.avg_r < 0 ? 'sig-down' : '') : 'sig-muted'}`}>
                {b.avg_r != null ? b.avg_r.toFixed(2) : '—'}
              </span>
              <span className={`sig-num ${b.expectancy != null ? (b.expectancy > 0 ? 'sig-up' : b.expectancy < 0 ? 'sig-down' : '') : 'sig-muted'}`}>
                {b.expectancy != null ? b.expectancy.toFixed(2) : '—'}
              </span>
              <span className={`sig-num ${b.avg_pnl > 0 ? 'sig-up' : b.avg_pnl < 0 ? 'sig-down' : ''}`}>
                ${b.avg_pnl.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EdgePanel({ instrument }: { instrument: string }) {
  const { data, loading, error } = useApi<EdgeAnalytics>(
    () => api.getEdge(instrument),
    [instrument]
  );

  if (loading) return <Panel title="EDGE ANALYTICS" span={12}><div className="sig-muted">Loading…</div></Panel>;
  if (error) return <Panel title="EDGE ANALYTICS" span={12}><div className="sig-muted">Error: {error}</div></Panel>;
  if (!data || !Object.keys(data.dimensions).length) {
    return (
      <Panel title="EDGE ANALYTICS" span={12}>
        <div className="sig-muted">
          {data?.total_trades === 0
            ? 'No closed trades found. Import trades and capture snapshots to see edge analytics.'
            : `${data?.total_trades ?? 0} trades found but not enough per bucket (minimum 5). Keep trading and capturing snapshots.`}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="EDGE ANALYTICS" tag={`${data.total_trades} trades`} span={12}>
      {data.best_edge && (
        <div className="flex items-center gap-2 mb-3">
          <StatusBadge kind="ok" label="BEST EDGE" />
          <span className="sig-num sig-up">
            {DIM_LABELS[data.best_edge.dimension] || data.best_edge.dimension}: {data.best_edge.bucket.replace(/_/g, ' ')}
          </span>
          <span className="sig-muted">expectancy {data.best_edge.expectancy.toFixed(2)}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 8 }}>
        {Object.entries(data.dimensions).map(([dim, buckets]) => (
          <DimensionTable key={dim} name={dim} buckets={buckets} />
        ))}
      </div>
    </Panel>
  );
}
