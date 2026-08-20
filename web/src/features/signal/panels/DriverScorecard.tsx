import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { DriversResponse } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';

const COMPOSITE_BADGE: Record<string, BadgeKind> = {
  tailwind: 'ok',
  neutral: 'muted',
  headwind: 'warn',
};

const SIGNAL_COLOR: Record<string, string> = {
  bullish: 'var(--sig-green)',
  neutral: 'var(--sig-muted)',
  bearish: 'var(--sig-red)',
};

function ZBar({ z }: { z: number | null }) {
  if (z == null) return <span className="sig-muted">—</span>;
  const clamped = Math.max(-3, Math.min(3, z));
  const pct = ((clamped + 3) / 6) * 100;
  const color = z > 0 ? 'var(--sig-green)' : z < 0 ? 'var(--sig-red)' : 'var(--sig-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 76 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--sig-bg-2)', borderRadius: 2, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: '50%', top: 0, width: 1, height: 6, background: 'var(--sig-border-2)',
        }} />
        <div style={{
          position: 'absolute', left: `${pct}%`, top: -1, width: 4, height: 8, borderRadius: 1,
          background: color, transform: 'translateX(-2px)',
        }} />
      </div>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', fontSize: 10, minWidth: 30, textAlign: 'right' }}>
        {z > 0 ? '+' : ''}{z.toFixed(2)}
      </span>
    </div>
  );
}

// Correlation cell: color by strength + significance. Dim when insignificant.
function CorrCell({ corr, pValue }: { corr: number | null; pValue: number | null }) {
  if (corr == null) return <span className="sig-muted" style={{ textAlign: 'right' }}>—</span>;
  const significant = pValue == null || pValue < 0.05;
  const strong = Math.abs(corr) >= 0.5;
  const color = !significant
    ? 'var(--sig-muted)'
    : strong ? 'var(--sig-text)' : 'var(--sig-text-dim)';
  return (
    <span
      title={pValue != null ? `p=${pValue.toFixed(3)}${significant ? '' : ' (n.s.)'}` : undefined}
      style={{ color, fontVariantNumeric: 'tabular-nums', fontSize: 10, textAlign: 'right', padding: '2px 0' }}
    >
      {corr > 0 ? '+' : ''}{corr.toFixed(2)}{!significant ? '·' : ''}
    </span>
  );
}

export default function DriverScorecard() {
  const { data, loading, error, reload } = useApi<DriversResponse>(
    () => api.getDrivers('XAUUSD'),
    []
  );

  const netPush = data
    ? data.drivers.reduce((s, d) => s + (d.contribution ?? 0), 0)
    : 0;
  const hasContrib = data?.drivers.some(d => d.contribution != null);

  return (
    <Panel
      title="Driver Scorecard"
      tag="GOLD"
      span={6}
      right={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {data?.engine && (
            <span
              title={data.engine === 'python' ? 'Quant engine: Python (returns corr + OLS β)' : 'Fallback: Node stub (analytics offline)'}
              style={{
                fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: data.engine === 'python' ? 'var(--sig-green)' : 'var(--sig-amber)',
              }}
            >
              {data.engine === 'python' ? '⚡PY' : 'NODE'}
            </span>
          )}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </span>
      }
    >
      {loading && <div className="sig-ph">Computing driver signals…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No driver data — run FRED + CBOE ingest first
        </div>
      )}
      {data && (
        <>
          <DataRow
            label="Composite"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <StatusBadge
                  kind={COMPOSITE_BADGE[data.composite.label] ?? 'muted'}
                  label={`${data.composite.label.toUpperCase()} ${data.composite.score > 0 ? '+' : ''}${data.composite.score.toFixed(2)}`}
                />
                {data.composite.confidence != null && (
                  <span className="sig-muted" style={{ fontSize: 9 }}>
                    conf {(data.composite.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </span>
            }
          />
          {hasContrib && (
            <DataRow
              label="Net driver push"
              value={
                <span style={{
                  color: netPush > 0 ? 'var(--sig-green)' : netPush < 0 ? 'var(--sig-red)' : 'var(--sig-muted)',
                  fontVariantNumeric: 'tabular-nums', fontSize: 11,
                }}>
                  {netPush > 0 ? '+' : ''}{netPush.toFixed(2)}% <span className="sig-muted" style={{ fontSize: 9 }}>β·Δ</span>
                </span>
              }
            />
          )}
          <div className="sig-section-label" style={{ marginTop: 6 }}>Drivers</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '2px 8px', fontSize: 11 }}>
            <span className="sig-muted" style={hcol}>Driver</span>
            <span className="sig-muted" style={{ ...hcol, textAlign: 'right' }}>Value</span>
            <span className="sig-muted" style={hcol}>Z-Score</span>
            <span className="sig-muted" style={{ ...hcol, textAlign: 'right' }}>Corr</span>
            <span className="sig-muted" style={{ ...hcol, textAlign: 'right' }}>Signal</span>
            {data.drivers.map((d) => (
              <div key={d.id} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--sig-text-dim)', padding: '2px 0' }}>
                  {d.name}
                  <span style={{ fontSize: 8, color: 'var(--sig-muted)', marginLeft: 4 }}>
                    {d.relationship === 'inverse' ? '↕' : '↗'}
                  </span>
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '2px 0' }}>
                  {d.value != null ? d.value.toFixed(2) : '—'}
                </span>
                <ZBar z={d.zScore} />
                <CorrCell corr={d.correlation} pValue={d.pValue} />
                <span style={{
                  color: SIGNAL_COLOR[d.signal], textTransform: 'uppercase', fontSize: 10,
                  fontWeight: 700, letterSpacing: '0.06em', textAlign: 'right', padding: '2px 0',
                }}>
                  {d.signal}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

const hcol = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
} as const;
