import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from 'react';
import type { PriceTick } from '../../../types';
import { Panel, StatusBadge, TickerCell } from '../terminal';
import type { BadgeKind } from '../terminal';

interface TickState {
  mid: number;
  prev: number;
  ts: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  ticks: number;
}

const WS_URL =
  import.meta.env.DEV
    ? `ws://${window.location.hostname}:4000/ws/research`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/research`;
const RECONNECT_MS = 3000;

interface LiveTickerProps {
  instrument: string;
  onTick?: (instrument: string, mid: number) => void;
  /** select a pair (drives the whole dashboard, like the top header tabs) */
  onSelect?: (instrument: string) => void;
}

export default function LiveTicker({ instrument, onTick, onSelect }: LiveTickerProps) {
  const [prices, setPrices] = useState<Map<string, TickState>>(new Map());
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== 'price') return;
        const tick = msg as PriceTick;

        setPrices((prev) => {
          const next = new Map(prev);
          const old = next.get(tick.instrument);
          const prevMid = old?.mid ?? tick.mid;
          const firstMid = old ? (old.ticks === 0 ? tick.mid : prevMid) : tick.mid;

          next.set(tick.instrument, {
            mid: tick.mid,
            prev: prevMid,
            ts: tick.ts,
            change: tick.mid - firstMid,
            changePct: firstMid ? ((tick.mid - firstMid) / firstMid) * 100 : 0,
            high: Math.max(tick.mid, old?.high ?? tick.mid),
            low: Math.min(tick.mid, old?.low ?? tick.mid),
            ticks: (old?.ticks ?? 0) + 1,
          });
          return next;
        });

        onTickRef.current?.(tick.instrument, tick.mid);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      reconnectRef.current = setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const statusBadge: BadgeKind =
    status === 'connected' ? 'ok' : status === 'connecting' ? 'warn' : 'err';
  const statusLabel =
    status === 'connected' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';

  const tick = prices.get(instrument);
  const otherInstrument = instrument === 'XAUUSD' ? 'US100' : 'XAUUSD';
  const otherTick = prices.get(otherInstrument);

  return (
    <Panel
      title="Live Ticker"
      tag="real-time"
      span={4}
      right={<StatusBadge kind={statusBadge} label={statusLabel} />}
    >
      <div className="sig-ticker-grid">
        <TickerRow label={instrument} tick={tick} dp={instrument === 'XAUUSD' ? 2 : 1} primary onSelect={onSelect} />
        <TickerRow label={otherInstrument} tick={otherTick} dp={otherInstrument === 'XAUUSD' ? 2 : 1} onSelect={onSelect} />
      </div>
      {!tick && status === 'connected' && (
        <div className="sig-ph" style={{ marginTop: 4 }}>Waiting for ticks…</div>
      )}
    </Panel>
  );
}

function TickerRow({
  label,
  tick,
  dp,
  primary,
  onSelect,
}: {
  label: string;
  tick: TickState | undefined;
  dp: number;
  primary?: boolean;
  onSelect?: (instrument: string) => void;
}) {
  const clickable = !!onSelect;
  const rowProps = clickable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onSelect!(label),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect!(label);
          }
        },
        title: `Select ${label}`,
      }
    : {};

  if (!tick) {
    return (
      <div
        className={`sig-ticker-row${primary ? ' is-primary' : ''}${clickable ? ' is-clickable' : ''}`}
        {...rowProps}
      >
        <span className="sig-ticker-sym">{label}</span>
        <span className="sig-num sig-flat">—</span>
      </div>
    );
  }

  const dir = tick.mid > tick.prev ? 'up' : tick.mid < tick.prev ? 'down' : 'flat';

  return (
    <div
      className={`sig-ticker-row${primary ? ' is-primary' : ''}${clickable ? ' is-clickable' : ''}`}
      {...rowProps}
    >
      <span className="sig-ticker-sym">{label}</span>
      <span className={`sig-ticker-price sig-num sig-${dir}`}>
        {tick.mid.toFixed(dp)}
      </span>
      <TickerCell value={tick.change} dp={dp} signed colorize />
      <TickerCell value={tick.changePct} dp={2} signed colorize suffix="%" />
      <div className="sig-ticker-hl">
        <span className="sig-ticker-hl-label">H</span>
        <span className="sig-num">{tick.high.toFixed(dp)}</span>
        <span className="sig-ticker-hl-label">L</span>
        <span className="sig-num">{tick.low.toFixed(dp)}</span>
      </div>
    </div>
  );
}
