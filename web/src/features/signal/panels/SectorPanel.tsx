import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { ContributionResponse } from '../../../types';
import { Panel, TickerCell } from '../terminal';

export default function SectorPanel() {
  const { data, loading, error, reload } = useApi<ContributionResponse>(
    () => api.getContribution(),
    []
  );

  const sectors = data
    ? Object.entries(data.sectors)
        .map(([name, s]) => ({ name, ...s }))
        .sort((a, b) => b.weight - a.weight)
    : [];

  return (
    <Panel
      title="US100 · Sectors"
      tag="IMAP"
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading sectors…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          Failed
        </div>
      )}
      {data && (
        <div className="sig-scroll" style={{ maxHeight: '280px' }}>
          <table className="sig-table">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="sig-right">Wt%</th>
                <th className="sig-right">Contrib</th>
                <th className="sig-right">#</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => (
                <tr key={s.name}>
                  <td className="sig-symbol" style={{ fontSize: '10px' }}>
                    {s.name}
                  </td>
                  <td className="sig-right">
                    <TickerCell value={s.weight} dp={1} suffix="%" />
                  </td>
                  <td className="sig-right">
                    <TickerCell
                      value={s.contribution}
                      dp={2}
                      signed
                      colorize
                      suffix="bp"
                    />
                  </td>
                  <td className="sig-right sig-muted">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
