import { useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { CompareResponse } from '../../../types';
import { Panel } from '../terminal';

const SERIES_PALETTE: Record<string, string> = {
  XAUUSD: 'var(--sig-amber)',
  US100: 'var(--sig-cyan)',
  XAGUSD: '#888',
  WTICO_USD: '#a67c52',
  DGS10: '#6a9fb5',
  DFII10: '#7e57c2',
  DTWEXBGS: '#43a047',
  VIX: 'var(--sig-red)',
  GVZ: '#ef6c00',
};

const AVAILABLE = ['XAUUSD', 'US100', 'XAGUSD', 'DGS10', 'DFII10', 'DTWEXBGS', 'VIX', 'GVZ'] as const;

function CompareChart({ data, series }: { data: CompareResponse; series: string[] }) {
  const W = 340, H = 120, PAD = 24;
  if (!data.data.length) return null;

  const allVals = data.data.flatMap(p => series.map(s => p.values[s] ?? 0));
  const min = Math.min(...allVals, 0);
  const max = Math.max(...allVals, 0);
  const range = max - min || 1;

  const toX = (i: number) => PAD + (i / (data.data.length - 1)) * (W - 2 * PAD);
  const toY = (v: number) => H - PAD - ((v - min) / range) * (H - 2 * PAD);

  const zeroY = toY(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 6 }}>
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--sig-border)" strokeWidth={0.5} strokeDasharray="3,3" />
      {series.map(s => {
        const points = data.data.map((p, i) => `${toX(i).toFixed(1)},${toY(p.values[s] ?? 0).toFixed(1)}`);
        return (
          <polyline
            key={s}
            points={points.join(' ')}
            fill="none"
            stroke={SERIES_PALETTE[s] || 'var(--sig-text)'}
            strokeWidth={1.2}
          />
        );
      })}
      <text x={PAD + 4} y={12} fill="var(--sig-muted)" fontSize={8}>
        {data.mode === 'zscore' ? 'z-score' : '% change'}
      </text>
    </svg>
  );
}

export default function ComparePanel() {
  const [selected, setSelected] = useState<string[]>(['XAUUSD', 'US100', 'DGS10']);
  const [mode, setMode] = useState<'zscore' | 'pctChange'>('zscore');
  const [window] = useState(60);

  const toggle = (s: string) => {
    setSelected(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const fetcher = useCallback(
    () => api.getCompare(selected, window, mode),
    [selected, window, mode]
  );
  const { data, loading, error, reload } = useApi<CompareResponse>(fetcher, [selected, window, mode]);

  return (
    <Panel
      title="Normalized Compare"
      tag={`${window}d · ${mode === 'zscore' ? 'Z' : '%Δ'}`}
      span={6}
      right={
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className={`sig-tf-btn${mode === 'zscore' ? ' is-active' : ''}`}
            onClick={() => setMode('zscore')}
          >Z</button>
          <button
            className={`sig-tf-btn${mode === 'pctChange' ? ' is-active' : ''}`}
            onClick={() => setMode('pctChange')}
          >%Δ</button>
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        {AVAILABLE.map(s => (
          <button
            key={s}
            className={`sig-tf-btn${selected.includes(s) ? ' is-active' : ''}`}
            onClick={() => toggle(s)}
            style={{
              fontSize: 9,
              borderColor: selected.includes(s) ? (SERIES_PALETTE[s] || 'var(--sig-cyan)') : undefined,
              color: selected.includes(s) ? (SERIES_PALETTE[s] || 'var(--sig-cyan)') : undefined,
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {loading && <div className="sig-ph">Loading…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>Failed to load</div>}
      {data && selected.length >= 2 && (
        <>
          <CompareChart data={data} series={selected} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 9 }}>
            {selected.map(s => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{
                  width: 10, height: 3,
                  background: SERIES_PALETTE[s] || 'var(--sig-text)',
                  display: 'inline-block', borderRadius: 1,
                }} />
                <span style={{ color: 'var(--sig-muted)' }}>{s}</span>
              </span>
            ))}
          </div>
        </>
      )}
      {selected.length < 2 && <div className="sig-ph">Select at least 2 series</div>}
    </Panel>
  );
}
