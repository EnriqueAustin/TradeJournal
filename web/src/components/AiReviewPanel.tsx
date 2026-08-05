import { useState } from 'react';
import { api } from '../api/client';
import { useFilters } from '../store/FilterContext';
import type { AiReview } from '../types';
import { Spinner } from './states';

export default function AiReviewPanel() {
  const { filters } = useFilters();
  const [review, setReview] = useState<AiReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (filters.account != null) body.account = filters.account;
      if (filters.instrument !== 'All') body.instrument = filters.instrument;
      if (filters.session !== 'All') body.session = filters.session;
      if (filters.setup !== 'All') body.setup = filters.setup;
      if (filters.from) body.from = filters.from;
      if (filters.to) body.to = filters.to;
      const res = await api.aiReview(body);
      setReview(res);
    } catch (e: any) {
      setError(e?.message || 'AI review failed');
    } finally {
      setLoading(false);
    }
  };

  const period =
    filters.from || filters.to
      ? `${filters.from || '…'} → ${filters.to || '…'}`
      : 'all available history';

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">AI Review</h2>
          <p className="text-xs text-slate-500">
            Coaching review of {period} using the current filters.
          </p>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? (
            <>
              <Spinner className="h-4 w-4" /> Reviewing…
            </>
          ) : review ? (
            'Re-run review'
          ) : (
            'Run AI review'
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!review && !error && !loading && (
        <p className="text-sm text-slate-500">
          Click “Run AI review” to summarize this period’s trades, notes and
          patterns.
        </p>
      )}

      {review && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Summary
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-200">
              {review.summary}
            </p>
          </div>

          {review.patterns.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Patterns
              </div>
              <ul className="flex flex-col gap-1.5">
                {review.patterns.map((p, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-slate-300"
                  >
                    <span className="text-indigo-400">◆</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.suggestions.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Suggestions
              </div>
              <ul className="flex flex-col gap-1.5">
                {review.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
