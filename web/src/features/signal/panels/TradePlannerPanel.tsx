import { useState, useMemo, useEffect } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import type { LevelsResponse, KeyLevel } from '../../../types';
import { Panel } from '../terminal';

// USD value of a 1.00 price move per 1.0 lot. Gold: 100 oz/lot × $1 = $100.
// US100 is broker-dependent; 1.0 is a neutral placeholder.
const POINT_VALUE: Record<string, number> = { XAUUSD: 100, US100: 1 };
const PLANNER_KEY = 'sig-planner-cfg';

type Dir = 'long' | 'short';

interface Cfg {
  account: number;
  riskPct: number;
}

function loadCfg(): Cfg {
  try {
    const raw = localStorage.getItem(PLANNER_KEY);
    if (raw) return JSON.parse(raw) as Cfg;
  } catch { /* ignore */ }
  return { account: 10000, riskPct: 1 };
}

function NumField({
  label, value, onChange, step = 1, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <span className="sig-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            width: '100%', background: 'var(--sig-bg-2)', border: '1px solid var(--sig-border)',
            borderRadius: 3, color: 'var(--sig-text)', padding: '3px 5px', fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        {suffix && <span className="sig-muted" style={{ fontSize: 11 }}>{suffix}</span>}
      </span>
    </label>
  );
}

// Trade planner: sizes a position off entry + stop-beyond-the-wick and projects
// the next liquidity pools as targets with their R multiples. The execution half
// of the Wicks-Don't-Lie workflow (stop beyond the sweep, target the next pool).
export default function TradePlannerPanel({ instrument }: { instrument: string }) {
  const { data } = useApi<LevelsResponse>(() => api.getLevels(instrument), [instrument]);
  const [cfg, setCfg] = useState<Cfg>(loadCfg);
  const [dir, setDir] = useState<Dir>('long');
  const [entry, setEntry] = useState<number>(NaN);
  const [stop, setStop] = useState<number>(NaN);
  // Track whether the user has hand-edited entry/stop so live data doesn't stomp it.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(PLANNER_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  }, [cfg]);

  const price = data?.currentPrice ?? NaN;
  const levels = useMemo(() => data?.levels ?? [], [data]);
  const dp = instrument === 'XAUUSD' ? 2 : 1;

  // Default entry to current price; default stop to the nearest level beyond the
  // entry AGAINST the trade (the level the sweep would have run). Re-seeds when
  // price/direction change until the user edits.
  useEffect(() => {
    if (touched || !Number.isFinite(price)) return;
    setEntry(price);
    const beyond = levels
      .filter((l) => (dir === 'long' ? l.price < price : l.price > price))
      .sort((a, b) => (dir === 'long' ? b.price - a.price : a.price - b.price));
    setStop(beyond[0]?.price ?? NaN);
  }, [price, dir, levels, touched]);

  const pv = POINT_VALUE[instrument] ?? 1;
  const riskUsd = (cfg.account * cfg.riskPct) / 100;
  const stopDist = Number.isFinite(entry) && Number.isFinite(stop) ? Math.abs(entry - stop) : NaN;
  const lots = Number.isFinite(stopDist) && stopDist > 0 ? riskUsd / (stopDist * pv) : NaN;
  const stopValid =
    Number.isFinite(entry) && Number.isFinite(stop) &&
    (dir === 'long' ? stop < entry : stop > entry);

  // Targets = liquidity/levels beyond entry in the trade direction, nearest first,
  // each with its reward:risk multiple.
  const targets = useMemo(() => {
    if (!Number.isFinite(entry) || !Number.isFinite(stopDist) || stopDist <= 0) return [];
    return levels
      .filter((l) => (dir === 'long' ? l.price > entry : l.price < entry))
      .map((l: KeyLevel) => ({
        ...l,
        dist: Math.abs(l.price - entry),
        r: Math.abs(l.price - entry) / stopDist,
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6);
  }, [levels, entry, stopDist, dir]);

  const setDirection = (d: Dir) => { setDir(d); setTouched(false); };

  return (
    <Panel
      title="Trade Planner"
      tag={`${instrument} · risk/target`}
      span={4}
      right={
        <button className="sig-tab" onClick={() => setTouched(false)} title="Reset entry/stop to live">
          ⟳
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
        {/* Direction */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['long', 'short'] as Dir[]).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className="sig-tab"
              style={{
                flex: 1, textTransform: 'uppercase', fontWeight: 700, fontSize: 11,
                background: dir === d ? (d === 'long' ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)') : undefined,
                color: dir === d ? (d === 'long' ? 'var(--sig-green)' : 'var(--sig-red)') : undefined,
              }}
            >
              {d === 'long' ? '▲ Long' : '▼ Short'}
            </button>
          ))}
        </div>

        {/* Entry / Stop */}
        <div style={{ display: 'flex', gap: 6 }}>
          <NumField label="Entry" value={entry} step={10 ** -dp} onChange={(v) => { setEntry(v); setTouched(true); }} />
          <NumField label="Stop" value={stop} step={10 ** -dp} onChange={(v) => { setStop(v); setTouched(true); }} />
        </div>
        {!stopValid && Number.isFinite(entry) && Number.isFinite(stop) && (
          <div style={{ color: 'var(--sig-red)', fontSize: 10.5 }}>
            Stop must be {dir === 'long' ? 'below' : 'above'} entry (beyond the sweep).
          </div>
        )}

        {/* Account / Risk */}
        <div style={{ display: 'flex', gap: 6 }}>
          <NumField label="Account" value={cfg.account} step={500} suffix="$" onChange={(v) => setCfg((c) => ({ ...c, account: v }))} />
          <NumField label="Risk" value={cfg.riskPct} step={0.25} suffix="%" onChange={(v) => setCfg((c) => ({ ...c, riskPct: v }))} />
        </div>

        {/* Sizing readout */}
        <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--sig-border)', paddingTop: 6 }}>
          <Readout label="Risk" value={`$${riskUsd.toFixed(0)}`} />
          <Readout label="Stop dist" value={Number.isFinite(stopDist) ? stopDist.toFixed(dp) : '—'} />
          <Readout
            label="Size"
            value={stopValid && Number.isFinite(lots) ? `${lots.toFixed(2)} lot` : '—'}
            strong
          />
        </div>

        {/* Targets */}
        <div>
          <div className="sig-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            Next liquidity (targets)
          </div>
          {targets.length === 0 ? (
            <div className="sig-muted" style={{ fontSize: 11 }}>
              {stopValid ? 'No levels beyond entry.' : 'Set a valid entry & stop.'}
            </div>
          ) : (
            <table className="sig-table" style={{ width: '100%' }}>
              <tbody>
                {targets.map((t, i) => (
                  <tr key={i}>
                    <td className="sig-symbol" style={{ fontSize: 11 }}>{t.label}</td>
                    <td className="sig-right sig-num" style={{ fontSize: 11 }}>{t.price.toFixed(dp)}</td>
                    <td
                      className="sig-right sig-num"
                      style={{
                        fontSize: 11, fontWeight: 700,
                        color: t.r >= 2 ? 'var(--sig-green)' : t.r >= 1 ? 'var(--sig-amber)' : 'var(--sig-muted)',
                      }}
                    >
                      {t.r.toFixed(1)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Readout({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="sig-muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="sig-num" style={{ fontSize: strong ? 15 : 13, fontWeight: 700, color: strong ? 'var(--sig-cyan)' : 'var(--sig-text)' }}>
        {value}
      </div>
    </div>
  );
}
