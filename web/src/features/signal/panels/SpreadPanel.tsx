import { useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { SpreadResponse } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';

const INSTRUMENTS = ['XAUUSD', 'US100', 'XAGUSD', 'WTICO_USD', 'DGS10', 'DFII10', 'VIX'] as const;

function SpreadChart({ data }: { data: SpreadResponse }) {
  const W = 300, H = 100, PAD = 16;
  const vals = data.data.map(p => p.value).filter((v): v is number => v != null);
  if (vals.length < 3) return null;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const toX = (i: number) => PAD + (i / (vals.length - 1)) * (W - 2 * PAD);
  const toY = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);

  const points = vals.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`);
  const meanY = toY(data.mean);
  const plus1Y = toY(data.mean + data.stddev);
  const minus1Y = toY(data.mean - data.stddev);
  const plus2Y = toY(data.mean + 2 * data.stddev);
  const minus2Y = toY(data.mean - 2 * data.stddev);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 6 }}>
      {/* ±2σ band */}
      <rect x={PAD} y={Math.min(plus2Y, minus2Y)} width={W - 2 * PAD}
        height={Math.abs(plus2Y - minus2Y)}
        fill="rgba(0,200,200,0.04)" />
      {/* ±1σ band */}
      <rect x={PAD} y={Math.min(plus1Y, minus1Y)} width={W - 2 * PAD}
        height={Math.abs(plus1Y - minus1Y)}
        fill="rgba(0,200,200,0.08)" />
      {/* Mean line */}
      <line x1={PAD} y1={meanY} x2={W - PAD} y2={meanY}
        stroke="var(--sig-muted)" strokeWidth={0.8} strokeDasharray="4,3" />
      {/* Spread line */}
      <polyline points={points.join(' ')} fill="none" stroke="var(--sig-amber)" strokeWidth={1.3} />
      {/* Labels */}
      <text x={W - PAD + 2} y={meanY + 3} fill="var(--sig-muted)" fontSize={7}>μ</text>
      <text x={W - PAD + 2} y={plus1Y + 3} fill="var(--sig-muted)" fontSize={6}>+1σ</text>
      <text x={W - PAD + 2} y={minus1Y + 3} fill="var(--sig-muted)" fontSize={6}>−1σ</text>
    </svg>
  );
}

export default function SpreadPanel() {
  const [longSym, setLongSym] = useState('XAUUSD');
  const [shortSym, setShortSym] = useState('XAGUSD');
  const [mode, setMode] = useState<'ratio' | 'difference'>('ratio');

  const fetcher = useCallback(
    () => api.getSpread(longSym, shortSym, mode),
    [longSym, shortSym, mode]
  );
  const { data, loading, error, reload } = useApi<SpreadResponse>(fetcher, [longSym, shortSym, mode]);

  const zBadge = data && !data.error
    ? Math.abs(data.zScore) > 2 ? 'err' : Math.abs(data.zScore) > 1 ? 'warn' : 'ok'
    : 'muted';

  return (
    <Panel
      title="Custom Spread"
      tag={`${longSym}/${shortSym}`}
      span={6}
      right={
        <div style={{ display: 'flex', gap: 2 }}>
          <button className={`sig-tf-btn${mode === 'ratio' ? ' is-active' : ''}`} onClick={() => setMode('ratio')}>Ratio</button>
          <button className={`sig-tf-btn${mode === 'difference' ? ' is-active' : ''}`} onClick={() => setMode('difference')}>Diff</button>
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <span style={{ color: 'var(--sig-muted)', fontSize: 10 }}>Long</span>
        <select className="sig-tz-select" value={longSym} onChange={e => setLongSym(e.target.value)} style={{ fontSize: 10 }}>
          {INSTRUMENTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ color: 'var(--sig-muted)', fontSize: 10 }}>Short</span>
        <select className="sig-tz-select" value={shortSym} onChange={e => setShortSym(e.target.value)} style={{ fontSize: 10 }}>
          {INSTRUMENTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && <div className="sig-ph">Computing spread…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>Failed to load</div>}
      {data && !data.error && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <DataRow label="Current" value={
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14 }}>
                {data.current.toFixed(mode === 'ratio' ? 2 : 1)}
              </span>
            } />
            <DataRow label="Mean" value={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.mean.toFixed(mode === 'ratio' ? 2 : 1)}
              </span>
            } />
            <DataRow label="Z-Score" value={
              <StatusBadge kind={zBadge as 'ok' | 'warn' | 'err' | 'muted'} label={data.zScore.toFixed(2)} />
            } />
            <DataRow label="Pctile" value={
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--sig-muted)' }}>
                {data.percentile.toFixed(0)}%
              </span>
            } />
          </div>
          <SpreadChart data={data} />
        </>
      )}
      {data?.error && (
        <div className="sig-ph" style={{ color: 'var(--sig-amber)' }}>{data.error}</div>
      )}
    </Panel>
  );
}
