import { marketDb, instrumentId } from './schema.js';
import { getSeriesData, seedSeriesRegistry } from './ingest/fred.js';
import { getLatestVol, getVolHistory, seedVolSeries } from './ingest/cboe.js';
import { getCotHistory } from './ingest/cftc.js';
import { getEtfHistory } from './ingest/etf.js';
import { getCalendarEvents } from './ingest/calendar.js';
import { getNewsFeed } from './ingest/news.js';

const SNAPSHOT_VERSION = 1;

const RATE_SERIES = [
  'DGS2', 'DGS10', 'DGS30',
  'DFII5', 'DFII10',
  'T10YIE', 'T5YIE',
  'DTWEXBGS', 'FEDFUNDS', 'BAMLH0A0HYM2',
];

const GOLD_DRIVERS = [
  { id: 'DFII10', name: '10Y Real Yield', relationship: 'inverse', zThresh: 0.5 },
  { id: 'DFII5', name: '5Y Real Yield', relationship: 'inverse', zThresh: 0.5 },
  { id: 'DTWEXBGS', name: 'USD Index', relationship: 'inverse', zThresh: 0.5 },
  { id: 'T10YIE', name: '10Y Breakeven', relationship: 'direct', zThresh: 0.5 },
  { id: 'GVZ', name: 'Gold Vol (GVZ)', relationship: 'direct', zThresh: 1.0 },
  { id: 'BAMLH0A0HYM2', name: 'HY Spread', relationship: 'direct', zThresh: 0.5 },
  { id: 'FEDFUNDS', name: 'Fed Funds', relationship: 'inverse', zThresh: 0.5 },
];

function safe(fn) {
  try { return fn(); } catch { return null; }
}

function zScore(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (values[values.length - 1] - mean) / sd;
}

function rollingCorr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const x = xs.slice(-n), y = ys.slice(-n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my;
    num += xi * yi; dx += xi * xi; dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : Math.round((num / denom) * 1000) / 1000;
}

function gatherPrice(instrument) {
  return safe(() => {
    const instId = instrumentId(instrument);
    if (instId == null) return null;
    const bars = marketDb.prepare(
      `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
       ORDER BY ts DESC LIMIT 2`
    ).all(instId);
    if (!bars.length) return null;
    const latest = bars[0];
    const prev = bars[1] || latest;
    return {
      last: latest.c,
      daily_open: latest.o,
      daily_high: latest.h,
      daily_low: latest.l,
      prev_close: prev.c,
    };
  });
}

function gatherRegime() {
  return safe(() => {
    seedVolSeries();
    const vix = getLatestVol('VIX');
    const dxy = marketDb.prepare(
      'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
    ).get('DTWEXBGS');
    const hy = marketDb.prepare(
      'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
    ).get('BAMLH0A0HYM2');
    const vxn = getLatestVol('VXN');

    const vixVal = vix?.value ?? null;
    const hyVal = hy?.value ?? null;
    let score = 0;
    const factors = [];

    if (vixVal != null) {
      if (vixVal < 15) { score += 2; factors.push({ name: 'VIX', value: vixVal, signal: 'bullish' }); }
      else if (vixVal < 20) { score += 1; factors.push({ name: 'VIX', value: vixVal, signal: 'neutral' }); }
      else if (vixVal < 30) { score -= 1; factors.push({ name: 'VIX', value: vixVal, signal: 'bearish' }); }
      else { score -= 2; factors.push({ name: 'VIX', value: vixVal, signal: 'bearish' }); }
    }
    if (hyVal != null) {
      if (hyVal < 3) { score += 1; factors.push({ name: 'HY Spread', value: hyVal, signal: 'bullish' }); }
      else if (hyVal < 5) { factors.push({ name: 'HY Spread', value: hyVal, signal: 'neutral' }); }
      else { score -= 1; factors.push({ name: 'HY Spread', value: hyVal, signal: 'bearish' }); }
    }
    if (dxy?.value != null) factors.push({ name: 'DXY', value: dxy.value, signal: 'neutral' });
    if (vxn?.value != null) factors.push({ name: 'VXN', value: vxn.value, signal: 'neutral' });

    let label;
    if (score >= 2) label = 'risk-on';
    else if (score >= 0) label = 'neutral';
    else if (score >= -2) label = 'risk-off';
    else label = 'crisis';

    return { label, score, factors };
  });
}

function gatherRates() {
  return safe(() => {
    seedSeriesRegistry();
    const rates = {};
    let hasAny = false;
    for (const sid of RATE_SERIES) {
      const row = marketDb.prepare(
        'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
      ).get(sid);
      rates[sid] = row?.value ?? null;
      if (row?.value != null) hasAny = true;
    }
    if (!hasAny) return null;
    const dgs2 = rates.DGS2, dgs10 = rates.DGS10;
    if (dgs2 != null && dgs10 != null) rates.spread_2s10s = Math.round((dgs10 - dgs2) * 100) / 100;
    return rates;
  });
}

