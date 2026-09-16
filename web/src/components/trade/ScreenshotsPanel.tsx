import { useState } from 'react';
import { api } from '../../api/client';
import type { TradeDetail as TTradeDetail } from '../../types';

export default function ScreenshotsPanel({
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
            ? 'border-cyan-400 bg-cyan-500/5'
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
