import React from 'react';
import type { TradeDetail, ReplayFrame, ReplayMarkers } from '../types';
import CandleChart from './CandleChart';
import { buildMarkers, buildPriceLines, buildPositionBox } from '../utils/replay';
import { calculateTradePips } from '../utils/pips';
import { formatMoney, formatR, formatDateTime, formatDuration } from '../utils/format';

export interface SocialTradeCardProps {
  trade: TradeDetail | (any & { id: number });
  frames: ReplayFrame[];
  htf: string;
  ltf: string;
  layout: 'split' | 'single';
  propFirm: string;
  handle: string;
  showPnl: boolean;
  theme: 'dark' | 'cyber' | 'clean';
  setupName?: string | null;
  cardRef?: React.RefObject<HTMLDivElement>;
}

export default function SocialTradeCard({
  trade,
  frames,
  htf,
  ltf,
  layout,
  propFirm,
  handle,
  showPnl,
  theme,
  setupName,
  cardRef,
}: SocialTradeCardProps) {
  // Replay markers structure
  const markers: ReplayMarkers = {
    entry: trade.entry_time != null ? { t: trade.entry_time, price: trade.entry_price } : null,
    exit: trade.exit_time != null ? { t: trade.exit_time, price: trade.exit_price } : null,
    stop: trade.stop_price != null ? { price: trade.stop_price } : null,
    target: trade.target_price != null ? { price: trade.target_price } : null,
  };

  // Calculate pips
  const pipMetrics = calculateTradePips(
    trade.instrument,
    trade.entry_price,
    trade.exit_price,
    trade.stop_price,
    trade.target_price,
    trade.direction
  );

  const isWin = (trade.net_pnl ?? 0) >= 0;
  const htfFrame = frames.find((f) => f.tf === htf) || frames[0];
  const ltfFrame = frames.find((f) => f.tf === ltf) || frames[frames.length - 1] || frames[0];

  // Theme styling configurations
  const themeStyles = {
    dark: {
      bg: 'bg-slate-950 text-slate-100 border-slate-800',
      headerBg: 'bg-slate-900/90 border-slate-800',
      cardBg: 'bg-slate-900/60 border-slate-800/80',
      accentWin: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      accentLoss: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
      badge: 'bg-slate-800/80 text-slate-300 border-slate-700',
    },
    cyber: {
      bg: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-purple-950 to-slate-950 text-white border-purple-900/50',
      headerBg: 'bg-purple-950/70 border-purple-800/40 backdrop-blur',
      cardBg: 'bg-purple-950/30 border-purple-800/40',
      accentWin: 'text-cyan-300 bg-cyan-500/20 border-cyan-400/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]',
      accentLoss: 'text-pink-400 bg-pink-500/20 border-pink-400/50 shadow-[0_0_15px_rgba(244,63,94,0.3)]',
      badge: 'bg-purple-900/60 text-purple-200 border-purple-700/50',
    },
    clean: {
      bg: 'bg-slate-900 text-slate-100 border-slate-700',
      headerBg: 'bg-slate-800 border-slate-700',
      cardBg: 'bg-slate-800/50 border-slate-700',
      accentWin: 'text-emerald-300 bg-emerald-900/40 border-emerald-600',
      accentLoss: 'text-rose-300 bg-rose-900/40 border-rose-600',
      badge: 'bg-slate-800 text-slate-200 border-slate-600',
    },
  }[theme];

  return (
    <div
      ref={cardRef}
      className={`relative w-full max-w-[960px] overflow-hidden rounded-2xl border p-6 font-sans shadow-2xl transition-all ${themeStyles.bg}`}
      style={{ boxSizing: 'border-box' }}
    >
      {/* Glow background accent */}
      <div
        className={`pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full blur-3xl opacity-20 ${
          isWin ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />

      {/* HEADER SECTION */}
      <div className={`mb-5 rounded-xl border p-4 backdrop-blur-md ${themeStyles.headerBg}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Instrument & Tags */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black tracking-tight uppercase text-white">
                {trade.instrument}
              </span>
              <span
                className={`rounded-md border px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase ${
                  trade.direction === 'long'
                    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                    : 'border-rose-500/40 bg-rose-500/20 text-rose-400'
                }`}
              >
                {trade.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
              </span>

              {propFirm && (
                <span className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  <svg
                    className="h-3.5 w-3.5 text-amber-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {propFirm}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
              <span className={`rounded px-2 py-0.5 border ${themeStyles.badge} capitalize`}>
                Session: {trade.session || 'Off-Hours'}
              </span>
              {setupName && (
                <span className={`rounded px-2 py-0.5 border ${themeStyles.badge}`}>
                  Setup: {setupName}
                </span>
              )}
              {trade.hold_time_sec != null && (
                <span className={`rounded px-2 py-0.5 border ${themeStyles.badge}`}>
                  Duration: {formatDuration(trade.hold_time_sec)}
                </span>
              )}
            </div>
          </div>

          {/* Right: P&L, Pips & R-Multiple */}
          <div className="flex items-center gap-3">
            {showPnl && trade.net_pnl != null && (
              <div
                className={`flex flex-col items-end rounded-xl border px-3.5 py-2 ${
                  isWin ? themeStyles.accentWin : themeStyles.accentLoss
                }`}
              >
                <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
                  Net Realized
                </span>
                <span className="text-xl font-black tracking-tight">
                  {formatMoney(trade.net_pnl)}
                </span>
              </div>
            )}

            <div
              className={`flex flex-col items-end rounded-xl border px-3.5 py-2 ${
                isWin ? themeStyles.accentWin : themeStyles.accentLoss
              }`}
            >
              <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
                Pip Move
              </span>
              <span className="text-xl font-black tracking-tight">
                {pipMetrics.pipsFormatted}
              </span>
            </div>

            {trade.r_multiple != null && (
              <div
                className={`flex flex-col items-end rounded-xl border px-3.5 py-2 ${
                  isWin ? themeStyles.accentWin : themeStyles.accentLoss
                }`}
              >
                <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
                  Return
                </span>
                <span className="text-xl font-black tracking-tight">
                  {formatR(trade.r_multiple)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CHARTS SECTION */}
      <div
        className={`mb-5 gap-4 ${
          layout === 'split' ? 'grid grid-cols-1 md:grid-cols-2' : 'flex flex-col'
        }`}
      >
        {/* HTF Chart (If split layout) */}
        {layout === 'split' && htfFrame && (
          <div className={`flex flex-col overflow-hidden rounded-xl border ${themeStyles.cardBg}`}>
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-400" />
                Higher Timeframe Context ({htf})
              </span>
              <span className="text-[11px] text-slate-500">OANDA / Candle Data</span>
            </div>
            <div className="p-2">
              <CandleChart
                bars={htfFrame.bars}
                markers={buildMarkers(htfFrame.bars, markers, trade.direction)}
                priceLines={buildPriceLines(markers)}
                positionBox={buildPositionBox(htfFrame.bars, markers, trade.direction)}
                height={260}
              />
            </div>
          </div>
        )}

        {/* LTF / Main Execution Chart */}
        {ltfFrame && (
          <div className={`flex flex-col overflow-hidden rounded-xl border ${themeStyles.cardBg}`}>
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Execution Trigger ({ltf})
              </span>
              <span className="text-[11px] text-slate-500">Entry & Exit Overlay</span>
            </div>
            <div className="p-2">
              <CandleChart
                bars={ltfFrame.bars}
                markers={buildMarkers(ltfFrame.bars, markers, trade.direction)}
                priceLines={buildPriceLines(markers)}
                positionBox={buildPositionBox(ltfFrame.bars, markers, trade.direction)}
                height={layout === 'split' ? 260 : 340}
              />
            </div>
          </div>
        )}
      </div>

      {/* FOOTER METRICS & WATERMARK */}
      <div className={`rounded-xl border p-3.5 ${themeStyles.headerBg}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-slate-500">Entry: </span>
              <span className="font-semibold text-slate-200">{trade.entry_price}</span>
            </div>
            <div>
              <span className="text-slate-500">Exit: </span>
              <span className="font-semibold text-slate-200">{trade.exit_price}</span>
            </div>
            {pipMetrics.riskRewardFormatted && (
              <div>
                <span className="text-slate-500">Risk/Reward: </span>
                <span className="font-medium text-amber-300">{pipMetrics.riskRewardFormatted}</span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Executed: </span>
              <span className="font-medium text-slate-300">{formatDateTime(trade.entry_time)}</span>
            </div>
          </div>

          {/* Watermark branding */}
          <div className="flex items-center gap-2 font-semibold text-indigo-400">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            <span>TradeJournal</span>
            {handle && <span className="text-slate-400 font-normal">· {handle}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
