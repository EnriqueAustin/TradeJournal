import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { SweepsResponse } from '../../../types';
import { Panel } from '../terminal';
import { useSignalTz } from '../lib/tz';

// Format an epoch-ms timestamp as HH:MM in the Signal display timezone.
function hhmm(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));
}

// Recent liquidity sweeps — a bar that pierced a key level then closed back on
// the other side (stop-hunt / wick rejection). Bullish = swept support & closed
// back above (long bias); bearish = swept resistance & closed back below.
export default function SweepPanel({ instrument }: { instrument: string }) {
  const tz = useSignalTz();
  const { data, loading, error, reload } = useApi<SweepsResponse>(
    () => api.getSweeps(instrument, 10),
    [instrument]
  );

  return (
    <Panel
      title="Liquidity Sweeps"
      tag={`${instrument} · M1 · 2d`}
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Scanning for sweeps…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No M1 data — run OANDA ingest
        </div>
      )}
      {data && data.sweeps.length === 0 && !loading && (
        <div className="sig-ph">No sweeps in the last 2 days.</div>
      )}
      {data && data.sweeps.length > 0 && (
        <div className="sig-scroll" style={{ maxHeight: 260 }}>
          <table className="sig-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th className="sig-right">Price</th>
                <th>Bias</th>
                <th className="sig-right">Wick</th>
              </tr>
            </thead>
            <tbody>
              {data.sweeps.map((s, i) => (
                <tr key={`${s.ts}-${s.level}-${i}`}>
                  <td className="sig-muted">{hhmm(s.ts, tz)}</td>
                  <td className="sig-symbol">{s.level}</td>
                  <td className="sig-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {s.price.toFixed(2)}
                  </td>
                  <td
                    style={{
                      color: s.direction === 'bullish' ? 'var(--sig-green)' : 'var(--sig-red)',
                      fontWeight: 700,
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    {s.direction === 'bullish' ? '▲ Long' : '▼ Short'}
                  </td>
                  <td className="sig-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {s.wick.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
