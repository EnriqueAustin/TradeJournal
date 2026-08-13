import { marketDb } from '../schema.js';

const upsertSeries = marketDb.prepare(
  `INSERT INTO series (series_id, source, name, unit)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(series_id) DO UPDATE SET name = excluded.name, unit = excluded.unit`
);

const upsertData = marketDb.prepare(
  `INSERT INTO series_data (series_id, ts, value)
   VALUES (?, ?, ?)
   ON CONFLICT(series_id, ts) DO UPDATE SET value = excluded.value`
);

const VOL_SERIES = [
  { id: 'VIX', name: 'CBOE VIX', unit: 'index' },
  { id: 'VXN', name: 'CBOE Nasdaq-100 Volatility (VXN)', unit: 'index' },
  { id: 'GVZ', name: 'CBOE Gold Volatility (GVZ)', unit: 'index' },
];

export function seedVolSeries() {
  for (const s of VOL_SERIES) {
    upsertSeries.run(s.id, 'cboe', s.name, s.unit);
  }
}

export async function ingestVolIndex(seriesId, { days = 365 } = {}) {
  const urls = {
    VIX: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
    VXN: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv',
    GVZ: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/GVZ_History.csv',
  };

  const url = urls[seriesId];
  if (!url) return { skipped: true, reason: `Unknown vol series: ${seriesId}` };

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CBOE ${seriesId} ${res.status}`);
  }
  const text = await res.text();
  const lines = text.trim().split('\n');

  const cutoff = Date.now() - days * 86400000;

  const tx = marketDb.transaction(() => {
    let n = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((s) => s.trim());
      // VIX/VXN are DATE,OPEN,HIGH,LOW,CLOSE (5 col); GVZ is DATE,GVZ (2 col).
      // The close/level is always the last column.
      if (cols.length < 2) continue;
      const dateStr = cols[0];
      const close = parseFloat(cols[cols.length - 1]);
      if (isNaN(close)) continue;

      let ts;
      if (dateStr.includes('/')) {
        const [m, d, y] = dateStr.split('/');
        ts = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`).getTime();
      } else {
        ts = new Date(dateStr + 'T00:00:00Z').getTime();
      }
      if (isNaN(ts) || ts < cutoff) continue;

      upsertData.run(seriesId, ts, close);
      n++;
    }
    return n;
  });

  const count = tx();
  updateHealth(seriesId, null);
  return { seriesId, count };
}

export async function ingestAllVol(opts) {
  seedVolSeries();
  const results = [];
  for (const s of VOL_SERIES) {
    try {
      results.push(await ingestVolIndex(s.id, opts));
    } catch (err) {
      updateHealth(s.id, err.message);
      results.push({ seriesId: s.id, error: err.message });
    }
  }
  return results;
}

function updateHealth(seriesId, error) {
  const source = `cboe_${seriesId.toLowerCase()}`;
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

export function getLatestVol(seriesId) {
  return marketDb.prepare(
    'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
  ).get(seriesId) ?? null;
}

export function getVolHistory(seriesId, { limit = 252 } = {}) {
  return marketDb.prepare(
    'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
  ).all(seriesId, limit).reverse();
}
