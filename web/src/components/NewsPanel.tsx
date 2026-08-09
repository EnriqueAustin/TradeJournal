import type { NewsEvent, NewsStatus, NewsImpact } from '../types';
import { IMPACT_COLOR } from '../utils/news';
import { formatDateTime } from '../utils/format';

const IMPACT_LABEL: Record<NewsImpact, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
  holiday: 'Hol',
};

function ImpactDot({ impact }: { impact: NewsImpact }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: IMPACT_COLOR[impact] }}
      title={IMPACT_LABEL[impact]}
    />
  );
}

// Compact economic-calendar list scoped to a trade's chart window. Highlights
// events that land while the position was open.
export default function NewsPanel({
  events,
  status,
  onRefresh,
  refreshing,
  entryTime,
  exitTime,
  emptyHint,
}: {
  events: NewsEvent[];
  status?: NewsStatus | null;
  onRefresh: () => void;
  refreshing: boolean;
  entryTime?: string | null;
  exitTime?: string | null;
  emptyHint?: string;
}) {
  const open = entryTime ? new Date(entryTime).getTime() : null;
  const close = exitTime ? new Date(exitTime).getTime() : null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Economic Calendar</h2>
        <button
          className="btn text-xs"
          onClick={onRefresh}
          disabled={refreshing}
          title="Pull the latest ForexFactory feed (last / this / next week)"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh feed'}
        </button>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-slate-500">
          {emptyHint ??
            'No events in this chart window. Refresh the feed — ForexFactory covers roughly last, this and next week.'}
        </p>
      ) : (
        <div className="max-h-[280px] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {events.map((e) => {
                const t = new Date(e.dt).getTime();
                const duringTrade =
                  open != null && close != null && t >= open && t <= close;
                return (
                  <tr
                    key={e.id}
                    className={`border-t border-slate-800/60 ${
                      duringTrade ? 'bg-amber-950/20' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-2 align-top">
                      <ImpactDot impact={e.impact} />
                    </td>
                    <td className="num py-1.5 pr-3 align-top whitespace-nowrap text-xs text-slate-400">
                      {formatDateTime(e.dt)}
                    </td>
                    <td className="py-1.5 pr-2 align-top text-xs font-semibold text-slate-300">
                      {e.currency}
                    </td>
                    <td className="py-1.5 align-top text-slate-200">
                      {e.title}
                      {duringTrade && (
                        <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                          during trade
                        </span>
                      )}
                      {(e.forecast || e.previous || e.actual) && (
                        <span className="num ml-2 text-[11px] text-slate-500">
                          {e.actual ? `act ${e.actual}` : ''}
                          {e.forecast ? ` · fc ${e.forecast}` : ''}
                          {e.previous ? ` · prev ${e.previous}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {status && status.last_refresh && (
        <p className="mt-2 text-[11px] text-slate-600">
          {status.count} events cached · updated {formatDateTime(status.last_refresh)}
        </p>
      )}
    </div>
  );
}
