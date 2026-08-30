// OANDA v20 market-data fetch — pulls M1 candles for XAUUSD / US100.
// Practice API is free forever; token comes from server/.env (OANDA_API_TOKEN).
import { normalizeInstrument } from './util.js';
import { OANDA_API_TOKEN, OANDA_ENV } from './env.js';

const OANDA_HOSTS = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com',
};

// Our canonical instrument → OANDA instrument name.
const OANDA_SYMBOL = {
  XAUUSD: 'XAU_USD',
  US100: 'NAS100_USD',
  XAGUSD: 'XAG_USD',
  WTICO_USD: 'WTICO_USD',
};

// Seconds per OANDA granularity we support. S5 is the finest free-tier candle;
// finer detail = fewer gaps and smoother replay.
export const GRANULARITY_SECONDS = {
  S5: 5, S15: 15, S30: 30,
  M1: 60, M5: 300, M15: 900, M30: 1800,
  H1: 3600, H2: 7200, H4: 14400, D1: 86400,
};

// OANDA names its daily/weekly/monthly candles with a bare letter (D/W/M), not
// the D1-style names used internally — and internally "M1" already means one
// *minute*, so the app keeps its own names and maps them only at the wire.
// Sending "D1" straight through earns a 400 "Invalid value specified for
// 'granularity'".
const OANDA_GRANULARITY = { D1: 'D' };

function oandaGranularity(tf) {
  return OANDA_GRANULARITY[tf] ?? tf;
}

// OANDA caps a candles request at 5000 candles. Chunk span = 4500 candles' worth
// of time (margin under the cap) so one chunk always fits, whatever the
// granularity. For M1 this is ~3.1 days; for S5, ~6.25 hours.
function chunkMsFor(granularity) {
  const secs = GRANULARITY_SECONDS[granularity] ?? 60;
  return 4500 * secs * 1000;
}

export function oandaConfigured() {
  return !!OANDA_API_TOKEN;
}

export function oandaSymbol(instrument) {
  return OANDA_SYMBOL[normalizeInstrument(instrument)] || null;
}

// OANDA RFC3339 times carry up to 9 fractional digits — trim to ms for Date.
function normTime(t) {
  const s = String(t).replace(/(\.\d{3})\d*Z$/, '$1Z');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchChunk(host, symbol, granularity, fromISO, toISO) {
  const url = new URL(`${host}/v3/instruments/${symbol}/candles`);
  url.searchParams.set('granularity', granularity);
  url.searchParams.set('price', 'M'); // midpoint OHLC
  url.searchParams.set('from', fromISO);
  url.searchParams.set('to', toISO);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_TOKEN}`,
      'Accept-Datetime-Format': 'RFC3339',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OANDA ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const out = [];
  for (const c of json.candles || []) {
    if (!c.complete || !c.mid) continue; // skip the still-forming last candle
    const t = normTime(c.time);
    if (!t) continue;
    out.push({
      t,
      open: Number(c.mid.o),
      high: Number(c.mid.h),
      low: Number(c.mid.l),
      close: Number(c.mid.c),
      volume: c.volume ?? null,
    });
  }
  return out;
}

// Fetch candles at `granularity` for [from, to] (Date | ISO), chunked under
// OANDA's 5000-candle cap. Granularity defaults to M1.
export async function fetchOandaCandles(instrument, from, to, granularity = 'M1') {
  if (!oandaConfigured()) throw new Error('OANDA_API_TOKEN not set');
  if (!GRANULARITY_SECONDS[granularity]) throw new Error(`unsupported granularity ${granularity}`);
  const symbol = oandaSymbol(instrument);
  if (!symbol) throw new Error(`no OANDA symbol for ${instrument}`);
  const host = OANDA_HOSTS[OANDA_ENV] || OANDA_HOSTS.practice;
  const chunkMs = chunkMsFor(granularity);

  let start = new Date(from).getTime();
  // OANDA rejects a 'to' in the future (e.g. a trade closed today padded forward
  // for chart context). Clamp to just before now; the forming candle is skipped.
  const end = Math.min(new Date(to).getTime(), Date.now() - 60000);
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return [];

  const all = [];
  while (start < end) {
    const chunkEnd = Math.min(start + chunkMs, end);
    const bars = await fetchChunk(
      host,
      symbol,
      oandaGranularity(granularity),
      new Date(start).toISOString(),
      new Date(chunkEnd).toISOString()
    );
    all.push(...bars);
    start = chunkEnd;
  }
  return all;
}

// Back-compat wrapper: M1 candles for [from, to].
export function fetchOandaM1(instrument, from, to) {
  return fetchOandaCandles(instrument, from, to, 'M1');
}
