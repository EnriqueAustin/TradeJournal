import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRMultiple,
  rMultipleInfo,
  defaultRiskCash,
  normalizeInstrument,
  sessionFromTime,
} from './util.js';

// ---- computeRMultiple: stop-based R -------------------------------------
test('stop-based R uses realized $/point (instrument-agnostic)', () => {
  // XAUUSD long: entry 2000, stop 1990 (10-pt risk), exit 2020 (+20 move).
  // gross +2000 over a 20-pt move = $100/pt; risk = 10pt * $100 = $1000.
  // net +1900 / 1000 = 1.9R.
  const r = computeRMultiple({
    entry_price: 2000, exit_price: 2020, stop_price: 1990,
    size: 1, gross_pnl: 2000, net_pnl: 1900,
  });
  assert.ok(Math.abs(r - 1.9) < 1e-9);
});

test('stop-based R falls back to |entry-stop|*size when no realized move', () => {
  // Open trade, no exit/gross: risk = 10pt * size 2 = 20; net -20 => -1R.
  const r = computeRMultiple({
    entry_price: 100, exit_price: null, stop_price: 90,
    size: 2, gross_pnl: null, net_pnl: -20,
  });
  assert.equal(r, -1);
});

test('R is null when net_pnl is missing', () => {
  assert.equal(computeRMultiple({ entry_price: 1, stop_price: 0.5, net_pnl: null }), null);
});

// ---- computeRMultiple: derived (risk_cash) fallback ---------------------
test('derived R uses account risk_cash when no stop recorded', () => {
  // No stop; modeled risk $250; net +500 => 2R.
  const r = computeRMultiple({
    entry_price: 2000, exit_price: 2010, stop_price: null,
    size: 1, gross_pnl: 500, net_pnl: 500, risk_cash: 250,
  });
  assert.equal(r, 2);
});

test('a real stop wins over the risk_cash fallback', () => {
  // Both a stop AND a risk_cash present -> stop-based path used, not 500/250.
  const r = computeRMultiple({
    entry_price: 2000, exit_price: 2020, stop_price: 1990,
    size: 1, gross_pnl: 2000, net_pnl: 1900, risk_cash: 250,
  });
  assert.ok(Math.abs(r - 1.9) < 1e-9);
});

test('risk_cash of 0 or negative does not derive an R', () => {
  assert.equal(computeRMultiple({ stop_price: null, net_pnl: 100, risk_cash: 0 }), null);
  assert.equal(computeRMultiple({ stop_price: null, net_pnl: 100, risk_cash: -5 }), null);
});

// ---- rMultipleInfo: derived flag ----------------------------------------
test('rMultipleInfo flags derived R and not stop-based R', () => {
  const derived = rMultipleInfo({ stop_price: null, net_pnl: 500, risk_cash: 250 });
  assert.deepEqual(derived, { r: 2, derived: true });

  const real = rMultipleInfo({
    entry_price: 2000, exit_price: 2020, stop_price: 1990,
    size: 1, gross_pnl: 2000, net_pnl: 1900, risk_cash: 250,
  });
  assert.equal(real.derived, false);
  assert.ok(Math.abs(real.r - 1.9) < 1e-9);

  assert.deepEqual(rMultipleInfo({ stop_price: null, net_pnl: null }), { r: null, derived: false });
});

// ---- defaultRiskCash -----------------------------------------------------
test('defaultRiskCash prefers a fixed amount over the percent', () => {
  assert.equal(
    defaultRiskCash({ default_risk_amount: 300, default_risk_pct: 1, starting_balance: 10000 }),
    300
  );
});

test('defaultRiskCash computes percent of starting balance', () => {
  assert.equal(
    defaultRiskCash({ default_risk_amount: null, default_risk_pct: 1, starting_balance: 10000 }),
    100
  );
});

test('defaultRiskCash is null when the account models no risk', () => {
  assert.equal(defaultRiskCash({ default_risk_pct: 0, starting_balance: 10000 }), null);
  assert.equal(defaultRiskCash({ default_risk_pct: 1, starting_balance: 0 }), null);
  assert.equal(defaultRiskCash(null), null);
});
