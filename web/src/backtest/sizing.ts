// Position sizing + R math for the Backtest Studio, mirroring the app's
// RiskCalculator: risk a fixed % of balance, and let the stop distance set the
// size. pointValue is the account-currency value of a 1.0 price move per unit
// of size; it defaults to 1 so PnL reduces to (exit-entry)*size, matching the
// existing backtest trade math on the server.

export interface SizingInput {
  balance: number;
  riskPct: number; // e.g. 1 = risk 1% of balance
  entry: number;
  stop: number;
  pointValue?: number;
}

export interface SizingResult {
  size: number;
  riskMoney: number; // account currency at risk if the stop is hit
  riskPerUnit: number; // price distance to stop × pointValue
}

export function computeSize({
  balance,
  riskPct,
  entry,
  stop,
  pointValue = 1,
}: SizingInput): SizingResult {
  const riskMoney = (balance * riskPct) / 100;
  const dist = Math.abs(entry - stop);
  const riskPerUnit = dist * pointValue;
  const size = riskPerUnit > 0 ? riskMoney / riskPerUnit : 0;
  return { size, riskMoney, riskPerUnit };
}

// R multiple of a realized move relative to the initial stop distance.
// Positive when the trade made money in its direction; null without a stop.
export function rMultiple(
  side: 'long' | 'short',
  entry: number,
  exit: number,
  stop: number | null | undefined
): number | null {
  if (stop == null) return null;
  const risk = Math.abs(entry - stop);
  if (risk === 0) return null;
  const sign = side === 'long' ? 1 : -1;
  return ((exit - entry) * sign) / risk;
}
