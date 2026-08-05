import { parseBarTime, normalizeInstrument } from './util.js';

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
