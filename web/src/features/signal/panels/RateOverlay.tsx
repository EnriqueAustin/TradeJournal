import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RateOverlayResponse } from '../../../types';
import { Panel, DataRow, TickerCell } from '../terminal';

export default function RateOverlay() {
  const { data, loading, error, reload } = useApi<RateOverlayResponse>(
    () => api.getRateOverlay(),
    []
  );

  const last10Y = data?.dgs10?.length ? data.dgs10[data.dgs10.length - 1] : null;
  const lastReal = data?.dfii10?.length ? data.dfii10[data.dfii10.length - 1] : null;
  const lastUS100 = data?.us100?.length ? data.us100[data.us100.length - 1] : null;

  const prev10Y = data?.dgs10?.length && data.dgs10.length > 1
    ? data.dgs10[data.dgs10.length - 2] : null;

  const yieldChg = last10Y && prev10Y
    ? (last10Y.value ?? 0) - (prev10Y.value ?? 0)
    : null;

  return (
    <Panel
      title="US100 · Rates"
      tag="BTMM"
      span={4}
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
          <DataRow
            label="10Y Yield"
            value={
              <span>
                <TickerCell value={last10Y?.value ?? null} dp={3} suffix="%" />
                {yieldChg != null && (
                  <span style={{ marginLeft: 6 }}>
                    <TickerCell value={yieldChg} dp={3} signed colorize suffix="bp" />
                  </span>
                )}
              </span>
            }
            dir={yieldChg != null ? (yieldChg > 0 ? 'up' : yieldChg < 0 ? 'down' : 'flat') : undefined}
          />
          <DataRow
            label="Real Yield (TIPS)"
            value={<TickerCell value={lastReal?.value ?? null} dp={3} suffix="%" />}
          />
          <DataRow
            label="US100 Close"
            value={<TickerCell value={lastUS100?.c ?? null} dp={2} />}
          />
          <div className="sig-muted" style={{ fontSize: '10px', marginTop: '6px' }}>
            {data.dgs10.length} yield obs · {data.us100.length} US100 bars
          </div>
          <div className="sig-muted" style={{ fontSize: '9px', marginTop: '2px' }}>
            Higher yields → headwind for tech/growth (inverse correlation)
          </div>
        </>
      )}
    </Panel>
  );
}
