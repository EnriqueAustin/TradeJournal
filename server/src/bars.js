import { parseBarTime, normalizeInstrument } from './util.js';
import { db } from './db.js';

// Minutes per timeframe. Used for aggregation + choosing a base series.
// Sub-minute timeframes are intentionally absent here (they don't divide into
// whole minutes) — use TF_MS / tfMs() for anything that needs sub-minute spans.
export const TF_MINUTES = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H2: 120,
  H4: 240,
  D1: 1440,
};

export function tfMinutes(tf) {
  return TF_MINUTES[tf] ?? null;
}

// Milliseconds per timeframe, including the sub-minute (S5/S15/S30) candles the
// finest OANDA feed provides. This is the canonical span map — prefer it over
// TF_MINUTES wherever a duration is needed, so S5 is handled everywhere.
export const TF_MS = {
  S5: 5000,
  S15: 15000,
  S30: 30000,
  M1: 60000,
  M5: 300000,
  M15: 900000,
  M30: 1800000,
  H1: 3600000,
  H2: 7200000,
  H4: 14400000,
  D1: 86400000,
};

export function tfMs(tf) {
  return TF_MS[tf] ?? null;
}

// Is `tf` a timeframe we understand (minute or sub-minute)?
export function isKnownTf(tf) {
  return tf in TF_MS;
}

// Roll ascending base bars up into `tf` buckets (open=first, close=last,
// high=max, low=min, volume=sum). baseBars MUST be sorted ascending by t.
export function aggregateBars(baseBars, tf) {
  const size = TF_MINUTES[tf];
  if (!size) return [];
  const ms = size * 60000;
  const buckets = new Map();
  for (const b of baseBars) {
    const tms = new Date(b.t).getTime();
    if (Number.isNaN(tms)) continue;
    const bucket = Math.floor(tms / ms) * ms;
    const a = buckets.get(bucket);
    if (!a) {
      buckets.set(bucket, {
        t: new Date(bucket).toISOString(),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      });
    } else {
      if (b.high > a.high) a.high = b.high;
      if (b.low < a.low) a.low = b.low;
      a.close = b.close;
      a.volume += b.volume ?? 0;
    }
  }
  return [...buckets.values()].sort(
    (x, y) => new Date(x.t).getTime() - new Date(y.t).getTime()
  );
}

// Upsert bars into price_bars for (instrument, tf); returns row count written.
export function upsertBars(instrument, tf, bars) {
  const inst = normalizeInstrument(instrument);
  const stmt = db.prepare(
    `INSERT INTO price_bars (instrument, tf, t, open, high, low, close, volume)
     VALUES (@instrument, @tf, @t, @open, @high, @low, @close, @volume)
     ON CONFLICT(instrument, tf, t) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, volume = excluded.volume`
  );
  const tx = db.transaction((rows) => {
    let n = 0;
    for (const b of rows) {
      stmt.run({
        instrument: inst,
        tf,
        t: b.t,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? null,
      });
      n++;
    }
    return n;
  });
  return tx(bars);
}

// Return bars for (instrument, tf), preferring stored bars and falling back to
// aggregation from the largest finer stored TF that divides `tf` evenly.
// → { bars, source: 'stored' | `agg:<baseTf>` | 'none' }.
export function getBarsForTf(instrument, tf) {
  const inst = normalizeInstrument(instrument);
  const stored = db
    .prepare(
      `SELECT t, open, high, low, close, volume FROM price_bars
       WHERE instrument = ? AND tf = ? ORDER BY t ASC`
    )
    .all(inst, tf);
  if (stored.length) return { bars: stored, source: 'stored' };

  const size = TF_MINUTES[tf];
  if (!size) return { bars: [], source: 'none' };

  const avail = db
    .prepare('SELECT DISTINCT tf FROM price_bars WHERE instrument = ?')
    .all(inst)
    .map((r) => r.tf);
  let base = null;
  let baseM = 0;
  for (const c of avail) {
    const m = TF_MINUTES[c];
    if (m && m < size && size % m === 0 && m > baseM) {
      base = c;
      baseM = m;
    }
  }
  if (!base) return { bars: [], source: 'none' };

  const src = db
    .prepare(
      `SELECT t, open, high, low, close, volume FROM price_bars
       WHERE instrument = ? AND tf = ? ORDER BY t ASC`
    )
    .all(inst, base);
  return { bars: aggregateBars(src, tf), source: `agg:${base}` };
}

// Minimal CSV splitter (bars files are simple, no embedded quotes/newlines).
function splitCsv(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => l.split(',').map((c) => c.trim()));
}

const HEADER_ALIASES = {
  time: ['time', 'date', 'datetime', 'timestamp', 't'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c'],
  volume: ['vol', 'volume', 'v', 'tickvol', 'tick_volume'],
};

function num(v) {
  if (v === undefined || v === null) return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Parse a bars CSV (header: time,open,high,low,close,vol) into bar rows.
// Returns { bars:[{t,open,high,low,close,volume}], skipped }.
export function parseBarsCsv(buffer, { instrument, tf }) {
  const rows = splitCsv(buffer.toString('utf8'));
  if (rows.length === 0) return { bars: [], skipped: 0 };

  const norm = rows[0].map((h) => h.toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    map[key] = norm.findIndex((h) => aliases.includes(h));
  }
  // If no recognizable header, assume positional time,open,high,low,close,vol.
  const hasHeader = map.time !== -1 && map.open !== -1;
  const startIdx = hasHeader ? 1 : 0;
  const idx = hasHeader
    ? map
    : { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 };

  const inst = normalizeInstrument(instrument);
  const bars = [];
  let skipped = 0;
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    const t = parseBarTime(r[idx.time]);
    const open = num(r[idx.open]);
    const high = num(r[idx.high]);
    const low = num(r[idx.low]);
    const close = num(r[idx.close]);
    if (!t || open == null || high == null || low == null || close == null) {
      skipped++;
      continue;
    }
    bars.push({
      instrument: inst,
      tf,
      t,
      open,
      high,
      low,
      close,
      volume: idx.volume === -1 ? null : num(r[idx.volume]),
    });
  }
  return { bars, skipped };
}
