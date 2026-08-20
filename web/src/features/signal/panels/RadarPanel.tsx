import { useEffect } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RadarResponse, RadarSeverity } from '../../../types';
import { Panel } from '../terminal';

// Colour + glyph per severity. 'hot' = act now, 'warn' = caution, 'info' = context.
const SEV: Record<RadarSeverity, { color: string; glyph: string; label: string }> = {
  hot: { color: 'var(--sig-red)', glyph: '●', label: 'HOT' },
  warn: { color: 'var(--sig-amber)', glyph: '▲', label: 'WARN' },
  info: { color: 'var(--sig-muted)', glyph: '·', label: 'INFO' },
};

// Live "Setup Radar" — evaluates the current tape against what a Wicks-Don't-Lie
// session scalper watches (session opens, key-level proximity, ADR exhaustion,
// fresh sweeps) and lists prioritized signals. Auto-refreshes on an interval.
export default function RadarPanel({ instrument }: { instrument: string }) {
  const { data, loading, error, reload } = useApi<RadarResponse>(
    () => api.getRadar(instrument),
    [instrument]
  );

  // Poll every 30s so the board tracks the live tape without a manual refresh.
  useEffect(() => {
    const id = setInterval(reload, 30000);
    return () => clearInterval(id);
  }, [reload]);

  const signals = data?.signals ?? [];
  const hot = signals.filter((s) => s.severity === 'hot').length;

  return (
    <Panel
      title="Setup Radar"
      tag={`${instrument} · live${data?.session && data.session !== 'off' ? ` · ${data.session}` : ''}`}
      span={8}
      right={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hot > 0 && (
            <span
              style={{
                color: 'var(--sig-red)', fontWeight: 700, fontSize: 10,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}
            >
              {hot} live
            </span>
          )}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </span>
      }
    >
      {loading && !data && <div className="sig-ph">Scanning the tape…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No M1 data — run OANDA ingest
        </div>
      )}
      {data && signals.length === 0 && !loading && (
        <div className="sig-ph">
          Quiet tape — no setups near. Price {data.price ?? '—'}
          {data.adr != null && ` · ADR ${data.adr}`}
        </div>
      )}
      {signals.length > 0 && (
        <div className="sig-scroll" style={{ maxHeight: 300 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 0' }}>
            {signals.map((s, i) => {
              const sev = SEV[s.severity];
              return (
                <div
                  key={`${s.kind}-${s.title}-${i}`}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 8,
                    padding: '6px 8px', borderRadius: 4,
                    background: 'var(--sig-panel-2, rgba(255,255,255,0.03))',
                    borderLeft: `2px solid ${sev.color}`,
                  }}
                >
                  <span style={{ color: sev.color, fontSize: 11, lineHeight: '16px' }}>
                    {sev.glyph}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        color: sev.color, fontWeight: 700, fontSize: 11,
                        textTransform: 'uppercase', letterSpacing: 0.3,
                      }}
                    >
                      {s.title}
                    </div>
                    <div className="sig-muted" style={{ fontSize: 11, marginTop: 1 }}>
                      {s.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
