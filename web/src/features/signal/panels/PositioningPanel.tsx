import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { PositioningResponse } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';

function PercentileBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const isExtreme = pct > 90 || pct < 10;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--sig-muted)', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: isExtreme ? 'var(--sig-amber)' : 'var(--sig-text)' }}>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--sig-bg-2)', borderRadius: 2, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${pct}%`, borderRadius: 2,
          background: isExtreme
            ? 'linear-gradient(90deg, var(--sig-amber), var(--sig-red))'
            : 'linear-gradient(90deg, var(--sig-cyan), var(--sig-green))',
          opacity: 0.7,
        }} />
        <div style={{
          position: 'absolute', left: `${pct}%`, top: -2, width: 4, height: 12,
          borderRadius: 2, background: 'var(--sig-text)', transform: 'translateX(-2px)',
        }} />
      </div>
    </div>
  );
}

export default function PositioningPanel({ instrument }: { instrument: string }) {
  const { data, loading, error, reload } = useApi<PositioningResponse>(
    () => api.getPositioning(instrument),
    [instrument]
  );

  return (
    <Panel
      title="Positioning"
      tag={instrument}
      span={6}
      right={
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {data?.contrarian.flag && (
            <StatusBadge kind="warn" label="CONTRARIAN" />
          )}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      {loading && <div className="sig-ph">Loading positioning…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>Failed to load</div>}
      {data && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* COT section */}
          <div style={{ flex: '1 1 45%', minWidth: 180 }}>
            <div style={{ fontSize: 10, color: 'var(--sig-cyan)', marginBottom: 4, fontWeight: 600 }}>COT (CFTC)</div>
            {data.cot ? (
              <>
                <DataRow label="MM Net" value={
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13 }}>
                    {data.cot.mmNet.toLocaleString()}
                  </span>
                } />
                <DataRow label="% Long" value={
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.cot.pctLong.toFixed(1)}%</span>
                } />
                <DataRow label="WoW Δ" value={
                  <span style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: data.cot.wowChange > 0 ? 'var(--sig-green)' : data.cot.wowChange < 0 ? 'var(--sig-red)' : 'var(--sig-text)',
                  }}>
                    {data.cot.wowChange > 0 ? '+' : ''}{data.cot.wowChange.toLocaleString()}
                  </span>
                } />
                <PercentileBar value={data.cot.percentile1y} label="1Y Percentile" />
              </>
            ) : (
              <div className="sig-ph" style={{ fontSize: 10 }}>No COT data — run POST /ingest/cftc</div>
            )}
          </div>

          {/* ETF section */}
          <div style={{ flex: '1 1 45%', minWidth: 180 }}>
            <div style={{ fontSize: 10, color: 'var(--sig-cyan)', marginBottom: 4, fontWeight: 600 }}>ETF Flows (GLD)</div>
            {data.etf ? (
              <>
                <DataRow label="Tonnes" value={
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13 }}>
                    {data.etf.tonnes?.toFixed(1)}
                  </span>
                } />
                <DataRow label="Daily Δ" value={
                  <span style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: data.etf.delta > 0 ? 'var(--sig-green)' : data.etf.delta < 0 ? 'var(--sig-red)' : 'var(--sig-text)',
                  }}>
                    {data.etf.delta > 0 ? '+' : ''}{data.etf.delta.toFixed(2)}t
                  </span>
                } />
                <DataRow label="Trend" value={
                  <StatusBadge
                    kind={data.etf.trend === 'inflow' ? 'ok' : data.etf.trend === 'outflow' ? 'err' : 'muted'}
                    label={data.etf.trend.toUpperCase()}
                  />
                } />
              </>
            ) : (
              <div className="sig-ph" style={{ fontSize: 10 }}>No ETF data — run POST /ingest/etf</div>
            )}
          </div>

          {/* Contrarian flag */}
          {data.contrarian.flag && (
            <div style={{
              width: '100%', padding: '6px 10px', marginTop: 4,
              background: 'rgba(200, 150, 0, 0.1)', border: '1px solid var(--sig-amber)',
              borderRadius: 3, fontSize: 10, color: 'var(--sig-amber)',
            }}>
              ⚠ {data.contrarian.reason}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
