import { useMemo, useState } from 'react';
import type { SimBroker, BrokerState, Side } from './broker';
import { computeSize } from './sizing';
import { formatMoney, formatNumber, signClass } from '../utils/format';

// The order ticket: choose risk, set SL/TP, and fire a market Buy/Sell that the
// SimBroker fills at the current price. While a position is open it flips to a
// management view (live PnL + Close). Sizing follows the stop distance so each
// trade risks the chosen % of balance (falls back to a fixed size without a stop).
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
  const [riskPct, setRiskPct] = useState(String(defaultRiskPct));
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [fixedSize, setFixedSize] = useState('1');

  const price = state.currentPrice;
  const slNum = sl ? Number(sl) : null;
  const tpNum = tp ? Number(tp) : null;

  const size = useMemo(() => {
    if (slNum != null && price != null) {
      const { size } = computeSize({
        balance,
        riskPct: Number(riskPct) || 0,
        entry: price,
        stop: slNum,
      });
      return size;
    }
    return Number(fixedSize) || 0;
  }, [slNum, price, balance, riskPct, fixedSize]);

  const place = (side: Side) => {
    if (price == null || size <= 0) return;
    broker.placeMarket({ side, size, sl: slNum, tp: tpNum });
  };

  const pos = state.position;

  if (pos) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
              pos.side === 'long'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-red-500/15 text-red-400'
            }`}
          >
            {pos.side} {formatNumber(pos.size, 2)}
          </span>
          <span className="num text-xs text-slate-400">@ {formatNumber(pos.entryPrice, 2)}</span>
        </div>
        <dl className="flex flex-col gap-1 text-sm">
          <Row label="Price" value={price != null ? formatNumber(price, 2) : '—'} />
          <Row
            label="Unrealized"
            value={formatMoney(state.unrealized, currency)}
            cls={signClass(state.unrealized)}
          />
          <Row
            label="R"
            value={state.unrealizedR != null ? `${formatNumber(state.unrealizedR, 2)}R` : '—'}
            cls={signClass(state.unrealizedR)}
          />
          <Row label="Stop" value={pos.sl != null ? formatNumber(pos.sl, 2) : '—'} cls="text-red-400" />
          <Row label="Target" value={pos.tp != null ? formatNumber(pos.tp, 2) : '—'} cls="text-emerald-400" />
        </dl>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Stop"
            type="number"
            step="any"
            defaultValue={pos.sl ?? ''}
            onBlur={(e) => broker.setStops(e.target.value ? Number(e.target.value) : null, undefined)}
          />
          <input
            className="input flex-1"
            placeholder="Target"
            type="number"
            step="any"
            defaultValue={pos.tp ?? ''}
            onBlur={(e) => broker.setStops(undefined, e.target.value ? Number(e.target.value) : null)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => broker.closeMarket()}>
          Close at market ({price != null ? formatNumber(price, 2) : '—'})
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">Price</span>
        <span className="num text-slate-200">{price != null ? formatNumber(price, 2) : '—'}</span>
      </div>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="label">Risk %</span>
          <input className="input w-full" type="number" step="any" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </label>
        <label className="flex-1">
          <span className="label">Size {slNum != null ? '(auto)' : ''}</span>
          {slNum != null ? (
            <div className="num input w-full bg-slate-900/60">{formatNumber(size, 2)}</div>
          ) : (
            <input className="input w-full" type="number" step="any" value={fixedSize} onChange={(e) => setFixedSize(e.target.value)} />
          )}
        </label>
      </div>
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
      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn border-emerald-600 bg-emerald-600/90 text-white hover:bg-emerald-500 disabled:opacity-40"
          disabled={price == null || size <= 0}
          onClick={() => place('long')}
        >
          Buy
        </button>
        <button
          className="btn border-red-600 bg-red-600/90 text-white hover:bg-red-500 disabled:opacity-40"
          disabled={price == null || size <= 0}
          onClick={() => place('short')}
        >
          Sell
        </button>
      </div>
      <p className="text-[11px] leading-tight text-slate-500">
        Fills at the current bar. With a stop set, size risks {riskPct || 0}% of{' '}
        {formatMoney(balance, currency)}.
      </p>
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
