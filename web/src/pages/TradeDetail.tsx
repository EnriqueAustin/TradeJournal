import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useFilters } from '../store/FilterContext';
import { AsyncBoundary } from '../components/states';
import SocialShareModal from '../components/SocialShareModal';
import CustomFieldsCard from '../components/CustomFieldsCard';
import ExitAnalysisCard from '../components/ExitAnalysisCard';
import ContextTab from '../features/signal/panels/ContextTab';
import TradeChartCard from '../components/trade/TradeChartCard';
import PartialsPanel from '../components/trade/PartialsPanel';
import ScreenshotsPanel from '../components/trade/ScreenshotsPanel';
import TagsPanel from '../components/trade/TagsPanel';
import WickSetupPanel from '../components/trade/WickSetupPanel';
import ReviewPanel from '../components/trade/ReviewPanel';
import NotesPanel from '../components/trade/NotesPanel';
import KeyStatsCard from '../components/trade/KeyStatsCard';
import RiskLevelsCard from '../components/trade/RiskLevelsCard';
import { useTradeNeighbors, type TradeNeighbors } from '../components/trade/useTradeNeighbors';
import { isTypingTarget } from '../utils/tradeNav';
import type { TradeDetail as TTradeDetail, ReplayFrame } from '../types';
import { sessionLabel } from '../utils/format';

