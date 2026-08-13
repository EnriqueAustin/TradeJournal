import { fetchOandaM1, oandaConfigured } from '../../marketdata.js';
import { marketDb, instrumentId } from '../schema.js';

const OANDA_INSTRUMENTS = [
  { symbol: 'XAUUSD', oanda: 'XAU_USD' },
  { symbol: 'US100', oanda: 'NAS100_USD' },
  { symbol: 'XAGUSD', oanda: 'XAG_USD' },
];

const TF_MINUTES = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
const AGGREGATE_TFS = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

function aggregateM1(m1Rows, tf) {
  const size = TF_MINUTES[tf];
  if (!size) return [];
  const ms = size * 60000;
  const buckets = new Map();
  for (const b of m1Rows) {
    const bucket = Math.floor(b.ts / ms) * ms;
    const a = buckets.get(bucket);
    if (!a) {
      buckets.set(bucket, { ts: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
    } else {
      if (b.h > a.h) a.h = b.h;
      if (b.l < a.l) a.l = b.l;
      a.c = b.c;
      a.v += b.v || 0;
    }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

const upsertStmt = marketDb.prepare(
  `INSERT INTO prices (instrument_id, ts, o, h, l, c, v, timeframe)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(instrument_id, timeframe, ts) DO UPDATE SET
     o = excluded.o, h = excluded.h, l = excluded.l,
     c = excluded.c, v = excluded.v`
);

function upsertPrices(instId, tf, bars) {
  const tx = marketDb.transaction((rows) => {
    let n = 0;
    for (const b of rows) {
      upsertStmt.run(instId, b.ts, b.o, b.h, b.l, b.c, b.v, tf);
      n++;
    }
    return n;
  });
  return tx(bars);
}

function lastStoredTs(instId, tf) {
  const row = marketDb
    .prepare('SELECT MAX(ts) as maxTs FROM prices WHERE instrument_id = ? AND timeframe = ?')
    .get(instId, tf);
  return row?.maxTs ?? null;
}

export async function ingestOanda({ days = 5 } = {}) {
  if (!oandaConfigured()) return { skipped: true, reason: 'OANDA_API_TOKEN not set' };

  const results = [];
  for (const { symbol } of OANDA_INSTRUMENTS) {
    const instId = instrumentId(symbol);
    if (instId == null) continue;

    const lastTs = lastStoredTs(instId, 'M1');
    const from = lastTs ? new Date(lastTs) : new Date(Date.now() - days * 86400000);
    const to = new Date();

    let m1Bars;
    try {
      const raw = await fetchOandaM1(symbol, from, to);
      m1Bars = raw.map((b) => ({
        ts: new Date(b.t).getTime(),
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume ?? 0,
      }));
    } catch (err) {
      results.push({ symbol, error: err.message });
      updateHealth(symbol, err.message);
      continue;
    }

    if (!m1Bars.length) {
      results.push({ symbol, m1: 0 });
      continue;
    }

    const m1Count = upsertPrices(instId, 'M1', m1Bars);
    const agg = {};
    for (const tf of AGGREGATE_TFS) {
      const tfBars = aggregateM1(m1Bars, tf);
      agg[tf] = upsertPrices(instId, tf, tfBars);
    }

    updateHealth(symbol, null);
    results.push({ symbol, m1: m1Count, aggregated: agg });
  }
  return { results };
}

function updateHealth(symbol, error) {
  const source = `oanda_${symbol.toLowerCase()}`;
  if (error) {
    marketDb.prepare(
      `INSERT INTO source_health (source, last_ok, last_error, status)
       VALUES (?, NULL, ?, 'error')
       ON CONFLICT(source) DO UPDATE SET last_error = excluded.last_error, status = 'error'`
    ).run(source, error);
  } else {
    marketDb.prepare(
      `INSERT INTO source_health (source, last_ok, last_error, status)
       VALUES (?, ?, NULL, 'ok')
       ON CONFLICT(source) DO UPDATE SET last_ok = excluded.last_ok, last_error = NULL, status = 'ok'`
    ).run(source, Date.now());
  }
}

let _running = false;
export async function safeIngestOanda(opts) {
  if (_running) return { skipped: true, reason: 'already running' };
  _running = true;
  try {
    return await ingestOanda(opts);
  } finally {
    _running = false;
  }
}
