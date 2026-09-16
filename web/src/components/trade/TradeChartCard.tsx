import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { AsyncBoundary } from '../states';
import CandleChart from '../CandleChart';
import NewsPanel from '../NewsPanel';
import { buildMarkers, buildPriceLines, buildPositionBox } from '../../utils/replay';
import { newsToMarkers, currenciesForInstrument } from '../../utils/news';
import type { TradeDetail as TTradeDetail, ReplayResponse, NewsEvent } from '../../types';

// Entry TFs (15m/30m) plus the intraday confirmation TFs (1h/2h/4h) the strategy
// leans on; 5m is the scalp floor. Higher confirmations aggregate from stored M1.
const CHART_TFS = ['M5', 'M15', 'M30', 'H1', 'H2', 'H4'];

export default function TradeChartCard({
  trade,
  onChanged,
  onOpenShare,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
  onOpenShare: () => void;
}) {
  const [tf, setTf] = useState(trade.preferred_tf || 'M30');
  const [refetching, setRefetching] = useState(false);
  const [showBox, setShowBox] = useState(true);

  // Keep local TF in sync if the trade's stored preference changes elsewhere.
  useEffect(() => {
    setTf(trade.preferred_tf || 'M30');
  }, [trade.id, trade.preferred_tf]);

  const { data, loading, error, reload } = useApi<ReplayResponse>(
    () => api.getReplay(trade.id, [tf]),
    [trade.id, tf]
  );

  const refetchBars = async () => {
    setRefetching(true);
    try {
      await api.refetchTradeBars(trade.id);
      reload();
    } catch {
      /* non-fatal — leave the current chart as-is */
    } finally {
      setRefetching(false);
    }
  };

  const frame = data?.frames.find((f) => f.tf === tf) ?? data?.frames[0];

  // Economic-calendar window: the span covered by the loaded bars.
  const [from, to] = useMemo(() => {
    const bars = frame?.bars ?? [];
    if (bars.length === 0) return [null, null] as const;
    const times = bars.map((b) => b.t).sort();
    return [times[0], times[times.length - 1]] as const;
  }, [frame]);

  const currencies = useMemo(
    () => currenciesForInstrument(trade.instrument)?.join(',') ?? undefined,
    [trade.instrument]
  );

  const [refreshing, setRefreshing] = useState(false);
  const news = useApi<NewsEvent[]>(
    () =>
      from && to
        ? api.getNews({ from, to, impact: 'high,medium', currency: currencies })
        : Promise.resolve([]),
    [from, to, currencies]
  );
  const newsStatus = useApi(() => api.getNewsStatus(), []);

  const refreshNews = async () => {
    setRefreshing(true);
    try {
      await api.refreshNews();
      news.reload();
      newsStatus.reload();
    } catch {
      /* non-fatal — keep whatever is cached */
    } finally {
      setRefreshing(false);
    }
  };

  const newsMarkers = useMemo(
    () => newsToMarkers(news.data ?? [], 'medium'),
    [news.data]
  );

  const tradeMarkers =
    data && frame ? buildMarkers(frame.bars, data.markers, data.direction) : [];
  // lightweight-charts requires markers in ascending time order; trade and news
  // markers interleave, so sort the merged set before handing it to the chart.
  const markers = [...tradeMarkers, ...newsMarkers].sort(
    (a, b) => (a.time as number) - (b.time as number)
  );
  const priceLines = data ? buildPriceLines(data.markers) : [];
  const positionBox =
    data && frame ? buildPositionBox(frame.bars, data.markers, data.direction) : null;

  const changeTf = async (next: string) => {
    setTf(next);
    try {
      await api.patchTrade(trade.id, { preferred_tf: next });
      onChanged();
    } catch {
      /* non-fatal — chart still shows the chosen TF this session */
    }
  };

  return (
    <>
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Chart</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {CHART_TFS.map((t) => (
              <button
                key={t}
                className={`btn px-2 py-0.5 text-xs ${
                  t === tf ? 'border-cyan-500 text-cyan-300' : ''
                }`}
                onClick={() => changeTf(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className={`btn text-xs ${showBox ? 'border-cyan-500 text-cyan-300' : ''}`}
            onClick={() => setShowBox((v) => !v)}
            title="Show / hide the position indicator"
          >
            ◱ Box
          </button>
          <button
            className="btn text-xs"
            onClick={refetchBars}
            disabled={refetching}
            title="Re-pull price bars around this trade from OANDA"
          >
            {refetching ? 'Fetching…' : '↻ Bars'}
          </button>
          <button
            onClick={onOpenShare}
            className="btn text-xs bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border-cyan-500/40"
            title="Generate social share graphic"
          >
            📸 Share Card
          </button>
          <Link to={`/replay?trade=${trade.id}`} className="btn text-xs">
            Full replay →
          </Link>
        </div>
      </div>
      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={reload}
        loadingLabel="Loading chart…"
      >
        {!frame || frame.bars.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center text-sm text-slate-500">
            No {tf} bars for {trade.instrument}. Import bars to see the chart.
          </div>
        ) : (
          <CandleChart
            bars={frame.bars}
            markers={markers}
            priceLines={priceLines}
            positionBox={showBox ? positionBox : null}
            height={420}
          />
        )}
      </AsyncBoundary>
    </div>
    <NewsPanel
      events={news.data ?? []}
      status={newsStatus.data}
      onRefresh={refreshNews}
      refreshing={refreshing}
      entryTime={trade.entry_time}
      exitTime={trade.exit_time}
      emptyHint={
        news.error
          ? 'Could not load news for this window.'
          : undefined
      }
    />
    </>
  );
}
