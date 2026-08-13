import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { RealYieldOverlayResponse } from '../../../types';
import { Panel, StatusBadge } from '../terminal';
import type { BadgeKind } from '../terminal';

function corrBadge(corr: number | null): { kind: BadgeKind; label: string } {
  if (corr == null) return { kind: 'muted', label: 'N/A' };
  const abs = Math.abs(corr);
  if (abs >= 0.6) return { kind: 'ok', label: `CORR ${corr.toFixed(2)}` };
  if (abs >= 0.4) return { kind: 'warn', label: `CORR ${corr.toFixed(2)}` };
  return { kind: 'err', label: `DIVERGENCE ${corr.toFixed(2)}` };
}

function OverlayChart({ data }: { data: RealYieldOverlayResponse }) {
  const W = 520, H = 180, PAD_L = 50, PAD_R = 50, PAD_T = 10, PAD_B = 20;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  if (!data.gold.length || !data.realYield.length) return <div className="sig-ph">No overlay data</div>;

  const goldMin = Math.min(...data.gold.map(g => g.c));
  const goldMax = Math.max(...data.gold.map(g => g.c));
  const ryMin = Math.min(...data.realYield.map(r => r.value));
  const ryMax = Math.max(...data.realYield.map(r => r.value));
  const goldRange = goldMax - goldMin || 1;
  const ryRange = ryMax - ryMin || 0.01;

  const tsMin = Math.min(data.gold[0]?.ts ?? 0, data.realYield[0]?.ts ?? 0);
  const tsMax = Math.max(data.gold[data.gold.length - 1]?.ts ?? 1, data.realYield[data.realYield.length - 1]?.ts ?? 1);
  const tsRange = tsMax - tsMin || 1;

  const goldPath = data.gold.map((g, i) => {
    const x = PAD_L + ((g.ts - tsMin) / tsRange) * plotW;
    const y = PAD_T + plotH - ((g.c - goldMin) / goldRange) * plotH;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Inverted real yield (flip axis)
  const ryPath = data.realYield.map((r, i) => {
    const x = PAD_L + ((r.ts - tsMin) / tsRange) * plotW;
    const y = PAD_T + ((r.value - ryMin) / ryRange) * plotH; // inverted: high real yield → bottom
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * f} y2={PAD_T + plotH * f}
          stroke="var(--sig-border)" strokeDasharray="2,3" />
      ))}
      {/* Gold line (amber) */}
      <path d={goldPath} fill="none" stroke="var(--sig-amber)" strokeWidth={1.5} />
      {/* Inverted Real Yield line (cyan) */}
      <path d={ryPath} fill="none" stroke="var(--sig-cyan)" strokeWidth={1.5} strokeDasharray="4,2" />
      {/* Left axis label (Gold) */}
      <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fill="var(--sig-amber)" fontSize={8}>{goldMax.toFixed(0)}</text>
      <text x={PAD_L - 4} y={PAD_T + plotH} textAnchor="end" fill="var(--sig-amber)" fontSize={8}>{goldMin.toFixed(0)}</text>
      {/* Right axis label (Real Yield inverted) */}
      <text x={W - PAD_R + 4} y={PAD_T + 4} textAnchor="start" fill="var(--sig-cyan)" fontSize={8}>{ryMin.toFixed(2)}%</text>
      <text x={W - PAD_R + 4} y={PAD_T + plotH} textAnchor="start" fill="var(--sig-cyan)" fontSize={8}>{ryMax.toFixed(2)}%</text>
      {/* Legend */}
      <line x1={PAD_L} x2={PAD_L + 16} y1={H - 4} y2={H - 4} stroke="var(--sig-amber)" strokeWidth={1.5} />
      <text x={PAD_L + 20} y={H - 1} fill="var(--sig-amber)" fontSize={8}>GOLD</text>
      <line x1={PAD_L + 56} x2={PAD_L + 72} y1={H - 4} y2={H - 4} stroke="var(--sig-cyan)" strokeWidth={1.5} strokeDasharray="4,2" />
      <text x={PAD_L + 76} y={H - 1} fill="var(--sig-cyan)" fontSize={8}>-DFII10 (inv)</text>
    </svg>
  );
}

export default function RealYieldOverlay() {
  const { data, loading, error, reload } = useApi<RealYieldOverlayResponse>(
    () => api.getRealYieldOverlay(),
    []
  );

  const badge = data ? corrBadge(data.correlation60d) : null;

  return (
    <Panel
      title="Gold × Real Yield"
      tag="OVERLAY"
      span={6}
      right={
        <>
          {badge && <StatusBadge kind={badge.kind} label={badge.label} />}
          <button className="sig-tab" onClick={reload} title="Refresh">⟳</button>
        </>
      }
    >
      {loading && <div className="sig-ph">Loading overlay…</div>}
      {error && (
        <div className="sig-ph" style={{ color: 'var(--sig-red)' }}>
          No overlay data — run ingest first
        </div>
      )}
      {data && <OverlayChart data={data} />}
    </Panel>
  );
}
