import { useState } from 'react';
import { api } from '../../../api/client';
import { useApi, filterKey } from '../../../hooks/useApi';
import type { EventReactionResponse, WindowStats } from '../../../types';
import { Panel, StatusBadge, TickerCell } from '../terminal';
import { fmtShortDate, useSignalTz } from '../lib/tz';

const EVENT_PRESETS = [
  'Non-Farm Employment Change',
  'CPI',
  'Core CPI',
  'Core PCE',
  'FOMC Statement',
  'GDP',
  'Retail Sales',
  'ISM Manufacturing',
  'Initial Jobless Claims',
  'PPI',
  'ADP Non-Farm',
  'Durable Goods',
];

type SegmentTab = 'all' | 'beat' | 'miss';

interface EventReactionPanelProps {
  instrument: string;
}

export default function EventReactionPanel({ instrument }: EventReactionPanelProps) {
  const [event, setEvent] = useState(EVENT_PRESETS[0]);
  const [segment, setSegment] = useState<SegmentTab>('all');
  const [customEvent, setCustomEvent] = useState('');
  const tz = useSignalTz();

  const activeEvent = customEvent || event;

  const { data, loading, error, reload } = useApi<EventReactionResponse>(
    () => api.getEventReaction(instrument, activeEvent),
    [filterKey(instrument, activeEvent)]
  );

  const stats: WindowStats[] =
    data
      ? segment === 'beat'
        ? data.byBeat
        : segment === 'miss'
          ? data.byMiss
          : data.stats
      : [];

  return (
    <Panel
      title="Event Reaction"
      tag="ECEV"
      span={6}
      right={
        <button className="sig-tab" onClick={reload} title="Refresh">
          ⟳
        </button>
      }
    >
      {/* event selector */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <select
          className="sig-select"
          value={customEvent ? '__custom__' : event}
          onChange={(e) => {
            if (e.target.value === '__custom__') return;
            setEvent(e.target.value);
            setCustomEvent('');
          }}
          style={{
            background: 'var(--sig-bg)',
            color: 'var(--sig-text)',
            border: '1px solid var(--sig-border)',
            fontSize: '11px',
            padding: '2px 4px',
            flex: 1,
            minWidth: '140px',
          }}
        >
          {EVENT_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Custom…"
          value={customEvent}
          onChange={(e) => setCustomEvent(e.target.value)}
          style={{
            background: 'var(--sig-bg)',
            color: 'var(--sig-text)',
            border: '1px solid var(--sig-border)',
            fontSize: '11px',
            padding: '2px 4px',
            width: '80px',
          }}
        />
      </div>

      {/* segment tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        {(['all', 'beat', 'miss'] as const).map((s) => (
          <button
            key={s}
            className={`sig-tab${segment === s ? ' is-active' : ''}`}
            onClick={() => setSegment(s)}
            style={{ fontSize: '10px', padding: '2px 6px', textTransform: 'uppercase' }}
          >
            {s}
          </button>
        ))}
        {data && (
          <span className="sig-muted" style={{ fontSize: '10px', marginLeft: 'auto', alignSelf: 'center' }}>
            n={data.sampleSize}
          </span>
        )}
      </div>

      {loading && <div className="sig-ph">Analyzing reactions…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No reaction data — need calendar + price history
        </div>
      )}

      {data && stats.length > 0 && (
        <>
          {/* summary stats table */}
          <table className="sig-table" style={{ fontSize: '11px', marginBottom: '8px' }}>
            <thead>
              <tr>
                <th>Window</th>
                <th className="sig-right">Avg Move</th>
                <th className="sig-right">Avg %</th>
                <th className="sig-right">Bias</th>
                <th className="sig-right">Up%</th>
                <th className="sig-right">n</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.window}>
                  <td style={{ fontWeight: 'bold' }}>{s.window}</td>
                  <td className="sig-right">
                    <TickerCell value={s.avgMove} dp={1} />
                  </td>
                  <td className="sig-right">
                    <TickerCell value={s.avgMovePct} dp={2} suffix="%" />
                  </td>
                  <td className="sig-right">
                    <TickerCell value={s.avgDirectionalMove} dp={1} signed colorize />
                  </td>
                  <td className="sig-right">
                    <span
                      style={{
                        color:
                          s.upPct > 60
                            ? 'var(--sig-green)'
                            : s.upPct < 40
                              ? 'var(--sig-red)'
                              : 'var(--sig-muted-text)',
                      }}
                    >
                      {s.upPct.toFixed(0)}%
                    </span>
                  </td>
                  <td className="sig-right sig-muted">{s.sampleSize}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* history table */}
          {data.history.length > 0 && (
            <div className="sig-scroll" style={{ maxHeight: '220px' }}>
              <table className="sig-table" style={{ fontSize: '10px' }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Act</th>
                    <th>Fcst</th>
                    <th>Surp</th>
                    {['5m', '15m', '30m', '60m', '1d'].map((w) => (
                      <th key={w} className="sig-right">
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h, i) => (
                    <tr key={i}>
                      <td className="sig-muted">
                        {fmtShortDate(h.eventDate, tz)}
                      </td>
                      <td>{h.actual ?? '—'}</td>
                      <td className="sig-muted">{h.consensus ?? '—'}</td>
                      <td>
                        {h.surprise && (
                          <StatusBadge
                            kind={
                              h.surprise === 'beat'
                                ? 'ok'
                                : h.surprise === 'miss'
                                  ? 'err'
                                  : 'muted'
                            }
                            label={h.surprise.toUpperCase()}
                          />
                        )}
                      </td>
                      {['5m', '15m', '30m', '60m', '1d'].map((w) => (
                        <td key={w} className="sig-right">
                          {h.moves[w] != null ? (
                            <TickerCell value={h.moves[w]} dp={1} signed colorize />
                          ) : (
                            <span className="sig-muted">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {data && data.sampleSize === 0 && (
        <div className="sig-ph">
          No historical reactions for "{activeEvent}" — need past events with actuals + price data
        </div>
      )}
    </Panel>
  );
}
