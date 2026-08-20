import { fetchOandaM1, fetchOandaCandles, oandaConfigured } from '../../marketdata.js';
import { marketDb, instrumentId } from '../schema.js';

const OANDA_INSTRUMENTS = [
  { symbol: 'XAUUSD', oanda: 'XAU_USD' },
  { symbol: 'US100', oanda: 'NAS100_USD' },
  { symbol: 'XAGUSD', oanda: 'XAG_USD' },
  { symbol: 'WTICO_USD', oanda: 'WTICO_USD' },
];

// Finest free-tier candle (5-second). Ingested for the focus instrument(s) only
// over a bounded recent window — it fills the gaps M1 leaves and gives replay
// sub-minute detail without exploding storage. S5 is stored as its own series;
// higher timeframes still aggregate from M1.
const FINE_TF = 'S5';
const FINE_SYMBOLS = new Set(['XAUUSD']);
const FINE_DAYS = Number(process.env.OANDA_S5_DAYS || 2);

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

const selectM1From = marketDb.prepare(
  `SELECT ts, o, h, l, c, v FROM prices
   WHERE instrument_id = ? AND timeframe = 'M1' AND ts >= ?
   ORDER BY ts`
);

// Re-aggregate every higher timeframe from the COMPLETE M1 history covering the
// affected buckets, not just the freshly-fetched batch. Aggregating only the new
// M1 slice (and upserting via ON CONFLICT) overwrote each in-progress H1/H4/D1
// candle with a partial slice — producing thin/degenerate candles that render as
// gaps. `fromTs` is the earliest M1 timestamp touched; we rebuild from the start
// of the bucket that timestamp falls into so partial candles are made whole.
function reaggregateFrom(instId, fromTs) {
  const agg = {};
  for (const tf of AGGREGATE_TFS) {
    const ms = TF_MINUTES[tf] * 60000;
    const bucketStart = Math.floor(fromTs / ms) * ms;
    const m1 = selectM1From.all(instId, bucketStart);
    const tfBars = aggregateM1(m1, tf);
    agg[tf] = upsertPrices(instId, tf, tfBars);
  }
  return agg;
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
    const minNewTs = m1Bars.reduce((min, b) => (b.ts < min ? b.ts : min), m1Bars[0].ts);
    const agg = reaggregateFrom(instId, minNewTs);

    // Finest-granularity (S5) feed for the focus instrument(s), bounded window.
    let s5Count;
    if (FINE_SYMBOLS.has(symbol)) {
      s5Count = await ingestFine(symbol, instId);
    }

    updateHealth(symbol, null);
    results.push({ symbol, m1: m1Count, aggregated: agg, ...(s5Count != null && { s5: s5Count }) });
  }
  return { results };
}

// Ingest S5 candles for one instrument over a bounded recent window, resuming
// from the last stored S5 bar. Failures are swallowed (S5 is best-effort; M1
// already succeeded) so they never fail the whole ingest.
async function ingestFine(symbol, instId) {
  const lastTs = lastStoredTs(instId, FINE_TF);
  const from = lastTs ? new Date(lastTs) : new Date(Date.now() - FINE_DAYS * 86400000);
  try {
    const raw = await fetchOandaCandles(symbol, from, new Date(), FINE_TF);
    if (!raw.length) return 0;
    const bars = raw.map((b) => ({
      ts: new Date(b.t).getTime(),
      o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0,
    }));
    return upsertPrices(instId, FINE_TF, bars);
  } catch (err) {
    console.error(`[signal] S5 ingest ${symbol} failed:`, err.message);
    return null;
  }
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

// One-time repair: rebuild every higher timeframe for every OANDA instrument
// from the full M1 history, fixing candles corrupted by the old partial-slice
// aggregation. Safe to run repeatedly (idempotent upsert).
export function rebuildAggregates() {
  const results = [];
  for (const { symbol } of OANDA_INSTRUMENTS) {
    const instId = instrumentId(symbol);
    if (instId == null) continue;
    const first = marketDb
      .prepare("SELECT MIN(ts) AS minTs FROM prices WHERE instrument_id = ? AND timeframe = 'M1'")
      .get(instId);
    if (first?.minTs == null) {
      results.push({ symbol, skipped: 'no M1 data' });
      continue;
    }
    results.push({ symbol, rebuilt: reaggregateFrom(instId, first.minTs) });
  }
  return { results };
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
