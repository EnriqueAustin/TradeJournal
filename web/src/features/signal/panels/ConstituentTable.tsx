import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { ConstituentResponse } from '../../../types';
import { Panel, StatusBadge, TickerCell } from '../terminal';

export default function ConstituentTable() {
  const { data, loading, error, reload } = useApi<ConstituentResponse>(
    () => api.getConstituents(),
    []
  );

  return (
    <Panel
      title="US100 · Members"
      tag="MEMB"
      span={12}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading constituents…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          Failed to load constituents
        </div>
      )}
      {data && (
        <>
          <div className="sig-scroll">
            <table className="sig-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Symbol</th>
                  <th>Sector</th>
                  <th className="sig-right">Wt%</th>
                  <th className="sig-right">Price</th>
                  <th className="sig-right">Chg</th>
                  <th className="sig-right">Chg%</th>
                  <th className="sig-right">Vol</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m, i) => (
                  <tr key={m.symbol} className={m.mag7 ? 'sig-mag7' : ''}>
                    <td className="sig-muted">{i + 1}</td>
                    <td>
                      <span className="sig-symbol">{m.symbol}</span>
                      {m.mag7 && <span className="sig-tag-mag7">M7</span>}
                    </td>
                    <td className="sig-muted">{m.sector ?? '—'}</td>
                    <td className="sig-right">
                      <TickerCell value={m.weight} dp={2} suffix="%" />
                    </td>
                    <td className="sig-right">
                      <TickerCell value={m.quote?.price ?? null} dp={2} />
                    </td>
                    <td className="sig-right">
                      <TickerCell
                        value={m.quote?.change ?? null}
                        dp={2}
                        signed
                        colorize
                      />
                    </td>
                    <td className="sig-right">
                      <TickerCell
                        value={m.quote?.changePct ?? null}
                        dp={2}
                        signed
                        colorize
                        suffix="%"
                      />
                    </td>
                    <td className="sig-right sig-muted">
                      {m.quote?.volume != null
                        ? fmtVol(m.quote.volume)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sig-row sig-muted" style={{ marginTop: '4px', fontSize: '11px' }}>
            {data.count} members ·
            {data.freshness.status === 'ok'
              ? ` updated ${ago(data.freshness.last_ok)}`
              : ` ${data.freshness.status}`}
            {' · '}
            <StatusBadge
              kind={data.freshness.status === 'ok' ? 'ok' : 'warn'}
              label={data.freshness.status === 'ok' ? 'FRESH' : data.freshness.status}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
