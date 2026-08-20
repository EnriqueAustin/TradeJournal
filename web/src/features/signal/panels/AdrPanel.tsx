import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { AdrResponse } from '../../../types';
import { Panel, DataRow } from '../terminal';

// Average Daily Range meter. How much of the typical day's range price has
// already spent — near 100%+ favours mean-reversion / wick fills, low favours
// continuation. A first-class read for a session-timed gold scalp.
export default function AdrPanel({ instrument }: { instrument: string }) {
  const { data, loading, error, reload } = useApi<AdrResponse>(
    () => api.getAdr(instrument, 14),
    [instrument]
  );

  const pct = data?.pctUsed != null ? Math.round(data.pctUsed * 100) : null;
  const barPct = pct != null ? Math.min(pct, 100) : 0;
  const barColor =
    pct == null ? 'var(--sig-muted)'
    : pct >= 100 ? 'var(--sig-red)'
    : pct >= 70 ? 'var(--sig-amber)'
    : 'var(--sig-green)';

  return (
    <Panel
      title="ADR"
      tag={`14d · ${instrument}`}
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Computing ADR…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No price data — run OANDA ingest
        </div>
      )}
      {data && data.adr == null && (
        <div className="sig-ph">Not enough daily history yet.</div>
      )}
      {data && data.adr != null && (
        <>
          <DataRow label="Avg Daily Range" value={<span className="sig-num">{data.adr}</span>} />
          {data.today && (
            <DataRow
              label="Today's Range"
              value={<span className="sig-num">{data.today.range}</span>}
            />
          )}
          <div style={{ padding: '6px 0 2px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span className="sig-row-label">ADR Used</span>
              <span className="sig-num" style={{ color: barColor }}>
                {pct != null ? `${pct}%` : '—'}
              </span>
            </div>
            <div className="sig-bar-track" style={{ marginTop: 3 }}>
              <div className="sig-bar-fill" style={{ width: `${barPct}%`, background: barColor }} />
            </div>
          </div>
          <DataRow
            label="Proj. High"
            value={<span className="sig-num sig-up">{data.projectedHigh}</span>}
          />
          <DataRow
            label="Proj. Low"
            value={<span className="sig-num sig-down">{data.projectedLow}</span>}
          />
        </>
      )}
    </Panel>
  );
}
