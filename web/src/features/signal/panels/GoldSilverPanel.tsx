import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { GoldSilverResponse } from '../../../types';
import { Panel, DataRow } from '../terminal';

function RangeBar({ value, low, high }: { value: number; low: number; high: number }) {
  const range = high - low || 1;
  const pct = Math.max(0, Math.min(100, ((value - low) / range) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginTop: 4 }}>
      <span style={{ color: 'var(--sig-muted)', minWidth: 30 }}>{low.toFixed(0)}</span>
      <div style={{ flex: 1, height: 8, background: 'var(--sig-bg-2)', borderRadius: 2, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: `${pct}%`, top: -2, width: 6, height: 12,
          borderRadius: 2, background: 'var(--sig-amber)', transform: 'translateX(-3px)',
        }} />
      </div>
      <span style={{ color: 'var(--sig-muted)', minWidth: 30, textAlign: 'right' }}>{high.toFixed(0)}</span>
    </div>
  );
}

function RatioChart({ history }: { history: { ts: number; ratio: number }[] }) {
  const W = 280, H = 50, PAD = 2;
  if (history.length < 3) return null;

  const vals = history.map(h => h.ratio);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - 2 * PAD);
    const y = PAD + (1 - (v - min) / range) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 4 }}>
      <polyline points={points.join(' ')} fill="none" stroke="var(--sig-cyan)" strokeWidth={1.2} />
    </svg>
  );
}

export default function GoldSilverPanel() {
  const { data, loading, error, reload } = useApi<GoldSilverResponse>(
    () => api.getGoldSilverRatio(),
    []
  );

  return (
    <Panel
      title="Gold / Silver Ratio"
      tag="XAU/XAG"
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
      }
    >
      {loading && <div className="sig-ph">Computing ratio…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No silver data — run OANDA ingest (includes XAG_USD)
        </div>
      )}
      {data && (
        <>
          <DataRow
            label="Ratio"
            value={
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14 }}>
                {data.ratio.toFixed(1)}
              </span>
            }
          />
          <DataRow
            label="1Y Avg"
            value={<span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.avg1y.toFixed(1)}</span>}
          />
          <DataRow
            label="Percentile"
            value={
              <span style={{
                fontVariantNumeric: 'tabular-nums',
                color: data.percentile1y > 80 ? 'var(--sig-red)' : data.percentile1y < 20 ? 'var(--sig-green)' : 'var(--sig-text)',
              }}>
                {data.percentile1y.toFixed(0)}%
              </span>
            }
          />
          <RangeBar value={data.ratio} low={data.low1y} high={data.high1y} />
          <RatioChart history={data.history} />
        </>
      )}
    </Panel>
  );
}
