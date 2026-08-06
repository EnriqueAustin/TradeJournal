import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useFilters } from '../store/FilterContext';
import { AsyncBoundary } from '../components/states';
import CandleChart from '../components/CandleChart';
import { buildMarkers, buildPriceLines, buildPositionBox } from '../utils/replay';
import type {
  TradeDetail as TTradeDetail,
  TagCategory,
  ReplayResponse,
} from '../types';
import {
  formatMoney,
  formatR,
  formatNumber,
  formatDateTime,
  formatDuration,
  signClass,
} from '../utils/format';

const TAG_CATEGORIES: TagCategory[] = [
  'setup',
  'session',
  'emotion',
  'mistake',
  'grade',
];

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num mt-0.5 text-sm ${className ? '' : 'text-slate-200'}`}>
        {children}
      </div>
    </div>
  );
}

export default function TradeDetail() {
  const { id } = useParams<{ id: string }>();
  const tradeId = Number(id);
  const { data, loading, error, reload } = useApi(
    () => api.getTrade(tradeId),
    [tradeId]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link
          to="/trades"
          className="text-sm text-indigo-400 hover:text-indigo-300"
        >
          ← Back to trades
        </Link>
        <Link to={`/replay?trade=${tradeId}`} className="btn">
          ▶ Replay
        </Link>
      </div>
      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={reload}
        loadingLabel="Loading trade…"
      >
        {data && <TradeBody trade={data} onChanged={reload} />}
      </AsyncBoundary>
    </div>
  );
}

function TradeBody({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const { setups } = useFilters();
  const [stop, setStop] = useState(trade.stop_price?.toString() ?? '');
  const [target, setTarget] = useState(trade.target_price?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [setupSaving, setSetupSaving] = useState(false);
  const setupName = setups.find((s) => s.id === trade.setup_id)?.name ?? null;

  useEffect(() => {
    setStop(trade.stop_price?.toString() ?? '');
    setTarget(trade.target_price?.toString() ?? '');
  }, [trade.id, trade.stop_price, trade.target_price]);

  const saveSetup = async (value: string) => {
    setSetupSaving(true);
    setSaveErr(null);
    try {
      await api.patchTrade(trade.id, {
        setup_id: value === '' ? null : Number(value),
      });
      onChanged();
    } catch (e: any) {
      setSaveErr(e?.message || 'Failed to save setup');
    } finally {
      setSetupSaving(false);
    }
  };

  const saveLevels = async () => {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await api.patchTrade(trade.id, {
        stop_price: stop === '' ? null : Number(stop),
        target_price: target === '' ? null : Number(target),
      });
      setSaveMsg('Saved');
      onChanged();
    } catch (e: any) {
      setSaveErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
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
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs capitalize text-slate-400">
              {trade.session}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
              #{trade.id}
            </span>
            {setupName && (
              <span className="rounded bg-indigo-600/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
                {setupName}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className={`num text-2xl font-semibold ${signClass(trade.net_pnl)}`}>
              {formatMoney(trade.net_pnl)}
            </div>
            <div className={`num text-sm ${signClass(trade.r_multiple)}`}>
              {formatR(trade.r_multiple)}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Entry Time">{formatDateTime(trade.entry_time)}</Field>
          <Field label="Exit Time">{formatDateTime(trade.exit_time)}</Field>
          <Field label="Hold Time">{formatDuration(trade.hold_time_sec)}</Field>
          <Field label="Size">{formatNumber(trade.size, 2)}</Field>
          <Field label="Entry Price">{formatNumber(trade.entry_price, 2)}</Field>
          <Field label="Exit Price">{formatNumber(trade.exit_price, 2)}</Field>
          <Field label="Gross P&L">
            <span className={signClass(trade.gross_pnl)}>
              {formatMoney(trade.gross_pnl)}
            </span>
          </Field>
          <Field label="Commission">{formatMoney(trade.commission)}</Field>
          <Field label="Swap">{formatMoney(trade.swap)}</Field>
          <Field label="MAE">
            {trade.mae == null ? '—' : formatNumber(trade.mae, 2)}
          </Field>
          <Field label="MFE">
            {trade.mfe == null ? '—' : formatNumber(trade.mfe, 2)}
          </Field>
          <Field label="Source">
            <span className="uppercase">{trade.source}</span>
          </Field>
        </div>
      </div>

      {/* Chart with position indicator */}
      <TradeChartCard trade={trade} onChanged={onChanged} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Edit stop / target */}
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Risk Levels
          </h2>
          <div className="mb-4">
            <label className="label" htmlFor="td-setup">
              Setup
            </label>
            <select
              id="td-setup"
              className="input w-full max-w-xs"
              value={trade.setup_id == null ? '' : String(trade.setup_id)}
              disabled={setupSaving}
              onChange={(e) => saveSetup(e.target.value)}
            >
              <option value="">— Unassigned —</option>
              {setups.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                  {s.instrument ? ` (${s.instrument})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="stop">
                Stop Price
              </label>
              <input
                id="stop"
                type="number"
                step="any"
                className="input w-36"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="target">
                Target Price
              </label>
              <input
                id="target"
                type="number"
                step="any"
                className="input w-36"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={saveLevels}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveMsg && (
              <span className="text-sm text-emerald-400">{saveMsg}</span>
            )}
            {saveErr && <span className="text-sm text-red-400">{saveErr}</span>}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            R multiple recomputes from stop distance when the trade is refetched.
          </p>
        </div>

        {/* Tags */}
        <TagsPanel trade={trade} onChanged={onChanged} />
      </div>

      {/* Partials / executions */}
      <PartialsPanel trade={trade} />

      {/* Notes */}
      <NotesPanel trade={trade} onChanged={onChanged} />

      {/* Screenshots */}
      <ScreenshotsPanel trade={trade} onChanged={onChanged} />
    </div>
  );
}

