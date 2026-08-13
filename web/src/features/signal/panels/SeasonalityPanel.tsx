import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { SeasonalityResponse } from '../../../types';
import { Panel } from '../terminal';

function SeasonalChart({ data }: { data: SeasonalityResponse }) {
  const W = 480, H = 140, PAD_L = 30, PAD_R = 10, PAD_T = 10, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const barW = plotW / 12;

  const maxAbs = Math.max(
    ...data.months.map(m => Math.abs(m.avgReturn)),
    0.5
  );

  const zeroY = PAD_T + (plotH * maxAbs) / (2 * maxAbs);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {/* Zero line */}
      <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY}
        stroke="var(--sig-border-2)" strokeWidth={1} />

      {data.months.map((m, i) => {
        const barH = (Math.abs(m.avgReturn) / maxAbs) * (plotH / 2);
        const x = PAD_L + i * barW + 2;
        const w = barW - 4;
        const isPos = m.avgReturn >= 0;
        const y = isPos ? zeroY - barH : zeroY;
        const fill = isPos ? 'var(--sig-green)' : 'var(--sig-red)';
        const isCurrent = m.month === data.currentMonth;
        const opacity = isCurrent ? 1 : 0.6;

        return (
          <g key={m.month}>
            <rect x={x} y={y} width={w} height={Math.max(barH, 1)} rx={1}
              fill={fill} opacity={opacity}
              stroke={isCurrent ? 'var(--sig-amber)' : 'none'} strokeWidth={isCurrent ? 1.5 : 0} />
            {/* Return label on bar */}
            <text
              x={x + w / 2}
              y={isPos ? y - 2 : y + barH + 8}
              textAnchor="middle"
              fill={fill}
              fontSize={7}
              opacity={0.9}
            >
              {m.avgReturn > 0 ? '+' : ''}{m.avgReturn.toFixed(1)}%
            </text>
            {/* Month label */}
            <text x={x + w / 2} y={H - 8} textAnchor="middle"
              fill={isCurrent ? 'var(--sig-amber)' : 'var(--sig-muted)'} fontSize={8}
              fontWeight={isCurrent ? 700 : 400}>
              {m.label}
            </text>
            {/* Win rate */}
            <text x={x + w / 2} y={H - 0} textAnchor="middle"
              fill="var(--sig-muted)" fontSize={6}>
              {m.sampleSize > 0 ? `${m.winRate.toFixed(0)}%` : '—'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SeasonalityPanel({ instrument }: { instrument: string }) {
  const { data, loading, error, reload } = useApi<SeasonalityResponse>(
    () => api.getSeasonality(instrument),
    [instrument]
  );

  return (
    <Panel
      title="Seasonality"
      tag={instrument}
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Computing seasonality…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No price history — run ingest first
        </div>
      )}
      {data && data.months.some(m => m.sampleSize > 0) && (
        <SeasonalChart data={data} />
      )}
      {data && !data.months.some(m => m.sampleSize > 0) && (
        <div className="sig-ph">Insufficient history for seasonality</div>
      )}
    </Panel>
  );
}
