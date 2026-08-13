import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { EtfFlowResponse } from '../../../types';
import { Panel, DataRow, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';
import { TickerCell } from '../terminal';

const TREND_BADGE: Record<string, BadgeKind> = {
  inflow: 'ok',
  flat: 'muted',
  outflow: 'warn',
};

function TonnesChart({ history }: { history: { date: number; tonnes: number }[] }) {
  const W = 280, H = 50, PAD = 2;
  if (history.length < 3) return null;

  const vals = history.map(h => h.tonnes).filter((t): t is number => t != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - 2 * PAD);
    const y = PAD + (1 - (v - min) / range) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const fillPoints = [`${PAD},${H - PAD}`, ...points, `${W - PAD},${H - PAD}`];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 4 }}>
      <polygon points={fillPoints.join(' ')} fill="var(--sig-amber)" opacity={0.1} />
      <polyline points={points.join(' ')} fill="none" stroke="var(--sig-amber)" strokeWidth={1.2} />
    </svg>
  );
}

export default function EtfFlowPanel() {
  const { data, loading, error, reload } = useApi<EtfFlowResponse>(
    () => api.getEtfFlows(),
    []
  );

  return (
    <Panel
      title="ETF Flows (GLD)"
      tag="SPDR"
      span={4}
      right={
        <>
          {data && <StatusBadge kind={TREND_BADGE[data.trend] ?? 'muted'} label={data.trend.toUpperCase()} />}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </>
      }
    >
      {loading && <div className="sig-ph">Loading ETF data…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No ETF data — run POST /ingest/etf
        </div>
      )}
      {data && (
        <>
          <DataRow
            label="Holdings"
            value={
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.tonnes != null ? `${data.tonnes.toFixed(1)} t` : '—'}
              </span>
            }
          />
          <DataRow
            label="Daily Δ"
            value={<TickerCell value={data.dailyChangeTonnes} dp={2} suffix=" t" />}
          />
          <DataRow
            label="Weekly Δ"
            value={<TickerCell value={data.weeklyChangeTonnes} dp={2} suffix=" t" />}
          />
          <TonnesChart history={data.history} />
        </>
      )}
    </Panel>
  );
}