function gatherDrivers(instrument) {
  if (instrument !== 'XAUUSD') return null;
  return safe(() => {
    seedSeriesRegistry();
    seedVolSeries();
    const instId = instrumentId('XAUUSD');
    const goldPrices = marketDb.prepare(
      `SELECT c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 120`
    ).all(instId).reverse().map(r => r.c);

    const items = GOLD_DRIVERS.map(drv => {
      let dataPoints;
      if (drv.id === 'GVZ') {
        dataPoints = getVolHistory('GVZ', { limit: 120 }).map(r => r.value).filter(v => v != null);
      } else {
        dataPoints = marketDb.prepare(
          'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 120'
        ).all(drv.id).reverse().map(r => r.value).filter(v => v != null);
      }
      const current = dataPoints.length ? dataPoints[dataPoints.length - 1] : null;
      const window60 = dataPoints.slice(-60);
      const z = zScore(window60);
      const corr = rollingCorr(dataPoints.slice(-60), goldPrices.slice(-60));
      let signal = 'neutral';
      if (z != null) {
        if (drv.relationship === 'inverse') {
          if (z < -drv.zThresh) signal = 'bullish';
          else if (z > drv.zThresh) signal = 'bearish';
        } else {
          if (z > drv.zThresh) signal = 'bullish';
          else if (z < -drv.zThresh) signal = 'bearish';
        }
      }
      return { id: drv.id, name: drv.name, value: current, zScore: z != null ? Math.round(z * 100) / 100 : null, signal, correlation: corr };
    });

    const signalScores = { bullish: 1, neutral: 0, bearish: -1 };
    const scored = items.filter(d => d.signal);
    const compositeScore = scored.length
      ? scored.reduce((s, d) => s + signalScores[d.signal], 0) / scored.length
      : 0;
    let compositeLabel = 'neutral';
    if (compositeScore > 0.3) compositeLabel = 'tailwind';
    else if (compositeScore < -0.3) compositeLabel = 'headwind';

    return { composite: { score: Math.round(compositeScore * 100) / 100, label: compositeLabel }, items };
  });
}

function gatherVol(instrument) {
  return safe(() => {
    seedVolSeries();
    const vix = getLatestVol('VIX');
    const vxn = getLatestVol('VXN');
    const gvz = getLatestVol('GVZ');
    const volSeriesId = instrument === 'US100' ? 'VXN' : 'GVZ';
    const iv = (volSeriesId === 'VXN' ? vxn : gvz)?.value ?? null;
    const history = getVolHistory(volSeriesId, { limit: 60 });
    const vals = history.map(h => h.value).filter(v => v != null);
    const pctRank = iv != null && vals.length
      ? Math.round((vals.filter(v => v <= iv).length / vals.length) * 100)
      : null;

    let expectedMove1d = null;
    if (iv != null) {
      const instId = instrumentId(instrument);
      const lastPrice = marketDb.prepare(
        `SELECT c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 1`
      ).get(instId);
      if (lastPrice?.c) expectedMove1d = Math.round(lastPrice.c * (iv / 100) / Math.sqrt(252) * 100) / 100;
    }

    return {
      vix: vix?.value ?? null,
      vxn: vxn?.value ?? null,
      gvz: gvz?.value ?? null,
      instrument_iv: iv,
      percentile_60d: pctRank,
      expected_move_1d: expectedMove1d,
    };
  });
}

function gatherPositioning(instrument) {
  if (instrument !== 'XAUUSD') return null;
  return safe(() => {
    const history = getCotHistory('GOLD - COMMODITY EXCHANGE INC.', { limit: 156 });
    if (!history.length) return null;
    const current = history[history.length - 1];
    const mmNet = current.mm_long - current.mm_short;
    const pctLong = current.mm_long + current.mm_short > 0
      ? Math.round((current.mm_long / (current.mm_long + current.mm_short)) * 1000) / 10
      : 50;
    const prev = history.length >= 2 ? history[history.length - 2] : current;
    const wowDelta = mmNet - (prev.mm_long - prev.mm_short);
    const nets = history.map(r => r.mm_long - r.mm_short);
    const sorted1y = [...nets.slice(-52)].sort((a, b) => a - b);
    const pctRank1y = sorted1y.length
      ? Math.round((sorted1y.filter(v => v <= mmNet).length / sorted1y.length) * 1000) / 10
      : null;

    const etfHistory = getEtfHistory('GLD', { limit: 90 });
    const etfLatest = etfHistory.length ? etfHistory[etfHistory.length - 1] : null;
    const etfPrev = etfHistory.length >= 2 ? etfHistory[etfHistory.length - 2] : etfLatest;
    let etfTrend = 'flat';
    const last20 = etfHistory.slice(-20).map(h => h.tonnes).filter(t => t != null);
    if (last20.length >= 10) {
      const half = Math.floor(last20.length / 2);
      const first = last20.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const second = last20.slice(half).reduce((a, b) => a + b, 0) / (last20.length - half);
      if (second > first + 0.5) etfTrend = 'inflow';
      else if (second < first - 0.5) etfTrend = 'outflow';
    }

    return {
      cot_net_mm: mmNet,
      cot_pct_long: pctLong,
      cot_wow_delta: wowDelta,
      cot_percentile_1y: pctRank1y,
      etf_tonnes: etfLatest?.tonnes ?? null,
      etf_daily_delta: etfLatest && etfPrev ? Math.round(((etfLatest.tonnes ?? 0) - (etfPrev.tonnes ?? 0)) * 100) / 100 : null,
      etf_trend: etfTrend,
    };
  });
}