export default function TradeDetail() {
  const { id } = useParams<{ id: string }>();
  const tradeId = Number(id);
  const { data, loading, error, reload } = useApi(
    () => api.getTrade(tradeId),
    [tradeId]
  );
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareFrames, setShareFrames] = useState<ReplayFrame[]>([]);
  const [loadingShare, setLoadingShare] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  // The fetched trade can lag the URL for a moment while stepping; only trust
  // it once it matches, so the neighbours are computed for the right trade.
  const trade = data && data.id === tradeId ? data : null;
  const neighbors = useTradeNeighbors(tradeId, trade?.account_id);

  // ← / → step through trades (ignored while typing or with a modal open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showShareModal || isTypingTarget(e)) return;
      if (e.key === 'ArrowLeft' && neighbors.prevId != null) {
        e.preventDefault();
        navigate(`/trades/${neighbors.prevId}`);
      } else if (e.key === 'ArrowRight' && neighbors.nextId != null) {
        e.preventDefault();
        navigate(`/trades/${neighbors.nextId}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [neighbors.prevId, neighbors.nextId, showShareModal, navigate]);

  // Deleting is irreversible and cascades to notes/tags/screenshots, so confirm
  // first, then return to the list.
  const onDelete = async () => {
    if (!window.confirm('Delete this trade? Its notes, tags and screenshots go with it. This cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteTrade(tradeId);
      navigate('/trades');
    } catch (e) {
      window.alert(`Could not delete the trade: ${(e as Error)?.message ?? e}`);
      setDeleting(false);
    }
  };

  const openShareModal = async () => {
    setLoadingShare(true);
    try {
      const res = await api.getReplay(tradeId, ['M1', 'M5', 'M15', 'M30', 'H1']);
      setShareFrames(res.frames);
      setShowShareModal(true);
    } catch {
      // Fallback empty frames if bars not loaded yet
      setShareFrames([]);
      setShowShareModal(true);
    } finally {
      setLoadingShare(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link
            to="/trades"
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            ← Back to trades
          </Link>
          <PrevNext neighbors={neighbors} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openShareModal}
            disabled={loadingShare}
            className="btn bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40"
          >
            {loadingShare ? 'Loading Card…' : '📸 Share Card'}
          </button>
          <Link to={`/replay?trade=${tradeId}`} className="btn">
            ▶ Replay
          </Link>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="btn border border-red-500/40 text-red-400 hover:bg-red-600/20"
            title="Delete this trade permanently"
          >
            {deleting ? 'Deleting…' : '🗑 Delete'}
          </button>
        </div>
      </div>
      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={reload}
        loadingLabel="Loading trade…"
      >
        {trade && (
          <TradeBody
            // Remount per trade so panel-local drafts never leak across trades.
            key={trade.id}
            trade={trade}
            onChanged={reload}
            onOpenShare={openShareModal}
          />
        )}
      </AsyncBoundary>

      {showShareModal && data && (
        <SocialShareModal
          trade={data}
          frames={shareFrames}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}

function PrevNext({ neighbors }: { neighbors: TradeNeighbors }) {
  const { prevId, nextId, position, total, mode } = neighbors;
  const scope =
    mode === 'list'
      ? 'in the Trades list order (filters + sort)'
      : 'by entry time in this account';
  const cls =
    'btn px-2 py-0.5 text-xs disabled:pointer-events-none';
  return (
    <div className="flex items-center gap-1.5">
      {prevId != null ? (
        <Link to={`/trades/${prevId}`} className={cls} title={`Previous trade ${scope} (←)`}>
          ← Prev
        </Link>
      ) : (
        <button className={cls} disabled>
          ← Prev
        </button>
      )}
      {position != null && (
        <span className="num px-1 text-xs text-slate-500" title={`Position ${scope}`}>
          {position} / {total}
        </span>
      )}
      {nextId != null ? (
        <Link to={`/trades/${nextId}`} className={cls} title={`Next trade ${scope} (→)`}>
          Next →
        </Link>
      ) : (
        <button className={cls} disabled>
          Next →
        </button>
      )}
    </div>
  );
}

function TradeBody({
  trade,
  onChanged,
  onOpenShare,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
  onOpenShare: () => void;
}) {
  const { setups } = useFilters();
  const setupName = setups.find((s) => s.id === trade.setup_id)?.name ?? null;
  const [activeTab, setActiveTab] = useState<'details' | 'context'>('details');

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* Main column: header, chart, executions, exit analysis, notes, screenshots */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-slate-100">
              {trade.instrument}
            </h1>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                trade.direction === 'long'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-red-500/15 text-red-400'
              }`}
            >
              {trade.direction}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {sessionLabel(trade.session)}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
              #{trade.id}
            </span>
            {setupName && (
              <span className="rounded bg-cyan-600/20 px-2 py-0.5 text-xs font-medium text-cyan-300">
                {setupName}
              </span>
            )}
          </div>
          <div className="flex gap-1 border-b border-slate-700">
            <button
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === 'details' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setActiveTab('details')}
            >
              Details
            </button>
            <button
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === 'context' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setActiveTab('context')}
            >
              Market Context
            </button>
          </div>
        </div>

        {activeTab === 'context' ? (
          <ContextTab tradeId={trade.id} instrument={trade.instrument} entryPrice={trade.entry_price} />
        ) : (
          <>
            {/* Chart with position indicator (+ news around the trade) */}
            <TradeChartCard trade={trade} onChanged={onChanged} onOpenShare={onOpenShare} />

            {/* Partials / executions */}
            <PartialsPanel trade={trade} />

            {/* Where price went after the exit (self-contained, from stored bars) */}
            <ExitAnalysisCard
              tradeId={trade.id}
              refreshKey={`${trade.exit_price}|${trade.stop_price}|${trade.target_price}|${trade.direction}`}
            />

            <NotesPanel trade={trade} onChanged={onChanged} />

            <ScreenshotsPanel trade={trade} onChanged={onChanged} />
          </>
        )}
      </div>

      {/* Right rail: stats + review inputs, sticky while the main column scrolls */}
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
        <KeyStatsCard trade={trade} />
        <ReviewPanel trade={trade} onChanged={onChanged} />
        <RiskLevelsCard trade={trade} onChanged={onChanged} />
        <TagsPanel trade={trade} onChanged={onChanged} />
        <WickSetupPanel trade={trade} onChanged={onChanged} />
        <CustomFieldsCard tradeId={trade.id} account={trade.account_id} />
      </div>
    </div>
  );
}
