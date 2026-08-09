import type { Direction } from '../types';

export interface PipMetrics {
  realizedPips: number;
  riskPips: number | null;
  targetPips: number | null;
  pipsFormatted: string;
  pointsFormatted: string;
  riskRewardFormatted: string | null;
}

/**
 * Get pip factor (pips per 1 unit of price move) for a symbol.
 * - XAUUSD / Gold: $0.10 = 1 pip ($1.00 move = 10 pips / 100 points)
 * - US100 / Nasdaq: 1 point = 1 pip
 * - Forex JPY: 0.01 = 1 pip (factor = 100)
 * - Forex standard: 0.0001 = 1 pip (factor = 10000)
 */
export function getPipMultiplier(instrument: string): number {
  if (!instrument) return 1;
  const sym = instrument.trim().toUpperCase();

  if (sym.includes('XAU') || sym.includes('GOLD')) {
    return 10; // $1 = 10 pips
  }
  if (
    sym.includes('US100') ||
    sym.includes('NAS100') ||
    sym.includes('USTEC') ||
    sym.includes('SPX') ||
    sym.includes('US30') ||
    sym.includes('GER40') ||
    sym.includes('DAX')
  ) {
    return 1; // 1 point = 1 pip
  }
  if (sym.includes('JPY')) {
    return 100; // 0.01 = 1 pip
  }
  // Default standard forex (EURUSD, GBPUSD, etc.)
  return 10000; // 0.0001 = 1 pip
}

/**
 * Approximate USD value of one pip per 1.0 standard lot, for a USD account.
 * These are broker-dependent (especially index CFDs), so the calculator always
 * lets the user override the value; this is just a sensible starting point.
 * - XAUUSD: 1 lot = 100oz, 1 pip = $0.10 move → $10 / pip / lot
 * - US100 / indices: 1 pip = 1 point, common CFD spec → $1 / point / lot
 * - JPY pairs: ~$9.1 / pip / lot (varies with the USDJPY rate)
 * - standard forex: 1 lot = 100k, 1 pip = 0.0001 → $10 / pip / lot
 */
export function defaultPipValuePerLot(instrument: string): number {
  const m = getPipMultiplier(instrument);
  if (m === 10) return 10; // gold
  if (m === 1) return 1; // indices
  if (m === 100) return 9.1; // JPY pairs
  return 10; // standard forex
}

/**
 * Calculate comprehensive pip move metrics for a trade.
 */
export function calculateTradePips(
  instrument: string,
  entryPrice: number | null,
  exitPrice: number | null,
  stopPrice: number | null,
  targetPrice: number | null,
  direction: Direction
): PipMetrics {
  const multiplier = getPipMultiplier(instrument);

  if (entryPrice == null || exitPrice == null) {
    return {
      realizedPips: 0,
      riskPips: null,
      targetPips: null,
      pipsFormatted: '0.0 pips',
      pointsFormatted: '0 pts',
      riskRewardFormatted: null,
    };
  }

  const rawMove =
    direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
  const realizedPips = rawMove * multiplier;
  const rawPoints =
    rawMove *
    (multiplier === 10 ? 100 : multiplier === 1 ? 1 : multiplier === 100 ? 1000 : 100000);

  const sign = realizedPips >= 0 ? '+' : '';
  const pipsFormatted = `${sign}${realizedPips.toFixed(1)} pips`;
  const pointsFormatted = `${sign}${Math.round(rawPoints)} pts`;

  // Risk pips (entry -> SL)
  let riskPips: number | null = null;
  if (stopPrice != null) {
    const stopDist = Math.abs(entryPrice - stopPrice);
    riskPips = stopDist * multiplier;
  }

  // Target pips (entry -> TP or exit)
  let targetPips: number | null = null;
  const tpLevel = targetPrice ?? exitPrice;
  if (tpLevel != null) {
    const targetDist = Math.abs(tpLevel - entryPrice);
    targetPips = targetDist * multiplier;
  }

  let riskRewardFormatted: string | null = null;
  if (riskPips != null && riskPips > 0) {
    const targetText = targetPips != null ? `${targetPips.toFixed(1)} pips` : 'N/A';
    riskRewardFormatted = `SL: ${riskPips.toFixed(1)} pips | TP: ${targetText}`;
  }

  return {
    realizedPips: Number(realizedPips.toFixed(1)),
    riskPips: riskPips != null ? Number(riskPips.toFixed(1)) : null,
    targetPips: targetPips != null ? Number(targetPips.toFixed(1)) : null,
    pipsFormatted,
    pointsFormatted,
    riskRewardFormatted,
  };
}
