import { useMemo, useState } from 'react';
import type { SimBroker, BrokerState, Side, OrderKind } from './broker';
import { computeSize } from './sizing';
import { formatMoney, formatNumber, signClass } from '../utils/format';

const KINDS: OrderKind[] = ['market', 'limit', 'stop'];

// The order ticket: pick market / limit / stop, set risk + SL/TP (either explicit
// prices or a scalper distance preset), and fire Buy/Sell. While a position is
// open it flips to management (partial close, break-even, full close). Resting
// limit/stop orders show below with cancel buttons.
export default function OrderTicket({
  broker,
  state,
  balance,
  currency,
  defaultRiskPct = 1,
}: {
  broker: SimBroker;
  state: BrokerState;
  balance: number;
  currency: string;
  defaultRiskPct?: number;
}) {
  const [kind, setKind] = useState<OrderKind>('market');
  const [riskPct, setRiskPct] = useState(String(defaultRiskPct));
  const [orderPrice, setOrderPrice] = useState(''); // limit/stop level
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [fixedSize, setFixedSize] = useState('1');
  // Scalper preset: derive SL/TP from a distance instead of typing prices.
  const [scalper, setScalper] = useState(false);
  const [slDist, setSlDist] = useState('1');
  const [tpDist, setTpDist] = useState('2');

  const price = state.currentPrice;
  const ref = kind === 'market' ? price : orderPrice ? Number(orderPrice) : null;

  // Resolve the effective SL/TP for a given side (scalper distances or inputs).
  const stopsFor = (side: Side): { sl: number | null; tp: number | null } => {
    if (scalper && ref != null) {
      const sd = Number(slDist) || 0;
      const td = Number(tpDist) || 0;
      return side === 'long'
        ? { sl: sd ? ref - sd : null, tp: td ? ref + td : null }
        : { sl: sd ? ref + sd : null, tp: td ? ref - td : null };
    }
    return { sl: sl ? Number(sl) : null, tp: tp ? Number(tp) : null };
  };

  const sizeFor = (side: Side): number => {
    const { sl: s } = stopsFor(side);
    if (s != null && ref != null) {
      return computeSize({ balance, riskPct: Number(riskPct) || 0, entry: ref, stop: s }).size;
    }
    return Number(fixedSize) || 0;
  };

  // Preview size uses the long side (symmetric distances make it representative).
  const previewSize = useMemo(() => sizeFor('long'), [scalper, ref, sl, slDist, riskPct, fixedSize, balance]);
  const autoSized = (scalper ? Number(slDist) > 0 : !!sl);

  const submit = (side: Side) => {
    if (ref == null) return;
    const { sl: s, tp: t } = stopsFor(side);
    const size = sizeFor(side);
    if (size <= 0) return;
    if (kind === 'market') broker.placeMarket({ side, size, sl: s, tp: t });
    else broker.placeOrder({ kind, side, size, price: ref, sl: s, tp: t });
  };

  const pos = state.position;

  return (
    <div className="flex flex-col gap-2">
      {pos ? (
        <PositionManager broker={broker} state={state} currency={currency} />
      ) : (
        <>
          {/* Order kind */}
          <div className="flex gap-1">
            {KINDS.map((k) => (
              <button
                key={k}
                className={`btn flex-1 py-1 text-xs capitalize ${kind === k ? 'btn-primary' : ''}`}
                onClick={() => setKind(k)}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Price</span>
            <span className="num text-slate-200">{price != null ? formatNumber(price, 2) : '—'}</span>
          </div>

          {kind !== 'market' && (
            <label>
              <span className="label">{kind === 'limit' ? 'Limit' : 'Stop'} price</span>
              <input className="input w-full" type="number" step="any" value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} placeholder="price" />
            </label>
          )}

          <div className="flex gap-2">
            <label className="flex-1">
              <span className="label">Risk %</span>
              <input className="input w-full" type="number" step="any" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
            </label>
            <label className="flex-1">
              <span className="label">Size {autoSized ? '(auto)' : ''}</span>
              {autoSized ? (
                <div className="num input w-full bg-slate-900/60">{formatNumber(previewSize, 2)}</div>
              ) : (
                <input className="input w-full" type="number" step="any" value={fixedSize} onChange={(e) => setFixedSize(e.target.value)} />
              )}
            </label>
          </div>

          {/* SL/TP: explicit prices or scalper distances */}
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={scalper} onChange={(e) => setScalper(e.target.checked)} />
            Scalper preset (SL/TP by distance)
          </label>
          {scalper ? (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="label">SL dist</span>
                <input className="input w-full" type="number" step="any" value={slDist} onChange={(e) => setSlDist(e.target.value)} />
              </label>
              <label className="flex-1">
                <span className="label">TP dist</span>
                <input className="input w-full" type="number" step="any" value={tpDist} onChange={(e) => setTpDist(e.target.value)} />
              </label>
            </div>
          ) : (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="label">Stop</span>
                <input className="input w-full" type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="price" />
              </label>
              <label className="flex-1">
                <span className="label">Target</span>
                <input className="input w-full" type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="price" />
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn border-emerald-600 bg-emerald-600/90 text-white hover:bg-emerald-500 disabled:opacity-40"
              disabled={ref == null || previewSize <= 0}
              onClick={() => submit('long')}
            >
              Buy {kind !== 'market' ? kind : ''}
            </button>
            <button
              className="btn border-red-600 bg-red-600/90 text-white hover:bg-red-500 disabled:opacity-40"
              disabled={ref == null || previewSize <= 0}
              onClick={() => submit('short')}
            >
              Sell {kind !== 'market' ? kind : ''}
            </button>
          </div>
        </>
      )}

      {/* Resting orders */}
      {state.working.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Working orders</div>
          {state.working.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded border border-slate-800 px-2 py-1 text-xs">
              <span className={o.side === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                {o.side} {o.kind} {formatNumber(o.size, 2)} @ {formatNumber(o.price, 2)}
              </span>
              <button className="text-slate-500 hover:text-red-400" onClick={() => broker.cancelOrder(o.id)} aria-label="Cancel order">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PositionManager({
  broker,
  state,
  currency,
}: {
  broker: SimBroker;
  state: BrokerState;
  currency: string;
}) {
  const pos = state.position!;
  const price = state.currentPrice;
  const [partial, setPartial] = useState(String(Number((pos.size / 2).toFixed(2))));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${pos.side === 'long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
          {pos.side} {formatNumber(pos.size, 2)}
        </span>
        <span className="num text-xs text-slate-400">@ {formatNumber(pos.entryPrice, 2)}</span>
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label="Price" value={price != null ? formatNumber(price, 2) : '—'} />
        <Row label="Unrealized" value={formatMoney(state.unrealized, currency)} cls={signClass(state.unrealized)} />
        <Row label="R" value={state.unrealizedR != null ? `${formatNumber(state.unrealizedR, 2)}R` : '—'} cls={signClass(state.unrealizedR)} />
        <Row label="Stop" value={pos.sl != null ? formatNumber(pos.sl, 2) : '—'} cls="text-red-400" />
        <Row label="Target" value={pos.tp != null ? formatNumber(pos.tp, 2) : '—'} cls="text-emerald-400" />
      </dl>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Stop" type="number" step="any" defaultValue={pos.sl ?? ''} onBlur={(e) => broker.setStops(e.target.value ? Number(e.target.value) : null, undefined)} />
        <input className="input flex-1" placeholder="Target" type="number" step="any" defaultValue={pos.tp ?? ''} onBlur={(e) => broker.setStops(undefined, e.target.value ? Number(e.target.value) : null)} />
      </div>
      <div className="flex items-center gap-2">
        <input className="input w-20" type="number" step="any" value={partial} onChange={(e) => setPartial(e.target.value)} aria-label="Partial size" />
        <button className="btn flex-1 py-1 text-xs" onClick={() => broker.partialClose(Number(partial) || 0)}>Close part</button>
        <button className="btn py-1 text-xs" onClick={() => broker.breakEven()} title="Move stop to entry">B/E</button>
      </div>
      <button className="btn btn-primary" onClick={() => broker.closeMarket()}>
        Close at market ({price != null ? formatNumber(price, 2) : '—'})
      </button>
    </div>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`num ${cls || 'text-slate-300'}`}>{value}</dd>
    </div>
  );
}