function gatherUpcomingEvents() {
  return safe(() => {
    const now = Date.now();
    const horizon = now + 24 * 60 * 60 * 1000;
    const events = getCalendarEvents({ from: now, to: horizon, impact: 'high', limit: 10 });
    if (!events.length) return [];
    return events.map(e => ({
      name: e.name,
      ts: e.ts,
      impact: e.impact,
      consensus: e.consensus ?? null,
      prior: e.prior ?? null,
    }));
  });
}

function gatherRecentNews(instrument) {
  return safe(() => {
    const since = Date.now() - 6 * 60 * 60 * 1000;
    const items = getNewsFeed({ instrument, since, limit: 5 });
    if (!items.length) return [];
    return items.map(n => ({
      headline: n.headline,
      source: n.source,
      sentiment: n.sentiment ?? null,
      ts: n.ts,
    }));
  });
}

function gatherCorrelations(instrument) {
  return safe(() => {
    const window = 60;
    const pairs = {};
    const targets = instrument === 'XAUUSD'
      ? ['DGS10', 'DTWEXBGS', 'US100']
      : ['DGS10', 'DTWEXBGS', 'XAUUSD'];

    const instId = instrumentId(instrument);
    if (instId == null) return null;
    const instData = marketDb.prepare(
      `SELECT ts, c AS value FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT ?`
    ).all(instId, window + 50).reverse();

    for (const target of targets) {
      let targetData;
      const volIds = new Set(['VIX', 'VXN', 'GVZ']);
      if (['XAUUSD', 'US100', 'XAGUSD', 'WTICO_USD'].includes(target)) {
        const tid = instrumentId(target);
        if (tid == null) continue;
        targetData = marketDb.prepare(
          `SELECT ts, c AS value FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT ?`
        ).all(tid, window + 50).reverse();
      } else if (volIds.has(target)) {
        seedVolSeries();
        targetData = marketDb.prepare(
          'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
        ).all(target, window + 50).reverse();
      } else {
        seedSeriesRegistry();
        targetData = marketDb.prepare(
          'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
        ).all(target, window + 50).reverse();
      }

      const instMap = new Map(instData.map(r => [Math.floor(r.ts / 86400000), r.value]));
      const tgtMap = new Map(targetData.map(r => [Math.floor(r.ts / 86400000), r.value]));
      const common = [...instMap.keys()].filter(d => tgtMap.has(d) && tgtMap.get(d) != null).sort((a, b) => a - b);
      const xs = common.slice(-window).map(d => instMap.get(d));
      const ys = common.slice(-window).map(d => tgtMap.get(d));
      const corr = rollingCorr(xs, ys);
      if (corr != null) pairs[`${instrument}_${target}`] = corr;
    }

    return Object.keys(pairs).length ? { window, pairs } : null;
  });
}

