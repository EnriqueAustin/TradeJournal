import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { VolResponse } from '../../../types';
import { Panel, DataRow, TickerCell } from '../terminal';

interface Props {
  instrument: string;
}

export default function VolPanel({ instrument }: Props) {
  const { data, loading, error, reload } = useApi<VolResponse>(
    () => api.getVol(instrument),
    [instrument]
  );

  return (
    <Panel
      title={`${instrument} · Volatility`}
      tag={data?.volIndex ?? 'VOL'}
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Loading vol…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No vol data — run CBOE ingest
        </div>
      )}
      {data && (
        <>
          <DataRow
            label={`${data.volIndex} Current`}
            value={
              <span style={{ fontSize: '14px', fontWeight: 700 }}>
                <TickerCell value={data.current} dp={2} />
              </span>
            }
          />
          <DataRow
            label="Percentile (60d)"
            value={
              <span>
                <TickerCell value={data.pctRank} dp={0} suffix="%" />
                {data.pctRank != null && (
                  <span
                    className="sig-muted"
                    style={{ marginLeft: 6, fontSize: '10px' }}
                  >
                    {data.pctRank > 80
                      ? 'ELEVATED'
                      : data.pctRank > 50
                      ? 'NORMAL'
                      : 'LOW'}
                  </span>
                )}
              </span>
            }
          />
          <DataRow
            label="60d Range"
            value={
              <span>
                <TickerCell value={data.low60d} dp={1} /> –{' '}
                <TickerCell value={data.high60d} dp={1} />
              </span>
            }
          />
          <DataRow
            label="60d Avg"
            value={<TickerCell value={data.avg60d} dp={2} />}
          />

          {data.expectedMove.daily != null && (
            <>
              <div
                style={{
                  borderTop: '1px solid var(--sig-border)',
                  margin: '6px 0 4px',
                  paddingTop: '4px',
                  color: 'var(--sig-amber)',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                Expected Move
              </div>
              <DataRow
                label="Daily (1σ)"
                value={
                  <span>
                    ±<TickerCell value={data.expectedMove.daily} dp={2} />
                  </span>
                }
              />
              <DataRow
                label="Weekly (1σ)"
                value={
                  <span>
                    ±<TickerCell value={data.expectedMove.weekly} dp={2} />
                  </span>
                }
              />
            </>
          )}

          {/* mini sparkline of vol history */}
          {data.history.length > 5 && (
            <div style={{ marginTop: '8px' }}>
              <MiniVolChart data={data.history} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function MiniVolChart({ data }: { data: { ts: number; value: number | null }[] }) {
  const vals = data.map((d) => d.value ?? 0);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = max - min || 1;
  const h = 40;
  const w = 200;

  const points = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: `${h}px` }}>
      <polyline
        fill="none"
        stroke="var(--sig-cyan)"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}
