import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RatesResponse } from '../../../types';
import { Panel, DataRow, TickerCell } from '../terminal';

const SECTIONS = [
  { label: 'Nominal Yields', ids: ['DGS3MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS30'] },
  { label: 'Real Yields', ids: ['DFII5', 'DFII10'] },
  { label: 'Breakevens', ids: ['T5YIE', 'T10YIE'] },
  { label: 'Spreads', ids: ['T10Y2Y', 'BAMLH0A0HYM2'] },
  { label: 'Policy / FX', ids: ['FEDFUNDS', 'DTWEXBGS'] },
];

const SHORT_NAMES: Record<string, string> = {
  DGS3MO: '3M', DGS1: '1Y', DGS2: '2Y', DGS5: '5Y', DGS10: '10Y', DGS30: '30Y',
  DFII5: '5Y TIPS', DFII10: '10Y TIPS',
  T5YIE: '5Y BE', T10YIE: '10Y BE',
  T10Y2Y: '2s10s', BAMLH0A0HYM2: 'HY OAS',
  FEDFUNDS: 'Fed Funds', DTWEXBGS: 'DXY (Broad)',
};

export default function RatesBoard() {
  const { data, loading, error, reload } = useApi<RatesResponse>(
    () => api.getRates(),
    []
  );

  return (
    <Panel
      title="Rates Board"
      tag="BTMM"
      span={6}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading rates…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No rate data — run FRED ingest
        </div>
      )}
      {data && (
        <>
          {SECTIONS.map((sec) => (
            <div key={sec.label}>
              <div className="sig-section-label">{sec.label}</div>
              {sec.ids.map((id) => {
                const r = data.board[id];
                if (!r || r.value == null) return null;
                return (
                  <DataRow
                    key={id}
                    label={SHORT_NAMES[id] || id}
                    value={
                      <span>
                        <TickerCell value={r.value} dp={3} suffix={r.unit === 'percent' ? '%' : ''} colorize={false} />
                        {r.change != null && (
                          <span style={{ marginLeft: 6 }}>
                            <TickerCell value={r.change} dp={3} signed colorize />
                          </span>
                        )}
                      </span>
                    }
                    dir={r.change != null ? (r.change > 0 ? 'up' : r.change < 0 ? 'down' : 'flat') : undefined}
                  />
                );
              })}
            </div>
          ))}

          {/* yield curve mini chart */}
          {data.yieldCurve.some((p) => p.yield != null) && (
            <div style={{ marginTop: '8px' }}>
              <div className="sig-section-label">Yield Curve</div>
              <YieldCurveChart points={data.yieldCurve} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function YieldCurveChart({ points }: { points: { tenor: string; yield: number | null }[] }) {
  const vals = points.map((p) => p.yield).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = max - min || 0.1;
  const h = 50;
  const w = 200;
  const step = w / (points.length - 1);

  const polyPoints = points
    .map((p, i) => {
      if (p.yield == null) return null;
      const x = i * step;
      const y = h - ((p.yield - min) / range) * (h - 10) - 5;
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(' ');

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h + 14}`} style={{ width: '100%', height: `${h + 14}px` }}>
        <polyline fill="none" stroke="var(--sig-amber)" strokeWidth="2" points={polyPoints} />
        {points.map((p, i) => (
          <text
            key={i}
            x={i * step}
            y={h + 12}
            textAnchor="middle"
            fill="var(--sig-muted)"
            fontSize="7"
          >
            {p.tenor}
          </text>
        ))}
        {points.map((p, i) => {
          if (p.yield == null) return null;
          const x = i * step;
          const y = h - ((p.yield - min) / range) * (h - 10) - 5;
          return (
            <circle key={`d-${i}`} cx={x} cy={y} r="2.5" fill="var(--sig-amber)" />
          );
        })}
      </svg>
    </div>
  );
}
