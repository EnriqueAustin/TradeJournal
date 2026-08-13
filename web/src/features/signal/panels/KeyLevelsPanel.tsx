import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { LevelsResponse } from '../../../types';
import { Panel } from '../terminal';

const TYPE_COLOR: Record<string, string> = {
  pivot: 'var(--sig-cyan)',
  round: 'var(--sig-amber)',
  structure: 'var(--sig-text-dim)',
};

export default function KeyLevelsPanel({ instrument }: { instrument: string }) {
  const { data, loading, error, reload } = useApi<LevelsResponse>(
    () => api.getLevels(instrument),
    [instrument]
  );

  return (
    <Panel
      title="Key Levels"
      tag={instrument}
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Computing levels…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No price data — run ingest first
        </div>
      )}
      {data && data.levels.length > 0 && (
        <div className="sig-scroll" style={{ maxHeight: 280 }}>
          <table className="sig-table">
            <thead>
              <tr>
                <th>Level</th>
                <th className="sig-right">Price</th>
                <th className="sig-right">Dist</th>
              </tr>
            </thead>
            <tbody>
              {data.levels.map((lvl) => {
                const dist = data.currentPrice
                  ? ((lvl.price - data.currentPrice) / data.currentPrice) * 100
                  : 0;
                const isAbove = lvl.price >= (data.currentPrice ?? 0);
                return (
                  <tr key={lvl.label} style={
                    Math.abs(dist) < 0.05
                      ? { background: 'rgba(53, 199, 224, 0.08)' }
                      : undefined
                  }>
                    <td style={{ color: TYPE_COLOR[lvl.type] ?? 'var(--sig-text)' }}>
                      {lvl.label}
                    </td>
                    <td className="sig-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {lvl.price.toFixed(2)}
                    </td>
                    <td className="sig-right" style={{
                      color: isAbove ? 'var(--sig-red)' : 'var(--sig-green)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 10,
                    }}>
                      {dist > 0 ? '+' : ''}{dist.toFixed(2)}%
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
