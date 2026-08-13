import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RegimeResponse } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';

const REGIME_BADGE: Record<string, BadgeKind> = {
  'risk-on': 'ok',
  'neutral': 'muted',
  'risk-off': 'warn',
  'crisis': 'err',
};

const SIGNAL_COLOR: Record<string, string> = {
  bullish: 'var(--sig-green)',
  neutral: 'var(--sig-muted)',
  bearish: 'var(--sig-red)',
};

export default function RegimePanel() {
  const { data, loading, error, reload } = useApi<RegimeResponse>(
    () => api.getRegime(),
    []
  );

  return (
    <Panel
      title="Risk Regime"
      tag="RISK"
      span={6}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Classifying regime…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No regime data — run ingest first
        </div>
      )}
      {data && (
        <>
          <DataRow
            label="Regime"
            value={
              <StatusBadge
                kind={REGIME_BADGE[data.regime] ?? 'muted'}
                label={data.regime.toUpperCase()}
              />
            }
          />
          <DataRow
            label="Composite Score"
            value={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.score.toFixed(1)}
              </span>
            }
          />
          <div className="sig-section-label" style={{ marginTop: 6 }}>Factors</div>
          {data.factors.map((f) => (
            <DataRow
              key={f.name}
              label={f.name}
              value={
                <span style={{ color: SIGNAL_COLOR[f.signal] ?? 'var(--sig-muted)' }}>
                  {f.value.toFixed(2)} · {f.signal}
                </span>
              }
            />
          ))}
        </>
      )}
    </Panel>
  );
}
