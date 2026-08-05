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
};

// OANDA caps a candles request at 5000; 3 days of M1 = 4320 < 5000.
const CHUNK_MS = 3 * 24 * 60 * 60 * 1000;

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

async function fetchChunk(host, symbol, fromISO, toISO) {
  const url = new URL(`${host}/v3/instruments/${symbol}/candles`);
  url.searchParams.set('granularity', 'M1');
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

// Fetch M1 candles for [from, to] (Date | ISO), chunked under OANDA's 5000 cap.
export async function fetchOandaM1(instrument, from, to) {
  if (!oandaConfigured()) throw new Error('OANDA_API_TOKEN not set');
  const symbol = oandaSymbol(instrument);
  if (!symbol) throw new Error(`no OANDA symbol for ${instrument}`);
  const host = OANDA_HOSTS[OANDA_ENV] || OANDA_HOSTS.practice;

  let start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return [];

  const all = [];
  while (start < end) {
    const chunkEnd = Math.min(start + CHUNK_MS, end);
    const bars = await fetchChunk(
      host,
      symbol,
      new Date(start).toISOString(),
      new Date(chunkEnd).toISOString()
    );
    all.push(...bars);
    start = chunkEnd;
  }
  return all;
}
