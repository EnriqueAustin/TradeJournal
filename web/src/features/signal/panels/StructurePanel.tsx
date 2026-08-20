import { useEffect } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { StructureResponse } from '../../../types';
import { Panel } from '../terminal';

const BIAS_COLOR: Record<string, string> = {
  bullish: 'var(--sig-green)',
  bearish: 'var(--sig-red)',
  neutral: 'var(--sig-muted)',
};

function agoLabel(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// Market structure read (M15): directional bias, the latest structure shift
// (CHoCH = the reversal / MSS after a sweep; BOS = continuation), and the
// equal-high/low liquidity pools a sweep hunts. The confirmation half of the
// Wicks-Don't-Lie trigger (sweep → shift → wick-fill entry).
export default function StructurePanel({ instrument }: { instrument: string }) {
  const { data, loading, error, reload } = useApi<StructureResponse>(
    () => api.getStructure(instrument, 'M15'),
    [instrument]
  );

  useEffect(() => {
    const id = setInterval(reload, 30000);
    return () => clearInterval(id);
  }, [reload]);

  const fmtPrice = (p: number) => p.toFixed(instrument === 'XAUUSD' ? 2 : 1);
  const sh = data?.shift ?? null;

  return (
    <Panel
      title="Market Structure"
      tag={`${instrument} · M15`}
      span={4}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
      }
    >
      {loading && !data && <div className="sig-ph">Reading structure…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No M15 data — run OANDA ingest
        </div>
      )}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
          {/* Bias */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="sig-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Bias
            </span>
            <span style={{ color: BIAS_COLOR[data.bias], fontWeight: 700, fontSize: 13, textTransform: 'uppercase' }}>
              {data.bias === 'bullish' ? '▲ Bullish' : data.bias === 'bearish' ? '▼ Bearish' : '– Neutral'}
            </span>
          </div>

          {/* Latest shift */}
          <div>
            <div className="sig-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
              Last shift
            </div>
            {sh ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    textTransform: 'uppercase',
                    background: sh.type === 'CHoCH' ? 'rgba(240,160,32,0.18)' : 'rgba(125,143,136,0.18)',
                    color: sh.type === 'CHoCH' ? 'var(--sig-amber)' : 'var(--sig-muted)',
                  }}
                >
                  {sh.type}{sh.type === 'CHoCH' ? ' · MSS' : ''}
                </span>
                <span style={{ color: sh.direction === 'bullish' ? 'var(--sig-green)' : 'var(--sig-red)', fontWeight: 700, fontSize: 12 }}>
                  {sh.direction === 'bullish' ? '▲' : '▼'} {fmtPrice(sh.level)}
                </span>
                <span className="sig-muted" style={{ fontSize: 11 }}>{agoLabel(sh.ts)}</span>
              </div>
            ) : (
              <span className="sig-muted" style={{ fontSize: 12 }}>No recent break.</span>
            )}
          </div>

          {/* Equal-liquidity pools */}
          <div style={{ display: 'flex', gap: 10 }}>
            <PoolCol title="Equal highs" pools={data.equalHighs} color="var(--sig-green)" fmt={fmtPrice} />
            <PoolCol title="Equal lows" pools={data.equalLows} color="var(--sig-red)" fmt={fmtPrice} />
          </div>
        </div>
      )}
    </Panel>
  );
}

function PoolCol({
  title, pools, color, fmt,
}: {
  title: string;
  pools: { price: number; count: number; lastTs: number }[];
  color: string;
  fmt: (p: number) => string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="sig-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
        {title}
      </div>
      {pools.length === 0 ? (
        <div className="sig-muted" style={{ fontSize: 11 }}>—</div>
      ) : (
        pools.slice(0, 4).map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color }}>{fmt(p.price)}</span>
            <span className="sig-muted">×{p.count}</span>
          </div>
        ))
      )}
    </div>
  );
}