function gatherKeyLevels(instrument) {
  return safe(() => {
    const instId = instrumentId(instrument);
    if (instId == null) return null;
    const bars = marketDb.prepare(
      `SELECT o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 10`
    ).all(instId);
    if (!bars.length) return null;

    const latest = bars[0];
    const prev = bars[1] || latest;
    const price = latest.c;
    const levels = [];

    const pp = (prev.h + prev.l + prev.c) / 3;
    levels.push({ label: 'PP', price: Math.round(pp * 100) / 100 });
    levels.push({ label: 'R1', price: Math.round((2 * pp - prev.l) * 100) / 100 });
    levels.push({ label: 'S1', price: Math.round((2 * pp - prev.h) * 100) / 100 });
    levels.push({ label: 'R2', price: Math.round((pp + (prev.h - prev.l)) * 100) / 100 });
    levels.push({ label: 'S2', price: Math.round((pp - (prev.h - prev.l)) * 100) / 100 });

    const step = instrument === 'XAUUSD' ? 50 : 500;
    const base = Math.floor(price / step) * step;
    for (let i = -2; i <= 3; i++) {
      const p = base + i * step;
      if (p > 0) levels.push({ label: `$${p}`, price: p });
    }

    levels.push({ label: 'Prev Day H', price: prev.h });
    levels.push({ label: 'Prev Day L', price: prev.l });

    const weekBars = bars.slice(0, 5);
    if (weekBars.length >= 3) {
      levels.push({ label: 'Prev Week H', price: Math.max(...weekBars.map(b => b.h)) });
      levels.push({ label: 'Prev Week L', price: Math.min(...weekBars.map(b => b.l)) });
    }

    const seen = new Set();
    const unique = levels.filter(l => {
      const key = l.price.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const above = unique.filter(l => l.price > price).sort((a, b) => a.price - b.price).slice(0, 3);
    const below = unique.filter(l => l.price < price).sort((a, b) => b.price - a.price).slice(0, 3);
    return { above, below };
  });
}

function gatherSeasonality(instrument) {
  return safe(() => {
    const instId = instrumentId(instrument);
    if (instId == null) return null;
    const bars = marketDb.prepare(
      `SELECT ts, o, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts ASC`
    ).all(instId);
    if (bars.length < 30) return null;

    const now = new Date();
    const currentMonth = now.getUTCMonth();
    const currentDow = now.getUTCDay();
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const monthReturns = Array.from({ length: 12 }, () => []);
    const monthlyCloses = new Map();
    for (const bar of bars) {
      const d = new Date(bar.ts);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (!monthlyCloses.has(key)) monthlyCloses.set(key, { first: bar.c, last: bar.c, month: d.getUTCMonth() });
      else monthlyCloses.get(key).last = bar.c;
    }
    const entries = [...monthlyCloses.entries()].sort();
    for (let i = 1; i < entries.length; i++) {
      const ret = ((entries[i][1].last - entries[i - 1][1].last) / entries[i - 1][1].last) * 100;
      monthReturns[entries[i][1].month].push(ret);
    }

    const mRet = monthReturns[currentMonth];
    const monthData = mRet.length ? {
      name: monthLabels[currentMonth],
      avg_return: Math.round((mRet.reduce((a, b) => a + b, 0) / mRet.length) * 100) / 100,
      win_rate: Math.round((mRet.filter(r => r > 0).length / mRet.length) * 100),
    } : null;

    const dowReturns = Array.from({ length: 7 }, () => []);
    for (let i = 1; i < bars.length; i++) {
      const d = new Date(bars[i].ts);
      const ret = ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
      dowReturns[d.getUTCDay()].push(ret);
    }

    const dRet = dowReturns[currentDow];
    const dowData = dRet.length ? {
      name: dowLabels[currentDow],
      avg_return: Math.round((dRet.reduce((a, b) => a + b, 0) / dRet.length) * 100) / 100,
      win_rate: Math.round((dRet.filter(r => r > 0).length / dRet.length) * 100),
    } : null;

    return { month: monthData, dow: dowData };
  });
}

export function captureSnapshot(tradeId, instrument, entryTimeMs) {
  const normalizedInst = instrument?.toUpperCase() ?? null;
  const ts = entryTimeMs || Date.now();

  const payload = {
    version: SNAPSHOT_VERSION,
    captured_at: Date.now(),
    instrument: normalizedInst,
    price: gatherPrice(normalizedInst),
    regime: gatherRegime(),
    rates: gatherRates(),
    drivers: gatherDrivers(normalizedInst),
    vol: gatherVol(normalizedInst),
    positioning: gatherPositioning(normalizedInst),
    upcoming_events: gatherUpcomingEvents(),
    recent_news: gatherRecentNews(normalizedInst),
    correlations: gatherCorrelations(normalizedInst),
    key_levels: gatherKeyLevels(normalizedInst),
    seasonality: gatherSeasonality(normalizedInst),
  };

  marketDb.prepare(
    `INSERT INTO context_snapshots (trade_id, ts, payload_json)
     VALUES (?, ?, ?)
     ON CONFLICT(trade_id) DO UPDATE SET ts = excluded.ts, payload_json = excluded.payload_json`
  ).run(tradeId, ts, JSON.stringify(payload));

  return payload;
}

export function getSnapshot(tradeId) {
  const row = marketDb.prepare(
    'SELECT trade_id, ts, payload_json FROM context_snapshots WHERE trade_id = ?'
  ).get(tradeId);
  if (!row) return null;
  return {
    trade_id: row.trade_id,
    ts: row.ts,
    payload: JSON.parse(row.payload_json),
  };
}
