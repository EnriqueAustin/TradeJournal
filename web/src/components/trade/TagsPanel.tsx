import { useState } from 'react';
import { api } from '../../api/client';
import type { TradeDetail as TTradeDetail, TagCategory } from '../../types';

const TAG_CATEGORIES: TagCategory[] = [
  'setup',
  'session',
  'emotion',
  'mistake',
  'grade',
];

export default function TagsPanel({
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
