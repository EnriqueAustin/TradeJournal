import { useState } from 'react';
import { api } from '../../api/client';
import { useFilters } from '../../store/FilterContext';
import type { TradeDetail as TTradeDetail } from '../../types';

const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
const gradeColor = (g: string, on: boolean) => {
  if (!on) return 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200';
  if (g === 'A' || g === 'B') return 'border-emerald-500 bg-emerald-500/15 text-emerald-300';
  if (g === 'C') return 'border-amber-500 bg-amber-500/15 text-amber-300';
  return 'border-red-500 bg-red-500/15 text-red-300';
};

// One-tap post-trade review: grade (stored as a 'grade' tag so Report Card and
// the Leak Finder keep working) + a followed-plan flag (trades.followed_plan,
// which drives the Dashboard discipline card). No note body required.
export default function ReviewPanel({
  trade,
  onChanged,
}: {
  trade: TTradeDetail;
  onChanged: () => void;
}) {
  const { setups } = useFilters();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gradeTag = trade.tags.find((t) => t.category === 'grade') ?? null;
  const grade = gradeTag?.name ?? null;
  const followed = trade.followed_plan;

  // Structured criteria for the trade's setup, scored per criterion.
  const setup = setups.find((s) => s.id === trade.setup_id) ?? null;
  const criteria: string[] = (() => {
    if (!setup?.criteria_json) return [];
    try {
      const a = JSON.parse(setup.criteria_json);
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  })();
  const metSet = new Set((trade.criteria ?? []).filter((c) => c.met).map((c) => c.criterion));
  const toggleCriterion = (criterion: string) =>
    run(() => api.setTradeCriterion(trade.id, criterion, !metSet.has(criterion)));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save review');
    } finally {
      setBusy(false);
    }
  };

  const setGrade = (g: string) =>
    run(async () => {
      // Grade is single-valued: drop any existing grade tag first.
      if (gradeTag) await api.removeTag(trade.id, gradeTag.id);
      if (g !== grade) await api.addTag(trade.id, 'grade', g);
    });

  const setFollowed = (v: 0 | 1 | null) =>
    run(() => api.patchTrade(trade.id, { followed_plan: v }));

  const beOverride = trade.be_override ?? null;
  const setBe = (v: 0 | 1 | null) => run(() => api.patchTrade(trade.id, { be_override: v }));

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Post-trade Review</h2>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div>
          <div className="label mb-1.5">Grade</div>
          <div className="flex gap-1.5">
            {GRADES.map((g) => (
              <button
                key={g}
                type="button"
                disabled={busy}
                onClick={() => setGrade(g)}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${gradeColor(
                  g,
                  grade === g
                )}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-1.5">Did you follow your plan?</div>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setFollowed(followed === 1 ? null : 1)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                followed === 1
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              ✓ Followed
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setFollowed(followed === 0 ? null : 0)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                followed === 0
                  ? 'border-red-500 bg-red-500/15 text-red-300'
                  : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              ✗ Broke plan
            </button>
          </div>
        </div>
        <div>
          <div className="label mb-1.5">
            Break-even{' '}
            <span className="font-normal normal-case text-slate-500">
              ({trade.is_be ? 'counted as BE' : 'counted as win/loss'})
            </span>
          </div>
          <div className="flex gap-1.5">
            {([
              [null, 'Auto'],
              [1, 'BE'],
              [0, 'Not BE'],
            ] as const).map(([v, label]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => setBe(v)}
                title={
                  v == null
                    ? "BE when P&L is $0 or |R| is within the account's BE band"
                    : undefined
                }
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  beOverride === v
                    ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300'
                    : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {err && <span className="text-sm text-red-400">{err}</span>}
      </div>

      {criteria.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1.5">
            {setup?.name} criteria{' '}
            <span className="text-slate-600">
              ({metSet.size}/{criteria.length} met)
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {criteria.map((c) => (
              <label
                key={c}
                className="flex cursor-pointer items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800"
                  checked={metSet.has(c)}
                  disabled={busy}
                  onChange={() => toggleCriterion(c)}
                />
                <span className={metSet.has(c) ? 'text-slate-200' : 'text-slate-400'}>{c}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Grade feeds the Report Card &amp; Leak Finder; the plan flag drives the
        Dashboard discipline trend. Tap an active choice again to clear it.
      </p>
    </div>
  );
}
