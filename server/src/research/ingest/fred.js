import { FRED_API_KEY } from '../../env.js';
import { marketDb } from '../schema.js';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

export function fredConfigured() {
  return Boolean(FRED_API_KEY);
}

const SERIES_REGISTRY = [
  { id: 'DGS10', name: '10-Year Treasury Yield', unit: 'percent', source: 'fred' },
  { id: 'DGS2', name: '2-Year Treasury Yield', unit: 'percent', source: 'fred' },
  { id: 'DGS30', name: '30-Year Treasury Yield', unit: 'percent', source: 'fred' },
  { id: 'DFII10', name: '10-Year TIPS (Real Yield)', unit: 'percent', source: 'fred' },
  { id: 'DFII5', name: '5-Year TIPS (Real Yield)', unit: 'percent', source: 'fred' },
  { id: 'T10YIE', name: '10-Year Breakeven Inflation', unit: 'percent', source: 'fred' },
  { id: 'T5YIE', name: '5-Year Breakeven Inflation', unit: 'percent', source: 'fred' },
  { id: 'DTWEXBGS', name: 'Trade-Weighted USD (Broad)', unit: 'index', source: 'fred' },
];

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

export function seedSeriesRegistry() {
  const tx = marketDb.transaction(() => {
    for (const s of SERIES_REGISTRY) {
      upsertSeries.run(s.id, s.source, s.name, s.unit);
    }
  });
  tx();
}

export async function ingestFredSeries(seriesId, { years = 5 } = {}) {
  if (!fredConfigured()) return { skipped: true, reason: 'FRED_API_KEY not set' };

  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  const fromStr = from.toISOString().slice(0, 10);

  const url = `${BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&observation_start=${fromStr}&sort_order=asc`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FRED ${seriesId} ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const obs = body.observations || [];

  const tx = marketDb.transaction((rows) => {
    let n = 0;
    for (const o of rows) {
      if (o.value === '.') continue;
      const val = parseFloat(o.value);
      if (isNaN(val)) continue;
      const ts = new Date(o.date + 'T00:00:00Z').getTime();
      upsertData.run(seriesId, ts, val);
      n++;
    }
    return n;
  });

  const count = tx(obs);
  updateHealth(seriesId, null);
  return { seriesId, count };
}

export async function ingestAllFred(opts) {
  seedSeriesRegistry();
  const results = [];
  for (const s of SERIES_REGISTRY) {
    try {
      const r = await ingestFredSeries(s.id, opts);
      results.push(r);
    } catch (err) {
      updateHealth(s.id, err.message);
      results.push({ seriesId: s.id, error: err.message });
    }
  }
  return results;
}

export function getSeriesData(seriesId, { from, to, limit = 2000 } = {}) {
  let query = 'SELECT ts, value FROM series_data WHERE series_id = ?';
  const params = [seriesId];
  if (from) { query += ' AND ts >= ?'; params.push(from); }
  if (to) { query += ' AND ts <= ?'; params.push(to); }
  query += ' ORDER BY ts ASC LIMIT ?';
  params.push(limit);
  return marketDb.prepare(query).all(...params);
}

export function getSeriesMeta(seriesId) {
  return marketDb.prepare('SELECT * FROM series WHERE series_id = ?').get(seriesId) ?? null;
}

export function listSeries() {
  return marketDb.prepare('SELECT * FROM series ORDER BY series_id').all();
}

function updateHealth(seriesId, error) {
  const source = `fred_${seriesId.toLowerCase()}`;
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
