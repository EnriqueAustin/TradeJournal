import { useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { CorrelationResponse } from '../../../types';
import { Panel } from '../terminal';

const WINDOWS = [20, 60, 120, 252] as const;
const REGIMES = ['ALL', 'risk-on', 'neutral', 'risk-off', 'crisis'] as const;

function corrColor(c: number | null): string {
  if (c == null) return 'var(--sig-muted)';
  if (c > 0.7) return 'var(--sig-green)';
  if (c > 0.3) return '#4a7a4a';
  if (c > -0.3) return 'var(--sig-muted)';
  if (c > -0.7) return '#7a4a4a';
  return 'var(--sig-red)';
}

function corrBg(c: number | null): string {
  if (c == null) return 'transparent';
  const abs = Math.abs(c);
  if (abs > 0.7) return c > 0 ? 'rgba(0,200,100,0.15)' : 'rgba(200,50,50,0.15)';
  if (abs > 0.3) return c > 0 ? 'rgba(0,200,100,0.07)' : 'rgba(200,50,50,0.07)';
  return 'transparent';
}

export default function CorrelationPanel() {
  const [window, setWindow] = useState<number>(60);
  const [regime, setRegime] = useState<string>('ALL');

  const fetcher = useCallback(() => {
    if (regime === 'ALL') return api.getCorrelation(window);
    return api.getRegimeCorrelation(window, regime);
  }, [window, regime]);
  const { data, loading, error, reload } = useApi<CorrelationResponse & { regime?: string; regimeDays?: number }>(
    fetcher, [window, regime]
  );

  return (
    <Panel
      title="Correlation Matrix"
      tag={regime === 'ALL' ? `${window}d window` : `${regime} · ${data?.regimeDays ?? '?'}d`}
      span={6}
      right={
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {WINDOWS.map(w => (
            <button
              key={w}
              className={`sig-tf-btn${w === window ? ' is-active' : ''}`}
              onClick={() => setWindow(w)}
            >
              {w}d
            </button>
          ))}
          <select
            className="sig-tz-select"
            value={regime}
            onChange={e => setRegime(e.target.value)}
            style={{ fontSize: 9, marginLeft: 4 }}
            title="Filter by risk regime"
          >
            {REGIMES.map(r => (
              <option key={r} value={r}>{r === 'ALL' ? 'All Regimes' : r.toUpperCase()}</option>
            ))}
          </select>
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      {loading && <div className="sig-ph">Computing correlations…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>Failed to load</div>}
      {data && data.labels.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="sig-table" style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '2px 6px', color: 'var(--sig-muted)' }}></th>
                {data.labels.map(l => (
                  <th key={l} style={{ padding: '2px 4px', color: 'var(--sig-cyan)', fontSize: 9, fontWeight: 400, whiteSpace: 'nowrap' }}>
                    {l.length > 6 ? l.slice(0, 6) : l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.labels.map((rowLabel, i) => (
                <tr key={rowLabel}>
                  <td style={{ padding: '2px 6px', color: 'var(--sig-cyan)', fontSize: 10, whiteSpace: 'nowrap' }}>
                    {rowLabel.length > 8 ? rowLabel.slice(0, 8) : rowLabel}
                  </td>
                  {data.matrix[i].map((c, j) => (
                    <td
                      key={j}
                      style={{
                        padding: '3px 4px',
                        textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        color: i === j ? 'var(--sig-muted)' : corrColor(c),
                        background: i === j ? 'transparent' : corrBg(c),
                        fontSize: 11,
                        fontWeight: c != null && Math.abs(c) > 0.7 ? 700 : 400,
                      }}
                    >
                      {i === j ? '—' : c != null ? c.toFixed(2) : 'n/a'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
