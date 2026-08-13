import { useState, useEffect } from 'react';
import { api } from '../../../api/client';
import { useApi, filterKey } from '../../../hooks/useApi';
import type { CalendarResponse, CalendarEvent, UpcomingResponse } from '../../../types';
import { Panel, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';

const IMPACT_DOT: Record<string, string> = {
  high: 'var(--sig-red)',
  medium: 'var(--sig-amber)',
  low: 'var(--sig-green)',
  holiday: 'var(--sig-cyan)',
};

const SURPRISE_COLOR: Record<string, string> = {
  beat: 'var(--sig-green)',
  miss: 'var(--sig-red)',
  inline: 'var(--sig-muted-text)',
};

type ImpactFilter = 'all' | 'high' | 'high,medium';

const RISK_BADGE: Record<string, { kind: BadgeKind; label: string }> = {
  clear: { kind: 'ok', label: 'CLEAR' },
  approaching: { kind: 'warn', label: 'EVENT APPROACHING' },
  imminent: { kind: 'err', label: 'IMMINENT' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 16) + ' UTC';
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function classifySurprise(e: CalendarEvent): 'beat' | 'miss' | 'inline' | null {
  if (e.actual == null || e.consensus == null) return null;
  const diff = e.actual - e.consensus;
  const inverted = /unemployment|claims|jobless/i.test(e.name);
  const eff = inverted ? -diff : diff;
  const threshold = Math.abs(e.consensus) * 0.02 || 0.1;
  if (Math.abs(diff) < threshold) return 'inline';
  return eff > 0 ? 'beat' : 'miss';
}

export default function CalendarPanel() {
  const [impact, setImpact] = useState<ImpactFilter>('high,medium');
  const [, setTick] = useState(0);

  const { data, loading, error, reload } = useApi<CalendarResponse>(
    () => api.getResearchCalendar(impact === 'all' ? undefined : impact),
    [filterKey(impact)]
  );

  const { data: upcoming } = useApi<UpcomingResponse>(
    () => api.getUpcomingEvents(24),
    []
  );

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const riskInfo = upcoming ? RISK_BADGE[upcoming.riskLevel] : RISK_BADGE.clear;

  let groupedDates: string[] = [];
  const byDate = new Map<string, CalendarEvent[]>();
  if (data) {
    for (const e of data.events) {
      const dk = new Date(e.ts).toISOString().slice(0, 10);
      if (!byDate.has(dk)) {
        byDate.set(dk, []);
        groupedDates.push(dk);
      }
      byDate.get(dk)!.push(e);
    }
  }

  return (
    <Panel
      title="Economic Calendar"
      tag="ECO"
      span={6}
      right={
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <StatusBadge kind={riskInfo.kind} label={riskInfo.label} />
          <button className="sig-tab" onClick={reload} title="Refresh">
            ⟳
          </button>
        </div>
      }
    >
      {/* impact filter */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        {([['all', 'ALL'], ['high,medium', 'H+M'], ['high', 'HIGH']] as const).map(
          ([val, label]) => (
            <button
              key={val}
              className={`sig-tab${impact === val ? ' is-active' : ''}`}
              onClick={() => setImpact(val as ImpactFilter)}
              style={{ fontSize: '10px', padding: '2px 6px' }}
            >
              {label}
            </button>
          )
        )}
      </div>

      {loading && <div className="sig-ph">Loading calendar…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No calendar data — run POST /ingest/calendar
        </div>
      )}

      {data && data.events.length > 0 && (
        <div className="sig-scroll" style={{ maxHeight: '400px' }}>
          {groupedDates.map((dk) => {
            const dayEvents = byDate.get(dk)!;
            const isToday = dk === new Date().toISOString().slice(0, 10);
            return (
              <div key={dk} style={{ marginBottom: '8px' }}>
                <div
                  className="sig-muted"
                  style={{
                    fontSize: '10px',
                    fontWeight: 'bold',
                    borderBottom: '1px solid var(--sig-border)',
                    paddingBottom: '2px',
                    marginBottom: '4px',
                    color: isToday ? 'var(--sig-amber)' : undefined,
                  }}
                >
                  {formatDate(dayEvents[0].ts)}
                  {isToday && ' · TODAY'}
                </div>
                <table className="sig-table" style={{ fontSize: '11px' }}>
                  <tbody>
                    {dayEvents.map((e) => {
                      const surprise = classifySurprise(e);
                      return (
                        <tr
                          key={e.id}
                          style={{ opacity: e.isPast ? 0.6 : 1 }}
                        >
                          <td style={{ width: '60px', whiteSpace: 'nowrap' }}>
                            {formatTime(e.ts)}
                          </td>
                          <td style={{ width: '16px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: IMPACT_DOT[e.impact] || IMPACT_DOT.low,
                              }}
                            />
                          </td>
                          <td style={{ width: '30px', fontSize: '10px' }}>
                            {e.country}
                          </td>
                          <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.name}
                          </td>
                          <td className="sig-right" style={{ width: '50px', color: 'var(--sig-muted-text)' }}>
                            {e.consensus != null ? e.consensus : '—'}
                          </td>
                          <td className="sig-right" style={{ width: '50px', color: 'var(--sig-muted-text)' }}>
                            {e.prior != null ? e.prior : '—'}
                          </td>
                          <td
                            className="sig-right"
                            style={{
                              width: '50px',
                              color: surprise ? SURPRISE_COLOR[surprise] : 'var(--sig-text)',
                              fontWeight: surprise && surprise !== 'inline' ? 'bold' : undefined,
                            }}
                          >
                            {e.actual != null ? e.actual : '—'}
                          </td>
                          <td style={{ width: '55px', textAlign: 'right', fontSize: '10px', color: 'var(--sig-amber)' }}>
                            {e.countdown || ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {data && data.events.length === 0 && (
        <div className="sig-ph">No events in range — run POST /ingest/calendar</div>
      )}

      {data && (
        <div className="sig-muted" style={{ fontSize: '10px', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {data.count} events · Fcst | Prior | Act
          </span>
          <StatusBadge
            kind={data.freshness.status === 'ok' ? 'ok' : 'warn'}
            label={data.freshness.status === 'ok' ? 'FRESH' : data.freshness.status}
          />
        </div>
      )}
    </Panel>
  );
}
