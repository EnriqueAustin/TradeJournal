import { useMemo, useState } from 'react';
import type { Direction } from '../types';
import {
  getPipMultiplier,
  defaultPipValuePerLot,
} from '../utils/pips';
import { formatMoney, formatNumber } from '../utils/format';

// Position-size / risk calculator. Given account equity, a risk budget and an
// entry/stop, it solves for the lot size that keeps the loss at the stop equal
// to the risk budget, then shows notional value and reward/R:R at a target.
//
// Pip value per lot is broker-dependent (index CFDs vary a lot), so it is
// prefilled from a sensible default and stays editable.

const INSTRUMENTS = ['XAUUSD', 'US100', 'EURUSD', 'GBPUSD', 'USDJPY'];
const LOT_STEP = 0.01;

function num(s: string): number | null {
  if (s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function Field({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  step = 'any',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step={step}
          className="input w-full"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

export default function RiskCalculator({
  currency = 'USD',
  equity,
}: {
  currency?: string;
  /** prefill the equity field from the selected account */
  equity?: number | null;
}) {
  const [instrument, setInstrument] = useState('XAUUSD');
  const [direction, setDirection] = useState<Direction>('long');
  const [balance, setBalance] = useState(
    equity != null && equity > 0 ? String(Math.round(equity)) : ''
  );
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [pipValue, setPipValue] = useState(
    String(defaultPipValuePerLot('XAUUSD'))
  );

  // When the instrument changes, reset pip value to that instrument's default.
  const onInstrument = (v: string) => {
    setInstrument(v);
    setPipValue(String(defaultPipValuePerLot(v)));
  };

  const r = useMemo(() => {
    const bal = num(balance);
    const pct = num(riskPct);
    const e = num(entry);
    const s = num(stop);
    const t = num(target);
    const ppl = num(pipValue);
    const mult = getPipMultiplier(instrument);

    const riskAmount = bal != null && pct != null ? bal * (pct / 100) : null;
    const stopPips =
      e != null && s != null ? Math.abs(e - s) * mult : null;
    const riskPerLot =
      stopPips != null && ppl != null ? stopPips * ppl : null;

    let lots: number | null = null;
    if (riskAmount != null && riskPerLot != null && riskPerLot > 0) {
      lots = riskAmount / riskPerLot;
    }
    const lotsRounded =
      lots != null ? Math.floor(lots / LOT_STEP) * LOT_STEP : null;
    // actual $ risked at the rounded, tradeable size
    const actualRisk =
      lotsRounded != null && riskPerLot != null
        ? lotsRounded * riskPerLot
        : null;

    // stop direction sanity: for a long, stop should sit below entry
    const stopOk =
      e == null || s == null
        ? true
        : direction === 'long'
          ? s < e
          : s > e;

    const targetPips =
      e != null && t != null ? Math.abs(t - e) * mult : null;
    const rr =
      stopPips != null && stopPips > 0 && targetPips != null
        ? targetPips / stopPips
        : null;
    const reward =
      lotsRounded != null && targetPips != null && ppl != null
        ? lotsRounded * targetPips * ppl
        : null;
    const notional =
      e != null && lotsRounded != null
        ? lotsRounded * e * contractUnits(instrument)
        : null;

    return {
      riskAmount,
      stopPips,
      lots,
      lotsRounded,
      actualRisk,
      stopOk,
      targetPips,
      rr,
      reward,
      notional,
    };
  }, [balance, riskPct, entry, stop, target, pipValue, instrument, direction]);

  return (
    <div className="flex flex-col gap-4">
      {/* Instrument + direction */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input"
          value={instrument}
          onChange={(e) => onInstrument(e.target.value)}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-md border border-slate-700">
          {(['long', 'short'] as Direction[]).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`px-3 py-1 text-xs font-semibold uppercase ${
                direction === d
                  ? d === 'long'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/20 text-red-300'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field
          label="Equity"
          value={balance}
          onChange={setBalance}
          suffix={currency}
          placeholder="10000"
        />
        <Field
          label="Risk"
          value={riskPct}
          onChange={setRiskPct}
          suffix="%"
          placeholder="1"
        />
        <Field
          label="Pip value / lot"
          value={pipValue}
          onChange={setPipValue}
          suffix={currency}
        />
        <Field label="Entry" value={entry} onChange={setEntry} placeholder="0.00" />
        <Field label="Stop" value={stop} onChange={setStop} placeholder="0.00" />
        <Field
          label="Target (opt)"
          value={target}
          onChange={setTarget}
          placeholder="0.00"
        />
      </div>

      {!r.stopOk && (
        <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-300">
          Stop is on the wrong side of entry for a {direction} — check your levels.
        </div>
      )}

      {/* Results */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Result
          label="Position Size"
          value={r.lotsRounded != null ? `${formatNumber(r.lotsRounded, 2)} lots` : '—'}
          highlight
          sub={
            r.stopPips != null ? `${formatNumber(r.stopPips, 1)} pip stop` : undefined
          }
        />
        <Result
          label="Risk Amount"
          value={r.riskAmount != null ? formatMoney(r.riskAmount, currency) : '—'}
          sub={
            r.actualRisk != null
              ? `${formatMoney(r.actualRisk, currency)} at size`
              : undefined
          }
        />
        <Result
          label="Reward @ Target"
          value={r.reward != null ? formatMoney(r.reward, currency) : '—'}
          valueClass={r.reward != null ? 'text-emerald-400' : undefined}
          sub={r.targetPips != null ? `${formatNumber(r.targetPips, 1)} pips` : undefined}
        />
        <Result
          label="Risk : Reward"
          value={r.rr != null ? `1 : ${formatNumber(r.rr, 2)}` : '—'}
          sub={r.notional != null ? `${formatMoney(r.notional, currency)} notional` : undefined}
        />
      </div>

      <p className="text-[11px] leading-tight text-slate-500">
        Size is floored to {LOT_STEP} lots. Pip value per lot is broker-specific
        (index CFDs especially) — adjust it to match your contract if the risk
        amount looks off.
      </p>
    </div>
  );
}

// Approximate units per 1.0 lot, for a rough notional figure only.
function contractUnits(instrument: string): number {
  const m = getPipMultiplier(instrument);
  if (m === 10) return 100; // gold: 100 oz
  if (m === 1) return 1; // index CFD
  return 100000; // forex standard lot
}

function Result({
  label,
  value,
  sub,
  highlight,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? 'border-indigo-700/60 bg-indigo-950/30'
          : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`num mt-1 text-lg font-semibold ${
          valueClass ?? (highlight ? 'text-indigo-200' : 'text-slate-100')
        }`}
      >
        {value}
      </div>
      {sub && <div className="num mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
