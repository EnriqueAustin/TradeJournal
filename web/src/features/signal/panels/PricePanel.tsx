import { useState, useMemo, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApi, filterKey } from '../../../hooks/useApi';
import type { ResearchPriceResponse } from '../../../types';
import type { Bar } from '../../../types';
import CandleChart from '../../../components/CandleChart';
import { Panel, StatusBadge, TickerCell } from '../terminal';

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;
type TF = (typeof TIMEFRAMES)[number];

const TF_LABELS: Record<TF, string> = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m',
  H1: '1H', H4: '4H', D1: '1D',
};

interface PricePanelProps {
  instrument: string;
  livePrice?: number;
}

function freshnessAge(lastOk: number | null): string {
  if (!lastOk) return 'no data';
  const secs = Math.floor((Date.now() - lastOk) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function PricePanel({ instrument, livePrice }: PricePanelProps) {
  const [tf, setTf] = useState<TF>('H1');

  const { data, loading, error, reload } = useApi<ResearchPriceResponse>(
    () => api.getResearchPrice(instrument, tf),
    [filterKey(instrument, tf)]
  );

  const bars: Bar[] = useMemo(() => {
    if (!data?.bars?.length) return [];
    const mapped = data.bars
      .filter((b) => b.o != null && b.h != null && b.l != null && b.c != null)
      .map((b) => ({
        t: new Date(b.ts).toISOString(),
        open: b.o!,
        high: b.h!,
        low: b.l!,
        close: b.c!,
        volume: b.v ?? 0,
      }));
    if (livePrice != null && mapped.length > 0) {
      const last = mapped[mapped.length - 1];
      mapped[mapped.length - 1] = {
        ...last,
        close: livePrice,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
      };
    }
    return mapped;
  }, [data, livePrice]);

  const handleExport = useCallback(() => {
    window.open(`/api/research/price/${instrument}/export?tf=${tf}`, '_blank');
  }, [instrument, tf]);

  const freshLabel = data?.freshness
    ? `OANDA · ${freshnessAge(data.freshness.last_ok)}`
    : 'OANDA';

  const freshKind = data?.freshness?.status === 'ok' ? 'ok' as const
    : data?.freshness?.status === 'error' ? 'err' as const
    : 'muted' as const;

  const dp = instrument === 'XAUUSD' ? 2 : 1;
  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : null;
  const prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;
  const liveDelta = lastClose != null && prevClose != null ? lastClose - prevClose : null;

  return (
    <Panel
      title={`${instrument} · Price`}
      tag={`${data?.count ?? 0} bars`}
      span={8}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {livePrice != null && (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <TickerCell value={livePrice} dp={dp} colorize={false} />
              <TickerCell value={liveDelta} dp={dp} signed colorize />
            </span>
          )}
          <StatusBadge kind={freshKind} label={freshLabel} />
          <button className="sig-tab" onClick={handleExport} title="CSV Export">
            CSV
          </button>
          <button className="sig-tab" onClick={reload} title="Refresh">
            ⟳
          </button>
        </div>
      }
    >
      {/* TF switcher */}
      <div className="sig-tf-bar">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            className={`sig-tf-btn${t === tf ? ' is-active' : ''}`}
            onClick={() => setTf(t)}
          >
            {TF_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Chart */}
      {loading && !bars.length && (
        <div className="sig-ph">Loading {instrument} {tf}…</div>
      )}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          {error}
        </div>
      )}
      {bars.length > 0 && (
        <div className="sig-chart-wrap">
          <CandleChart bars={bars} height={340} />
        </div>
      )}
      {!loading && !error && bars.length === 0 && (
        <div className="sig-ph">
          No data — click ⟳ or wait for OANDA ingest
        </div>
      )}
    </Panel>
  );
}
