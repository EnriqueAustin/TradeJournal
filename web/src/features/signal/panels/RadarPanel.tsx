import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RadarResponse, RadarSeverity } from '../../../types';
import { Panel } from '../terminal';
import { useSetupAlerts, type AlertMode } from '../lib/useSetupAlerts';

// Colour + glyph per severity. 'hot' = act now, 'warn' = caution, 'info' = context.
const SEV: Record<RadarSeverity, { color: string; glyph: string; label: string }> = {
  hot: { color: 'var(--sig-red)', glyph: '●', label: 'HOT' },
  warn: { color: 'var(--sig-amber)', glyph: '▲', label: 'WARN' },
  info: { color: 'var(--sig-muted)', glyph: '·', label: 'INFO' },
};

const MODE_LABEL: Record<AlertMode, string> = {
  confirmed: 'Confirmed only',
  hot: 'All HOT',
  all: 'HOT + WARN',
};

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

// Live "Setup Radar" — evaluates the current tape against what a Wicks-Don't-Lie
// session scalper watches (session opens, key-level proximity, ADR exhaustion,
// fresh sweeps) and lists prioritized signals. Auto-refreshes on an interval and
// delivers newly-fired actionable signals as browser notifications (useSetupAlerts).
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

  const alerts = useSetupAlerts(data ?? undefined, instrument);
  const [showLog, setShowLog] = useState(false);

  const signals = data?.signals ?? [];
  const hot = signals.filter((s) => s.severity === 'hot').length;

  const armed = alerts.cfg.enabled && alerts.perm === 'granted';
  const bellColor = armed ? 'var(--sig-green)' : 'var(--sig-muted)';

  return (
    <Panel
      title="Setup Radar"
      tag={`${instrument} · live${data?.session && data.session !== 'off' ? ` · ${data.session}` : ''}`}
      span={8}
      right={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
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
          {/* Alert bell — click to open the delivery controls + fired-alert log. */}
          <button
            className="sig-tab"
            title="Alerts"
            onClick={() => {
              setShowLog((v) => !v);
              alerts.clearUnseen();
            }}
            style={{ color: bellColor, position: 'relative' }}
          >
            {armed ? '🔔' : '🔕'}
            {alerts.unseen > 0 && (
              <span
                style={{
                  position: 'absolute', top: -4, right: -4, minWidth: 14, height: 14,
                  padding: '0 3px', borderRadius: 7, background: 'var(--sig-red)',
                  color: '#000', fontSize: 9, fontWeight: 700, lineHeight: '14px',
                }}
              >
                {alerts.unseen}
              </span>
            )}
          </button>
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>

          {showLog && (
            <div
              style={{
                position: 'absolute', top: 24, right: 0, zIndex: 20, width: 320,
                background: 'var(--sig-panel, #0d0d0d)', border: '1px solid var(--sig-border, #222)',
                borderRadius: 6, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}
            >
              {/* Delivery controls */}
              {alerts.perm !== 'granted' ? (
                <button
                  className="sig-tab"
                  onClick={alerts.requestPermission}
                  style={{ width: '100%', marginBottom: 8, color: 'var(--sig-green)' }}
                >
                  {alerts.perm === 'denied'
                    ? 'Notifications blocked — enable in browser'
                    : 'Enable browser notifications'}
                </button>
              ) : (
                <label
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 11, marginBottom: 6,
                  }}
                >
                  <span className="sig-muted">Alerts armed</span>
                  <input
                    type="checkbox"
                    checked={alerts.cfg.enabled}
                    onChange={(e) => alerts.setEnabled(e.target.checked)}
                  />
                </label>
              )}
              <label
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 11, marginBottom: 6,
                }}
              >
                <span className="sig-muted">Sound</span>
                <input
                  type="checkbox"
                  checked={alerts.cfg.sound}
                  onChange={(e) => alerts.setSound(e.target.checked)}
                />
              </label>
              <label
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 11, marginBottom: 8,
                }}
              >
                <span className="sig-muted">Fire on</span>
                <select
                  value={alerts.cfg.mode}
                  onChange={(e) => alerts.setMode(e.target.value as AlertMode)}
                  className="sig-tab"
                  style={{ fontSize: 11 }}
                >
                  {(['confirmed', 'hot', 'all'] as AlertMode[]).map((m) => (
                    <option key={m} value={m}>{MODE_LABEL[m]}</option>
                  ))}
                </select>
              </label>

              {/* Fired-alert log */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderTop: '1px solid var(--sig-border, #222)', paddingTop: 6, marginBottom: 4,
                }}
              >
                <span className="sig-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Fired ({alerts.log.length})
                </span>
                {alerts.log.length > 0 && (
                  <button className="sig-tab" style={{ fontSize: 10 }} onClick={alerts.clearLog}>
                    clear
                  </button>
                )}
              </div>
              {alerts.log.length === 0 ? (
                <div className="sig-muted" style={{ fontSize: 11 }}>No alerts fired yet.</div>
              ) : (
                <div className="sig-scroll" style={{ maxHeight: 200 }}>
                  {alerts.log.map((a) => {
                    const sev = SEV[a.severity];
                    return (
                      <div key={`${a.key}-${a.ts}`} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ color: sev.color, fontSize: 10, fontWeight: 700 }}>{a.title}</span>
                          <span className="sig-muted" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>{timeAgo(a.ts)}</span>
                        </div>
                        <div className="sig-muted" style={{ fontSize: 10 }}>{a.detail}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
