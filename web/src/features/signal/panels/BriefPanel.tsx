import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { BriefResponse } from '../../../types';
import { Panel, StatusBadge } from '../terminal';

interface Props {
  instrument: string;
}

export default function BriefPanel({ instrument }: Props) {
  const { data, loading, error, reload } = useApi<BriefResponse>(
    () => api.getBrief(instrument),
    [instrument]
  );

  return (
    <Panel
      title={`${instrument} · Daily Brief`}
      tag="AI"
      span={6}
      right={
        <button className="sig-tab" onClick={reload} title="Regenerate">
          ⟳
        </button>
      }
    >
      {loading && <div className="sig-ph">Generating brief…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          Brief unavailable
        </div>
      )}
      {data && (
        <>
          {data.content ? (
            <div className="sig-brief-content">
              {data.content.split('\n').map((line, i) => (
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
            {new Date(data.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {' · '}
            <StatusBadge kind={data.content ? 'ok' : 'warn'} label={data.content ? 'OK' : 'NO DATA'} />
          </div>
        </>
      )}
    </Panel>
  );
}
