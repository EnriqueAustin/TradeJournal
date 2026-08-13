import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { EconResponse, EconIndicator } from '../../../types';
import { Panel, TickerCell } from '../terminal';

const UNIT_FMT: Record<string, { dp: number; suffix: string }> = {
  percent: { dp: 1, suffix: '%' },
  index: { dp: 1, suffix: '' },
  thousands: { dp: 0, suffix: 'K' },
};

function fmt(ind: EconIndicator) {
  return UNIT_FMT[ind.unit] ?? { dp: 2, suffix: '' };
}

export default function EconTracker() {
  const { data, loading, error, reload } = useApi<EconResponse>(
    () => api.getEcon(),
    []
  );

  return (
    <Panel
      title="Economic Tracker"
      tag="ECST"
      span={6}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading econ data…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No econ data — run FRED ingest
        </div>
      )}
      {data && (
        <div className="sig-scroll" style={{ maxHeight: 260 }}>
          <table className="sig-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Indicator</th>
                <th>Value</th>
                <th>MoM</th>
                <th>YoY</th>
                <th style={{ width: 60 }}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {data.indicators.map((ind) => {
                const { dp, suffix } = fmt(ind);
                return (
                  <tr key={ind.id}>
                    <td>{ind.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      {ind.value != null ? (
                        <TickerCell value={ind.value} dp={dp} suffix={suffix} colorize={false} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {ind.mom != null ? (
                        <TickerCell value={ind.mom} dp={2} suffix="%" signed colorize />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {ind.yoy != null ? (
                        <TickerCell value={ind.yoy} dp={2} suffix="%" signed colorize />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Sparkline data={ind.sparkline} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Sparkline({ data }: { data: (number | null)[] }) {
  const vals = data.filter((v): v is number => v != null);
  if (vals.length < 2) return <span>—</span>;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = max - min || 1;
  const w = 56;
  const h = 16;
  const step = w / (vals.length - 1);

  const pts = vals.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  const trending = vals[vals.length - 1] >= vals[0];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h }}>
      <polyline
        fill="none"
        stroke={trending ? 'var(--sig-green)' : 'var(--sig-red)'}
        strokeWidth="1.5"
        points={pts}
      />
    </svg>
  );
}
