import { useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RegressionResponse } from '../../../types';
import { Panel, DataRow } from '../terminal';

const VS_OPTIONS = ['DGS10', 'DFII10', 'DTWEXBGS', 'VIX', 'GVZ', 'BAMLH0A0HYM2'] as const;

function ScatterPlot({ scatter, beta, intercept }: {
  scatter: { x: number; y: number }[];
  beta: number;
  intercept: number;
}) {
  const W = 280, H = 140, PAD = 20;
  if (scatter.length < 5) return null;

  const xs = scatter.map(p => p.x);
  const ys = scatter.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = xMax - xMin || 0.01;
  const yRange = yMax - yMin || 0.01;

  const toX = (v: number) => PAD + ((v - xMin) / xRange) * (W - 2 * PAD);
  const toY = (v: number) => H - PAD - ((v - yMin) / yRange) * (H - 2 * PAD);

  const lineX1 = xMin, lineY1 = beta * xMin + intercept;
  const lineX2 = xMax, lineY2 = beta * xMax + intercept;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 6 }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--sig-border)" strokeWidth={0.5} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--sig-border)" strokeWidth={0.5} />
      <line
        x1={toX(lineX1)} y1={toY(lineY1)}
        x2={toX(lineX2)} y2={toY(lineY2)}
        stroke="var(--sig-amber)" strokeWidth={1.5} strokeDasharray="4,2"
      />
      {scatter.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.x)} cy={toY(p.y)}
          r={2} fill="var(--sig-cyan)" opacity={0.6}
        />
      ))}
      <text x={W / 2} y={H - 2} textAnchor="middle" fill="var(--sig-muted)" fontSize={8}>daily return (vs)</text>
      <text x={4} y={H / 2} textAnchor="middle" fill="var(--sig-muted)" fontSize={8}
        transform={`rotate(-90, 4, ${H / 2})`}>instrument return</text>
    </svg>
  );
}

export default function RegressionPanel() {
  const [instrument, setInstrument] = useState('XAUUSD');
  const [vs, setVs] = useState('DFII10');
  const [window] = useState(60);

  const fetcher = useCallback(
    () => api.getRegression(instrument, vs, window),
    [instrument, vs, window]
  );
  const { data, loading, error, reload } = useApi<RegressionResponse>(fetcher, [instrument, vs, window]);

  return (
    <Panel
      title="Regression"
      tag={`${instrument} vs ${vs}`}
      span={6}
      right={
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            className="sig-tz-select"
            value={instrument}
            onChange={e => setInstrument(e.target.value)}
            style={{ fontSize: 10 }}
          >
            <option value="XAUUSD">XAUUSD</option>
            <option value="US100">US100</option>
            <option value="XAGUSD">XAGUSD</option>
          </select>
          <span style={{ color: 'var(--sig-muted)', fontSize: 10 }}>vs</span>
          <select
            className="sig-tz-select"
            value={vs}
            onChange={e => setVs(e.target.value)}
            style={{ fontSize: 10 }}
          >
            {VS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      {loading && <div className="sig-ph">Computing regression…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>Failed to load</div>}
      {data && !data.error && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <DataRow label="β (Beta)" value={
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--sig-amber)' }}>
                {data.beta.toFixed(3)}
              </span>
            } />
            <DataRow label="R²" value={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.r2 != null ? data.r2.toFixed(3) : 'n/a'}
              </span>
            } />
            <DataRow label="Corr" value={
              <span style={{
                fontVariantNumeric: 'tabular-nums',
                color: data.correlation != null
                  ? data.correlation > 0.5 ? 'var(--sig-green)' : data.correlation < -0.5 ? 'var(--sig-red)' : 'var(--sig-text)'
                  : 'var(--sig-muted)',
              }}>
                {data.correlation != null ? data.correlation.toFixed(3) : 'n/a'}
              </span>
            } />
            <DataRow label="n" value={<span style={{ color: 'var(--sig-muted)', fontSize: 10 }}>{data.n}</span>} />
          </div>
          <ScatterPlot scatter={data.scatter} beta={data.beta} intercept={data.intercept} />
        </>
      )}
      {data?.error && (
        <div className="sig-ph" style={{ color: 'var(--sig-amber)' }}>{data.error} (n={data.n})</div>
      )}
    </Panel>
  );
}
