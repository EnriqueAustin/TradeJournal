import { useState } from 'react';
import { api } from '../../../api/client';
import { useApi, filterKey } from '../../../hooks/useApi';
import type { BriefResponse } from '../../../types';
import { Panel, StatusBadge } from '../terminal';
import { useSignalTz } from '../lib/tz';

type BriefMode = 'basic' | 'enhanced';

interface Props {
  instrument: string;
}

function renderEnhancedContent(content: string) {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      return (
        <div
          key={i}
          style={{
            fontWeight: 700,
            color: 'var(--sig-amber)',
            borderBottom: '1px solid var(--sig-border)',
            marginTop: i > 0 ? '0.6rem' : 0,
            paddingBottom: '0.15rem',
            marginBottom: '0.25rem',
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {trimmed.slice(3)}
        </div>
      );
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || /^\d+\.\s/.test(trimmed)) {
      return (
        <p key={i} className="sig-brief-bullet">
          {trimmed}
        </p>
      );
    }
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      return (
        <p key={i} style={{ fontWeight: 700, color: 'var(--sig-text)' }}>
          {trimmed.slice(2, -2)}
        </p>
      );
    }
    if (!trimmed) return null;
    return <p key={i}>{trimmed}</p>;
  });
}

export default function BriefPanel({ instrument }: Props) {
  const [mode, setMode] = useState<BriefMode>('basic');
  const tz = useSignalTz();
  const { data, loading, error, reload } = useApi<BriefResponse>(
    () => api.getBrief(instrument, mode === 'enhanced' ? 'enhanced' : undefined),
    [instrument, filterKey(mode)]
  );

  return (
    <Panel
      title={`${instrument} · Daily Brief`}
      tag="AI"
      span={6}
      right={
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <button
            className={`sig-tab${mode === 'basic' ? ' is-active' : ''}`}
            onClick={() => setMode('basic')}
            style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}
          >
            QUICK
          </button>
          <button
            className={`sig-tab${mode === 'enhanced' ? ' is-active' : ''}`}
            onClick={() => setMode('enhanced')}
            style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}
          >
            FULL
          </button>
          <button className="sig-tab" onClick={reload} title="Regenerate">
            ⟳
          </button>
        </div>
      }
    >
      {loading && <div className="sig-ph">{mode === 'enhanced' ? 'Generating enhanced brief…' : 'Generating brief…'}</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          Brief unavailable
        </div>
      )}
      {data && (
        <>
          {data.content ? (
            <div className="sig-brief-content" style={{ maxHeight: mode === 'enhanced' ? '24rem' : undefined, overflowY: mode === 'enhanced' ? 'auto' : undefined }}>
              {mode === 'enhanced'
                ? renderEnhancedContent(data.content)
                : data.content.split('\n').map((line, i) => (
                    <p key={i} className={line.trim().startsWith('-') || line.trim().startsWith('•') ? 'sig-brief-bullet' : ''}>
                      {line}
                    </p>
                  ))}
            </div>
          ) : (
            <div className="sig-ph">
              {data.error ?? 'No brief available — check AI config'}
            </div>
          )}
          <div className="sig-muted" style={{ fontSize: '9px', marginTop: '6px' }}>
            {data.model && <span>{data.model} · </span>}
            {data.cached ? 'cached' : 'fresh'} ·{' '}
            {(data as Record<string, unknown>).briefType === 'enhanced' ? 'enhanced · ' : ''}
            {new Date(data.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: tz,
            })}
            {' · '}
            <StatusBadge kind={data.content ? 'ok' : 'warn'} label={data.content ? 'OK' : 'NO DATA'} />
          </div>
        </>
      )}
    </Panel>
  );
}
