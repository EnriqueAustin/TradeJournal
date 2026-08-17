import { useState } from 'react';
import { api } from '../../../api/client';
import { useApi, filterKey } from '../../../hooks/useApi';
import type { NewsResponse, NewsSummary } from '../../../types';
import { Panel, StatusBadge } from '../terminal';
import { fmtTime, useSignalTz } from '../lib/tz';

type InstrumentFilter = 'all' | 'XAUUSD' | 'US100';
type SentimentFilter = 'all' | 'bullish' | 'bearish' | 'neutral';

function sentimentDot(val: number | null): { color: string; label: string } {
  if (val == null) return { color: 'var(--sig-muted-text)', label: '—' };
  if (val > 0.2) return { color: 'var(--sig-green)', label: `+${val.toFixed(2)}` };
  if (val < -0.2) return { color: 'var(--sig-red)', label: val.toFixed(2) };
  return { color: 'var(--sig-amber)', label: val.toFixed(2) };
}

function netSentimentLabel(summary: NewsSummary | null): { text: string; color: string } {
  if (!summary || summary.total24h === 0) return { text: 'NO DATA', color: 'var(--sig-muted-text)' };
  const net = summary.bullish - summary.bearish;
  if (net > 2) return { text: `BULLISH (${summary.bullish}↑ ${summary.bearish}↓)`, color: 'var(--sig-green)' };
  if (net < -2) return { text: `BEARISH (${summary.bullish}↑ ${summary.bearish}↓)`, color: 'var(--sig-red)' };
  return { text: `MIXED (${summary.bullish}↑ ${summary.bearish}↓)`, color: 'var(--sig-amber)' };
}

export default function NewsFeedPanel({ instrument: _instrument }: { instrument: string }) {
  const [filter, setFilter] = useState<InstrumentFilter>('all');
  const [sentiment, setSentiment] = useState<SentimentFilter>('all');
  const [limit, setLimit] = useState(30);
  const tz = useSignalTz();

  const effectiveInst = filter === 'all' ? undefined : filter;
  const effectiveSent = sentiment === 'all' ? undefined : sentiment;

  const { data, loading, error, reload } = useApi<NewsResponse>(
    () => api.getNewsFeed({ instrument: effectiveInst, limit, sentiment: effectiveSent }),
    [filterKey(filter), filterKey(sentiment), filterKey(limit)]
  );

  const { data: summary } = useApi<NewsSummary>(
    () => api.getNewsSummary(),
    []
  );

  const netLabel = netSentimentLabel(summary);

  const instFilters: InstrumentFilter[] = ['all', 'XAUUSD', 'US100'];
  const sentFilters: SentimentFilter[] = ['all', 'bullish', 'bearish', 'neutral'];

  return (
    <Panel
      title="News Feed"
      tag="N/TOP"
      span={12}
      right={
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <StatusBadge
            kind={summary && summary.total24h > 0 ? 'ok' : 'muted'}
            label={summary ? `${summary.total24h} / 24h` : '…'}
          />
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </div>
      }
    >
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {instFilters.map((f) => (
            <button
              key={f}
              className={`sig-tab${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
              style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
            >
              {f === 'all' ? 'ALL' : f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {sentFilters.map((f) => (
            <button
              key={f}
              className={`sig-tab${sentiment === f ? ' is-active' : ''}`}
              onClick={() => setSentiment(f)}
              style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '0.7rem', color: netLabel.color, fontWeight: 700 }}>
          {netLabel.text}
        </span>
      </div>

      {loading && <div className="sig-ph">Loading news…</div>}
      {error && <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>Failed to load news</div>}

      {data && data.items.length === 0 && (
        <div className="sig-ph">No news items — trigger ingest first</div>
      )}

      {data && data.items.length > 0 && (
        <div style={{ maxHeight: '22rem', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sig-border)', color: 'var(--sig-muted-text)', textAlign: 'left' }}>
                <th style={{ padding: '0.2rem 0.4rem', width: '5.5rem' }}>TIME</th>
                <th style={{ padding: '0.2rem 0.4rem', width: '5rem' }}>SOURCE</th>
                <th style={{ padding: '0.2rem 0.4rem' }}>HEADLINE</th>
                <th style={{ padding: '0.2rem 0.4rem', width: '3.5rem' }}>INST</th>
                <th style={{ padding: '0.2rem 0.4rem', width: '3rem', textAlign: 'right' }}>SENT</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const dot = sentimentDot(item.sentiment);
                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid var(--sig-border)',
                      lineHeight: 1.3,
                    }}
                  >
                    <td style={{ padding: '0.25rem 0.4rem', color: 'var(--sig-muted-text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtTime(item.ts, tz)}
                    </td>
                    <td style={{ padding: '0.25rem 0.4rem', color: 'var(--sig-cyan)', fontSize: '0.65rem' }}>
                      {item.source?.toUpperCase() ?? '—'}
                    </td>
                    <td style={{ padding: '0.25rem 0.4rem' }}>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--sig-text)', textDecoration: 'none' }}
                          title={item.headline ?? ''}
                        >
                          {item.headline}
                        </a>
                      ) : (
                        item.headline
                      )}
                    </td>
                    <td style={{ padding: '0.25rem 0.4rem', fontSize: '0.6rem', color: 'var(--sig-amber)' }}>
                      {item.instruments ?? '—'}
                    </td>
                    <td style={{ padding: '0.25rem 0.4rem', textAlign: 'right' }}>
                      <span
                        title={dot.label}
                        style={{
                          display: 'inline-block',
                          width: '0.55rem',
                          height: '0.55rem',
                          borderRadius: '50%',
                          background: dot.color,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.items.length >= limit && (
        <button
          className="sig-tab"
          onClick={() => setLimit((n) => n + 30)}
          style={{ marginTop: '0.3rem', fontSize: '0.65rem' }}
        >
          Load more…
        </button>
      )}

      {/* Footer */}
      <div style={{ marginTop: '0.4rem', fontSize: '0.6rem', color: 'var(--sig-muted-text)', display: 'flex', gap: '1rem' }}>
        <span>
          Last ingest: {summary?.lastIngest ? fmtTime(summary.lastIngest, tz) : 'never'}
        </span>
        {summary?.topSources && summary.topSources.length > 0 && (
          <span>
            Sources: {summary.topSources.map((s) => `${s.source}(${s.count})`).join(' · ')}
          </span>
        )}
      </div>
    </Panel>
  );
}