const CHART_TFS = ['M5', 'M15', 'M30', 'H1'];

function TradeChartCard({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
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
  const markers =
    data && frame ? buildMarkers(frame.bars, data.markers, data.direction) : [];
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
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Chart</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {CHART_TFS.map((t) => (
              <button
                key={t}
                className={`btn px-2 py-0.5 text-xs ${
                  t === tf ? 'border-indigo-500 text-indigo-300' : ''
                }`}
                onClick={() => changeTf(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className={`btn text-xs ${showBox ? 'border-indigo-500 text-indigo-300' : ''}`}
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
          <div className="flex h-[320px] items-center justify-center text-sm text-slate-500">
            No {tf} bars for {trade.instrument}. Import bars to see the chart.
          </div>
        ) : (
          <CandleChart
            bars={frame.bars}
            markers={markers}
            priceLines={priceLines}
            positionBox={showBox ? positionBox : null}
            height={340}
          />
        )}
      </AsyncBoundary>
    </div>
  );
}

// Breaks a trade into its entry fill(s) and each partial close, showing every
// partial's own price / size / P&L and how much position was left running.
function PartialsPanel({ trade }: { trade: TTradeDetail }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const execs = [...trade.executions].sort((a, b) =>
    a.exec_time.localeCompare(b.exec_time)
  );
  const entries = execs.filter((e) => e.side === 'in');
  const exits = execs.filter((e) => e.side === 'out');
  const entrySize = entries.reduce((s, e) => s + e.size, 0);

  // Running remaining size after each partial exit (in exit order).
  let remaining = entrySize;
  const rows = exits.map((ex, i) => {
    remaining = Math.max(0, remaining - ex.size);
    return { ex, n: i + 1, remaining, pctClosed: entrySize ? ex.size / entrySize : 0 };
  });

  const hasPnl = exits.some((e) => e.profit != null);

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Partials & Executions
        </h2>
        <span className="text-xs text-slate-500">
          {exits.length} {exits.length === 1 ? 'close' : 'closes'} ·{' '}
          {formatNumber(entrySize, 2)} entered
        </span>
      </div>

      {execs.length === 0 ? (
        <p className="text-sm text-slate-500">No executions recorded.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Entry summary */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-400">
                entry
              </span>
              <span className="text-slate-300">
                {formatNumber(entrySize, 2)} @{' '}
                {formatNumber(trade.entry_price, 2)}
              </span>
            </span>
            <span className="num text-xs text-slate-500">
              {formatDateTime(entries[0]?.exec_time ?? trade.entry_time)}
            </span>
          </div>

          {/* Each partial close */}
          {rows.map(({ ex, n, remaining, pctClosed }) => {
            const isOpen = open.has(ex.id);
            const flat = remaining <= 1e-9;
            return (
              <div
                key={ex.id}
                className="rounded-lg border border-slate-800 bg-slate-900/40"
              >
                <button
                  onClick={() => toggle(ex.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-800/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500">{isOpen ? '▾' : '▸'}</span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                      partial {n}/{exits.length}
                    </span>
                    <span className="num text-slate-300">
                      {formatNumber(ex.size, 2)} @ {formatNumber(ex.price, 2)}
                    </span>
                    <span className="text-xs text-slate-500">
                      ({(pctClosed * 100).toFixed(0)}%)
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {ex.profit != null && (
                      <span className={`num font-medium ${signClass(ex.profit)}`}>
                        {formatMoney(ex.profit)}
                      </span>
                    )}
                    <span className="num text-xs text-slate-500">
                      {flat ? 'closed' : `${formatNumber(remaining, 2)} left`}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-800 px-3 py-2 text-xs sm:grid-cols-4">
                    <Detail label="Time" value={formatDateTime(ex.exec_time)} />
                    <Detail label="Price" value={formatNumber(ex.price, 2)} />
                    <Detail label="Size" value={formatNumber(ex.size, 2)} />
                    <Detail
                      label="Remaining"
                      value={flat ? '0 (flat)' : formatNumber(remaining, 2)}
                    />
                    {ex.profit != null && (
                      <Detail
                        label="P&L"
                        value={formatMoney(ex.profit)}
                        className={signClass(ex.profit)}
                      />
                    )}
                    {ex.commission != null && (
                      <Detail label="Commission" value={formatMoney(ex.commission)} />
                    )}
                    {ex.swap != null && ex.swap !== 0 && (
                      <Detail label="Swap" value={formatMoney(ex.swap)} />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {hasPnl && (
            <div className="mt-1 flex items-center justify-between px-3 text-xs text-slate-500">
              <span>Sum of partials (gross)</span>
              <span className={`num ${signClass(trade.gross_pnl)}`}>
                {formatMoney(exits.reduce((s, e) => s + (e.profit ?? 0), 0))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`num text-slate-300 ${className}`}>{value}</div>
    </div>
  );
}

function ScreenshotsPanel({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const uploadMany = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) {
      setErr('Only image files are supported.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      for (const f of list) await api.uploadScreenshot(trade.id, f);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (sid: number) => {
    setErr(null);
    try {
      await api.deleteScreenshot(trade.id, sid);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Delete failed');
    }
  };

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        Screenshots ({trade.screenshots.length})
      </h2>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) uploadMany(e.dataTransfer.files);
        }}
        className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition ${
          dragOver
            ? 'border-indigo-400 bg-indigo-500/5'
            : 'border-slate-700 hover:border-slate-600'
        }`}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) uploadMany(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="text-sm text-slate-300">
          {busy ? 'Uploading…' : 'Drop images here or click to upload'}
        </p>
        <p className="mt-1 text-xs text-slate-500">PNG, JPG, WebP, GIF · up to 10 MB each</p>
      </label>
      {err && <p className="mb-3 text-sm text-red-400">{err}</p>}
      {trade.screenshots.length === 0 ? (
        <p className="text-sm text-slate-500">No screenshots attached.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {trade.screenshots.map((sc) => (
            <div
              key={sc.id}
              className="group relative overflow-hidden rounded-lg border border-slate-800"
            >
              <a href={sc.url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={sc.url}
                  alt={`Screenshot ${sc.id}`}
                  className="aspect-video w-full bg-slate-800 object-cover transition group-hover:opacity-80"
                  loading="lazy"
                />
              </a>
              <button
                onClick={() => remove(sc.id)}
                className="absolute right-1.5 top-1.5 rounded bg-slate-900/80 px-2 py-0.5 text-xs text-slate-300 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                aria-label="Delete screenshot"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagsPanel({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<TagCategory>('setup');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addTag(trade.id, category, name.trim());
      setName('');
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add tag');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tagId: number) => {
    setErr(null);
    try {
      await api.removeTag(trade.id, tagId);
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to remove tag');
    }
  };

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Tags</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {trade.tags.length === 0 && (
          <span className="text-sm text-slate-500">No tags yet.</span>
        )}
        {trade.tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200"
          >
            <span className="text-slate-500">{tag.category}:</span>
            {tag.name}
            <button
              onClick={() => remove(tag.id)}
              className="text-slate-500 hover:text-red-400"
              aria-label="Remove tag"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="tag-cat">
            Category
          </label>
          <select
            id="tag-cat"
            className="input capitalize"
            value={category}
            onChange={(e) => setCategory(e.target.value as TagCategory)}
          >
            {TAG_CATEGORIES.map((c) => (
              <option key={c} value={c} className="capitalize">
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="tag-name">
            Name
          </label>
          <input
            id="tag-name"
            className="input w-full"
            value={name}
            placeholder="e.g. breakout"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <button className="btn" onClick={add} disabled={busy || !name.trim()}>
          Add
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  );
}

function NotesPanel({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [rules, setRules] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addNote(trade.id, body.trim(), rules ? 1 : 0);
      setBody('');
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to add note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        Notes ({trade.notes.length})
      </h2>
      <div className="mb-4 flex flex-col gap-3">
        {trade.notes.length === 0 && (
          <p className="text-sm text-slate-500">No notes yet.</p>
        )}
        {trade.notes.map((n) => (
          <div
            key={n.id}
            className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
          >
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>{formatDateTime(n.created_at)}</span>
              <span
                className={
                  n.rules_followed ? 'text-emerald-400' : 'text-amber-400'
                }
              >
                {n.rules_followed ? 'Rules followed' : 'Rules broken'}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-200">{n.body}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <textarea
          className="input min-h-[80px] w-full resize-y"
          placeholder="Write a note about this trade…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={rules}
              onChange={(e) => setRules(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800"
            />
            Rules followed
          </label>
          <button
            className="btn btn-primary"
            onClick={add}
            disabled={busy || !body.trim()}
          >
            Add Note
          </button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </div>
    </div>
  );
}
