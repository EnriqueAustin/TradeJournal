import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import type { TradeDetail, ReplayFrame } from '../types';
import SocialTradeCard from './SocialTradeCard';

export interface SocialShareModalProps {
  trade: TradeDetail | (any & { id: number });
  frames: ReplayFrame[];
  setupName?: string | null;
  onClose: () => void;
}

export default function SocialShareModal({
  trade,
  frames,
  setupName,
  onClose,
}: SocialShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Available timeframes from returned frames
  const availableTfs = frames.length > 0 ? frames.map((f) => f.tf) : ['M5', 'M15', 'H1'];

  // State for card customization
  const [layout, setLayout] = useState<'split' | 'single'>('split');
  const [htf, setHtf] = useState<string>(
    availableTfs.includes('M15') ? 'M15' : availableTfs.includes('H1') ? 'H1' : availableTfs[0]
  );
  const [ltf, setLtf] = useState<string>(
    availableTfs.includes('M1') ? 'M1' : availableTfs.includes('M5') ? 'M5' : availableTfs[availableTfs.length - 1]
  );
  const [propFirm, setPropFirm] = useState<string>('Equity Edge');
  const [handle, setHandle] = useState<string>('@trader');
  const [showPnl, setShowPnl] = useState<boolean>(true);
  const [theme, setTheme] = useState<'dark' | 'cyber' | 'clean'>('dark');

  // Export states
  const [exporting, setExporting] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setExportError(null);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = `${trade.instrument}_Trade_${trade.id}_${layout}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err: any) {
      setExportError(err?.message || 'Failed to generate PNG image');
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    setExportError(null);
    setCopySuccess(false);
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob,
        }),
      ]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } catch (err: any) {
      setExportError(err?.message || 'Clipboard copy not supported by browser. Try Download instead.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
              📸
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Social Media Trade Card Generator
              </h2>
              <p className="text-xs text-slate-400">
                Customize and export high-resolution chart cards for Twitter, Instagram & Discord
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {/* Modal Content Grid */}
        <div className="grid grid-cols-1 overflow-y-auto lg:grid-cols-12">
          {/* Controls Sidebar (Left on LG) */}
          <div className="flex flex-col gap-4 border-b border-slate-800 bg-slate-900/60 p-5 lg:col-span-4 lg:border-b-0 lg:border-r">
            {/* Layout Mode */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Layout Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLayout('split')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    layout === 'split'
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  📊 2-Chart Split (HTF/LTF)
                </button>
                <button
                  onClick={() => setLayout('single')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    layout === 'single'
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  📈 1-Chart Focus
                </button>
              </div>
            </div>

            {/* Timeframe Selectors */}
            <div className="grid grid-cols-2 gap-3">
              {layout === 'split' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    HTF Context
                  </label>
                  <select
                    value={htf}
                    onChange={(e) => setHtf(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {availableTfs.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf} Timeframe
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={layout === 'single' ? 'col-span-2' : ''}>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Execution TF
                </label>
                <select
                  value={ltf}
                  onChange={(e) => setLtf(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  {availableTfs.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf} Timeframe
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Prop Firm & Social Handle */}
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Prop Firm Badge
                </label>
                <input
                  type="text"
                  value={propFirm}
                  onChange={(e) => setPropFirm(e.target.value)}
                  placeholder="e.g. Equity Edge"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Social Handle / Watermark
                </label>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="@yourhandle"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Style & Privacy Toggles */}
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Display $ Cash P&L</span>
                <button
                  type="button"
                  onClick={() => setShowPnl(!showPnl)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                    showPnl ? 'bg-indigo-600' : 'bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                      showPnl ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Card Theme
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setTheme('dark')}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                      theme === 'dark'
                        ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => setTheme('cyber')}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                      theme === 'cyber'
                        ? 'border-purple-500 bg-purple-600/20 text-purple-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Cyber
                  </button>
                  <button
                    onClick={() => setTheme('clean')}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                      theme === 'clean'
                        ? 'border-slate-500 bg-slate-800 text-slate-200'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Clean
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card Live Preview (Right on LG) */}
          <div className="flex flex-col items-center justify-center bg-slate-950 p-6 lg:col-span-8">
            <div className="w-full max-w-[900px]">
              <SocialTradeCard
                cardRef={cardRef}
                trade={trade}
                frames={frames}
                htf={htf}
                ltf={ltf}
                layout={layout}
                propFirm={propFirm}
                handle={handle}
                showPnl={showPnl}
                theme={theme}
                setupName={setupName}
              />
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-800 bg-slate-900/90 px-6 py-4">
          {exportError ? (
            <span className="text-xs text-rose-400">{exportError}</span>
          ) : copySuccess ? (
            <span className="text-xs font-semibold text-emerald-400">
              ✓ Copied high-res image to clipboard!
            </span>
          ) : (
            <span className="text-xs text-slate-400">Ready to export PNG (2x Retina scale)</span>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              disabled={exporting}
              className="btn px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              📋 Copy to Clipboard
            </button>
            <button
              onClick={handleDownload}
              disabled={exporting}
              className="btn px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 shadow-lg shadow-indigo-600/30"
            >
              💾 Download PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
