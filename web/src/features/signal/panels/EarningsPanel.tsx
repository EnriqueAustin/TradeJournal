import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { EarningsResponse } from '../../../types';
import { Panel, StatusBadge, TickerCell } from '../terminal';

export default function EarningsPanel() {
  const { data, loading, error, reload } = useApi<EarningsResponse>(
    () => api.getEarnings(),
    []
  );

  return (
    <Panel
      title="US100 · Earnings"
      tag="ERN"
      span={6}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading earnings…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No earnings data — check Finnhub key
        </div>
      )}
      {data && data.earnings.length > 0 && (
        <>
          <div className="sig-scroll" style={{ maxHeight: '300px' }}>
            <table className="sig-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>When</th>
                  <th className="sig-right">Wt%</th>
                  <th className="sig-right">EPS Est</th>
                  <th className="sig-right">EPS Act</th>
                  <th className="sig-right">Surprise</th>
                </tr>
              </thead>
              <tbody>
                {data.earnings.map((e) => {
                  const surprise =
                    e.eps_act != null && e.eps_est != null && e.eps_est !== 0
                      ? ((e.eps_act - e.eps_est) / Math.abs(e.eps_est)) * 100
                      : null;
                  const isPast = e.report_date < Date.now();
                  return (
                    <tr
                      key={`${e.symbol}-${e.report_date}`}
                      className={e.mag7 ? 'sig-mag7' : ''}
                      style={{ opacity: isPast && e.eps_act == null ? 0.5 : 1 }}
                    >
                      <td className="sig-muted">
                        {new Date(e.report_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td>
                        <span className="sig-symbol">{e.symbol}</span>
                        {e.mag7 && <span className="sig-tag-mag7">M7</span>}
                      </td>
                      <td className="sig-muted" style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                        {e.time ?? '—'}
                      </td>
                      <td className="sig-right">
                        <TickerCell value={e.weight} dp={2} suffix="%" />
                      </td>
                      <td className="sig-right">
                        <TickerCell value={e.eps_est} dp={2} />
                      </td>
                      <td className="sig-right">
                        {e.eps_act != null ? (
                          <TickerCell value={e.eps_act} dp={2} />
                        ) : (
                          <span className="sig-muted">—</span>
                        )}
                      </td>
                      <td className="sig-right">
                        {surprise != null ? (
                          <TickerCell
                            value={surprise}
                            dp={1}
                            signed
                            colorize
                            suffix="%"
                          />
                        ) : (
                          <span className="sig-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sig-muted" style={{ fontSize: '10px', marginTop: '4px' }}>
            {data.count} reports ·{' '}
            <StatusBadge
              kind={data.freshness.status === 'ok' ? 'ok' : 'warn'}
              label={data.freshness.status === 'ok' ? 'FRESH' : data.freshness.status}
            />
          </div>
        </>
      )}
      {data && data.earnings.length === 0 && (
        <div className="sig-ph">No upcoming earnings — ingest may be needed</div>
      )}
    </Panel>
  );
}
