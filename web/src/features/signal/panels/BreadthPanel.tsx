import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { BreadthResponse } from '../../../types';
import { Panel, DataRow, TickerCell } from '../terminal';

export default function BreadthPanel() {
  const { data, loading, error, reload } = useApi<BreadthResponse>(
    () => api.getBreadth(),
    []
  );

  return (
    <Panel
      title="US100 · Breadth"
      tag="A/D"
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading breadth…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          Failed
        </div>
      )}
      {data && (
        <>
          <DataRow
            label="Advancers"
            value={
              <span style={{ color: 'var(--sig-green)' }}>
                {data.breadth.advancers}{' '}
                <span className="sig-muted">
                  ({data.breadth.advPct.toFixed(0)}%)
                </span>
              </span>
            }
            dir="up"
          />
          <DataRow
            label="Decliners"
            value={
              <span style={{ color: 'var(--sig-red)' }}>
                {data.breadth.decliners}{' '}
                <span className="sig-muted">
                  ({data.breadth.decPct.toFixed(0)}%)
                </span>
              </span>
            }
            dir="down"
          />
          <DataRow
            label="Unchanged"
            value={<span className="sig-muted">{data.breadth.unchanged}</span>}
          />
          <DataRow
            label="A/D Ratio"
            value={
              <TickerCell
                value={data.breadth.adRatio === Infinity ? null : data.breadth.adRatio}
                dp={2}
                colorize
              />
            }
            dir={data.breadth.adRatio > 1 ? 'up' : data.breadth.adRatio < 1 ? 'down' : 'flat'}
          />

          {/* A/D bar */}
          <div className="sig-ad-bar" style={{ marginTop: '8px' }}>
            <div
              className="sig-ad-up"
              style={{ width: `${data.breadth.advPct}%` }}
            />
            <div
              className="sig-ad-down"
              style={{ width: `${data.breadth.decPct}%` }}
            />
          </div>

          {/* mini treemap */}
          <div className="sig-treemap" style={{ marginTop: '8px' }}>
            {data.treemap
              .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
              .slice(0, 20)
              .map((t) => {
                const chg = t.changePct ?? 0;
                const bg =
                  chg > 0.5
                    ? 'var(--sig-green)'
                    : chg < -0.5
                    ? 'var(--sig-red)'
                    : 'var(--sig-border)';
                return (
                  <div
                    key={t.symbol}
                    className="sig-treemap-cell"
                    style={{
                      flexBasis: `${Math.max(t.weight ?? 1, 2)}%`,
                      background: bg,
                    }}
                    title={`${t.symbol} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}
                  >
                    <span className="sig-treemap-sym">{t.symbol}</span>
                    <span className="sig-treemap-chg">
                      {chg >= 0 ? '+' : ''}
                      {chg.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </Panel>
  );
}
