import { useState, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { SeasonalityResponse, SeasonalBucket } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';

type Granularity = 'monthly' | 'weekly' | 'dow' | 'session';
const GRAN_LABELS: Record<Granularity, string> = {
  monthly: 'Monthly',
  weekly: 'Weekly',
  dow: 'Day',
  session: 'Session',
};

function BucketChart({ buckets, currentLabel }: { buckets: SeasonalBucket[]; currentLabel?: string }) {
  const filtered = buckets.filter(b => b.sampleSize > 0);
  if (!filtered.length) return null;

  const count = filtered.length;
  const isWide = count > 12;
  const W = isWide ? Math.max(480, count * 14) : 480;
  const H = 150;
  const PAD_L = 30, PAD_R = 10, PAD_T = 14, PAD_B = 34;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const barW = plotW / count;

  const maxAbs = Math.max(...filtered.map(b => Math.abs(b.avgReturn)), 0.5);
  const zeroY = PAD_T + (plotH * maxAbs) / (2 * maxAbs);

  return (
    <div style={{ overflowX: isWide ? 'auto' : 'visible' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: isWide ? W : '100%', height: 'auto', minWidth: isWide ? W : undefined }}>
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY}
          stroke="var(--sig-border-2)" strokeWidth={1} />

        {filtered.map((b, i) => {
          const barH = (Math.abs(b.avgReturn) / maxAbs) * (plotH / 2);
          const x = PAD_L + i * barW + 1;
          const w = Math.max(barW - 2, 3);
          const isPos = b.avgReturn >= 0;
          const y = isPos ? zeroY - barH : zeroY;
          const fill = isPos ? 'var(--sig-green)' : 'var(--sig-red)';
          const isCurrent = b.label === currentLabel;
          const opacity = isCurrent ? 1 : 0.6;

          return (
            <g key={b.label}>
              <rect x={x} y={y} width={w} height={Math.max(barH, 1)} rx={1}
                fill={fill} opacity={opacity}
                stroke={isCurrent ? 'var(--sig-amber)' : b.significant ? 'var(--sig-cyan)' : 'none'}
                strokeWidth={isCurrent ? 1.5 : b.significant ? 1 : 0} />
              {!isWide && (
                <text x={x + w / 2} y={isPos ? y - 2 : y + barH + 8}
                  textAnchor="middle" fill={fill} fontSize={7} opacity={0.9}>
                  {b.avgReturn > 0 ? '+' : ''}{b.avgReturn.toFixed(1)}%
                </text>
              )}
              {b.significant && (
                <text x={x + w / 2} y={PAD_T - 2} textAnchor="middle"
                  fill="var(--sig-cyan)" fontSize={8}>★</text>
              )}
              <text x={x + w / 2} y={H - (isWide ? 14 : 8)} textAnchor="middle"
                fill={isCurrent ? 'var(--sig-amber)' : 'var(--sig-muted)'}
                fontSize={isWide ? 6 : 8} fontWeight={isCurrent ? 700 : 400}
                transform={isWide ? `rotate(-45, ${x + w / 2}, ${H - 14})` : undefined}>
                {b.label}
              </text>
              {!isWide && (
                <text x={x + w / 2} y={H} textAnchor="middle"
                  fill="var(--sig-muted)" fontSize={6}>
                  {b.winRate.toFixed(0)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function SeasonalityPanel({ instrument }: { instrument: string }) {
  const [gran, setGran] = useState<Granularity>('monthly');

  const fetcher = useCallback(
    () => api.getSeasonality(instrument, gran),
    [instrument, gran]
  );
  const { data, loading, error, reload } = useApi<SeasonalityResponse>(fetcher, [instrument, gran]);

  const buckets = data?.buckets ?? data?.months?.map(m => ({
    label: m.label,
    avgReturn: m.avgReturn,
    medianReturn: m.medianReturn ?? m.avgReturn,
    winRate: m.winRate,
    sampleSize: m.sampleSize,
    tStat: m.tStat ?? 0,
    pValue: m.pValue ?? 1,
    significant: m.significant ?? false,
  })) ?? [];

  const currentLabel = gran === 'monthly'
    ? data?.months?.[new Date().getUTCMonth()]?.label
    : gran === 'dow'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][(new Date().getUTCDay() + 6) % 7]
      : undefined;

  const hasData = buckets.some(b => b.sampleSize > 0);

  return (
    <Panel
      title="Seasonality"
      tag={instrument}
      span={6}
      right={
        <div style={{ display: 'flex', gap: 2 }}>
          {(Object.keys(GRAN_LABELS) as Granularity[]).map(g => (
            <button
              key={g}
              className={`sig-tf-btn${g === gran ? ' is-active' : ''}`}
              onClick={() => setGran(g)}
            >
              {GRAN_LABELS[g]}
            </button>
          ))}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      {loading && <div className="sig-ph">Computing seasonality…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>No price history</div>}
      {data && hasData && (
        <>
          <BucketChart buckets={buckets} currentLabel={currentLabel} />
          <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 9, color: 'var(--sig-muted)', flexWrap: 'wrap' }}>
            <span>★ = p&lt;0.05</span>
            {buckets.filter(b => b.significant).length > 0 && (
              <span style={{ color: 'var(--sig-cyan)' }}>
                {buckets.filter(b => b.significant).length} significant bucket{buckets.filter(b => b.significant).length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {gran === 'monthly' && data.opexEffect && (
            <div style={{ marginTop: 6, padding: '4px 8px', background: 'var(--sig-bg-2)', borderRadius: 3, fontSize: 10 }}>
              <DataRow label="OpEx week avg" value={
                <span style={{ fontVariantNumeric: 'tabular-nums', color: data.opexEffect.opexWeekAvg >= 0 ? 'var(--sig-green)' : 'var(--sig-red)' }}>
                  {data.opexEffect.opexWeekAvg > 0 ? '+' : ''}{data.opexEffect.opexWeekAvg.toFixed(2)}%
                </span>
              } />
              <DataRow label="Non-OpEx avg" value={
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {data.opexEffect.nonOpexWeekAvg > 0 ? '+' : ''}{data.opexEffect.nonOpexWeekAvg.toFixed(2)}%
                </span>
              } />
              {data.opexEffect.significant && (
                <StatusBadge kind="warn" label="OpEx effect detected" />
              )}
            </div>
          )}
        </>
      )}
      {data && !hasData && <div className="sig-ph">Insufficient history for seasonality</div>}
    </Panel>
  );
}
