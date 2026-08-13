import { Router } from 'express';
import { marketDb, MARKET_DB_PATH, instrumentId } from './schema.js';
import { analyticsHealth, compute } from './analyticsClient.js';
import { safeIngestOanda } from './ingest/oanda.js';
import { ingestConstituents, getConstituents, isMag7 } from './ingest/constituents.js';
import { alpacaConfigured, fetchSnapshots } from './ingest/alpaca.js';
import { fredConfigured, ingestFredSeries, getSeriesData, getSeriesMeta, listSeries, seedSeriesRegistry, ingestAllFred } from './ingest/fred.js';
import { ingestEarnings, getUpcomingEarnings } from './ingest/finnhub.js';
import { getLatestVol, getVolHistory, ingestAllVol, seedVolSeries } from './ingest/cboe.js';
import { callLLM } from '../ai.js';
import {
  FRED_API_KEY,
  FINNHUB_KEY,
  ALPACA_KEY,
  OANDA_API_TOKEN,
} from '../env.js';

export const researchRouter = Router();

const VALID_TF = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']);
const SYMBOL_MAP = { XAUUSD: 'XAUUSD', US100: 'US100', xauusd: 'XAUUSD', us100: 'US100' };

function resolveInstrument(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  return SYMBOL_MAP[s] ?? null;
}

// GET /api/research/health
researchRouter.get('/health', async (_req, res) => {
  const analytics = await analyticsHealth();

  let dbOk = false;
  let schemaVersion = null;
  try {
    const row = marketDb.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    schemaVersion = row?.value ?? null;
    dbOk = true;
  } catch (err) {
    dbOk = false;
  }

  res.json({
    server: 'ok',
    marketDb: dbOk ? 'ok' : 'error',
    schema_version: schemaVersion,
    market_db_path: MARKET_DB_PATH,
    analytics: analytics.status,
    analytics_detail: analytics.detail,
    providers: {
      oanda: Boolean(OANDA_API_TOKEN),
      fred: Boolean(FRED_API_KEY),
      finnhub: Boolean(FINNHUB_KEY),
      alpaca: Boolean(ALPACA_KEY),
    },
  });
});

// GET /api/research/price/:instrument?tf=H1&from=&to=&limit=
researchRouter.get('/price/:instrument', (req, res) => {
  const symbol = resolveInstrument(req.params.instrument);
  if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
  const instId = instrumentId(symbol);
  if (instId == null) return res.status(400).json({ error: 'Instrument not seeded' });

  const tf = (req.query.tf || 'H1').toUpperCase();
  if (!VALID_TF.has(tf)) return res.status(400).json({ error: `Invalid timeframe: ${tf}` });

  const from = req.query.from ? Number(req.query.from) : null;
  const to = req.query.to ? Number(req.query.to) : null;
  const limit = Math.min(Number(req.query.limit) || 5000, 10000);

  let query = 'SELECT ts, o, h, l, c, v FROM prices WHERE instrument_id = ? AND timeframe = ?';
  const params = [instId, tf];
  if (from) { query += ' AND ts >= ?'; params.push(from); }
  if (to) { query += ' AND ts <= ?'; params.push(to); }
  query += ' ORDER BY ts ASC LIMIT ?';
  params.push(limit);

  const rows = marketDb.prepare(query).all(...params);

  const freshness = marketDb
    .prepare("SELECT last_ok, status FROM source_health WHERE source = ?")
    .get(`oanda_${symbol.toLowerCase()}`);

  res.json({
    instrument: symbol,
    timeframe: tf,
    count: rows.length,
    bars: rows,
    freshness: freshness
      ? { source: 'oanda', last_ok: freshness.last_ok, status: freshness.status }
      : { source: 'oanda', last_ok: null, status: 'no_data' },
  });
});

// GET /api/research/price/:instrument/export?tf=H1
researchRouter.get('/price/:instrument/export', (req, res) => {
  const symbol = resolveInstrument(req.params.instrument);
  if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
  const instId = instrumentId(symbol);
  if (instId == null) return res.status(400).json({ error: 'Instrument not seeded' });

  const tf = (req.query.tf || 'H1').toUpperCase();
  if (!VALID_TF.has(tf)) return res.status(400).json({ error: `Invalid timeframe: ${tf}` });

  const from = req.query.from ? Number(req.query.from) : null;
  const to = req.query.to ? Number(req.query.to) : null;

  let query = 'SELECT ts, o, h, l, c, v FROM prices WHERE instrument_id = ? AND timeframe = ?';
  const params = [instId, tf];
  if (from) { query += ' AND ts >= ?'; params.push(from); }
  if (to) { query += ' AND ts <= ?'; params.push(to); }
  query += ' ORDER BY ts ASC';

  const rows = marketDb.prepare(query).all(...params);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${symbol}_${tf}.csv"`);

  let csv = 'time,open,high,low,close,volume\n';
  for (const r of rows) {
    csv += `${new Date(r.ts).toISOString()},${r.o},${r.h},${r.l},${r.c},${r.v ?? 0}\n`;
  }
  res.send(csv);
});

// POST /api/research/ingest — trigger a manual ingest
researchRouter.post('/ingest', async (req, res) => {
  try {
    const result = await safeIngestOanda({ days: Number(req.body?.days) || 5 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/constituents/us100 — QQQ members + weights + live quotes
researchRouter.get('/constituents/us100', async (_req, res) => {
  try {
    let rows = getConstituents();
    if (!rows.length) {
      ingestConstituents();
      rows = getConstituents();
    }

    const symbols = rows.map((r) => r.symbol);
    let quotes = {};
    try {
      if (alpacaConfigured()) quotes = await fetchSnapshots(symbols);
    } catch { /* degrade gracefully — show table without quotes */ }

    const members = rows.map((r) => ({
      symbol: r.symbol,
      weight: r.weight,
      sector: r.sector,
      mag7: isMag7(r.symbol),
      quote: quotes[r.symbol] ?? null,
    }));

    const freshness = marketDb
      .prepare("SELECT last_ok, status FROM source_health WHERE source = 'constituents_qqq'")
      .get();

    res.json({
      index: 'US100',
      count: members.length,
      members,
      freshness: freshness
        ? { source: 'constituents', last_ok: freshness.last_ok, status: freshness.status }
        : { source: 'constituents', last_ok: null, status: 'no_data' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/contribution/us100 — Mag-7/full contribution grid
researchRouter.get('/contribution/us100', async (_req, res) => {
  try {
    let rows = getConstituents();
    if (!rows.length) {
      ingestConstituents();
      rows = getConstituents();
    }
    const symbols = rows.map((r) => r.symbol);
    let quotes = {};
    try {
      if (alpacaConfigured()) quotes = await fetchSnapshots(symbols);
    } catch { /* degrade */ }

    const members = rows.map((r) => {
      const q = quotes[r.symbol];
      const changePct = q?.changePct ?? 0;
      const contribution = (r.weight / 100) * changePct;
      return {
        symbol: r.symbol,
        weight: r.weight,
        sector: r.sector,
        mag7: isMag7(r.symbol),
        price: q?.price ?? null,
        change: q?.change ?? null,
        changePct: q?.changePct ?? null,
        contribution,
      };
    });

    members.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    const mag7 = members.filter((m) => m.mag7);
    const totalContrib = members.reduce((s, m) => s + m.contribution, 0);
    const mag7Contrib = mag7.reduce((s, m) => s + m.contribution, 0);
    const mag7Weight = mag7.reduce((s, m) => s + m.weight, 0);

    const bySector = {};
    for (const m of members) {
      const sec = m.sector || 'Other';
      if (!bySector[sec]) bySector[sec] = { weight: 0, contribution: 0, count: 0 };
      bySector[sec].weight += m.weight;
      bySector[sec].contribution += m.contribution;
      bySector[sec].count++;
    }

    res.json({
      members,
      summary: {
        totalContrib,
        mag7Contrib,
        mag7Weight,
        broadContrib: totalContrib - mag7Contrib,
        broadVsNarrow: mag7Contrib !== 0
          ? ((totalContrib - mag7Contrib) / Math.abs(mag7Contrib)) * 100
          : null,
      },
      sectors: bySector,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/breadth/us100 — breadth metrics + treemap data
researchRouter.get('/breadth/us100', async (_req, res) => {
  try {
    let rows = getConstituents();
    if (!rows.length) {
      ingestConstituents();
      rows = getConstituents();
    }
    const symbols = rows.map((r) => r.symbol);
    let quotes = {};
    try {
      if (alpacaConfigured()) quotes = await fetchSnapshots(symbols);
    } catch { /* degrade */ }

    let up = 0, down = 0, unchanged = 0;
    const treemap = [];
    for (const r of rows) {
      const q = quotes[r.symbol];
      const chg = q?.changePct ?? 0;
      if (chg > 0.01) up++;
      else if (chg < -0.01) down++;
      else unchanged++;
      treemap.push({
        symbol: r.symbol,
        weight: r.weight,
        sector: r.sector,
        changePct: q?.changePct ?? null,
        price: q?.price ?? null,
        mag7: isMag7(r.symbol),
      });
    }

    const total = up + down + unchanged;
    res.json({
      breadth: {
        advancers: up,
        decliners: down,
        unchanged,
        total,
        advPct: total ? (up / total) * 100 : 0,
        decPct: total ? (down / total) * 100 : 0,
        adRatio: down ? up / down : up > 0 ? Infinity : 1,
      },
      treemap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/series/:id?from=&to=&limit= — generic FRED/series data
researchRouter.get('/series/:id', (req, res) => {
  const seriesId = req.params.id.toUpperCase();
  const meta = getSeriesMeta(seriesId);
  if (!meta) return res.status(404).json({ error: `Unknown series: ${seriesId}` });

  const from = req.query.from ? Number(req.query.from) : null;
  const to = req.query.to ? Number(req.query.to) : null;
  const limit = Math.min(Number(req.query.limit) || 2000, 10000);

  const data = getSeriesData(seriesId, { from, to, limit });
  const freshness = marketDb
    .prepare("SELECT last_ok, status FROM source_health WHERE source = ?")
    .get(`fred_${seriesId.toLowerCase()}`);

  res.json({
    meta,
    count: data.length,
    data,
    freshness: freshness
      ? { source: 'fred', last_ok: freshness.last_ok, status: freshness.status }
      : { source: 'fred', last_ok: null, status: 'no_data' },
  });
});

// GET /api/research/series — list all known series
researchRouter.get('/series', (_req, res) => {
  seedSeriesRegistry();
  res.json(listSeries());
});

// POST /api/research/ingest/fred — trigger FRED ingest
researchRouter.post('/ingest/fred', async (req, res) => {
  try {
    const results = await ingestAllFred({ years: Number(req.body?.years) || 5 });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/overlay/us100/rates — US100 vs inverted 10Y + rolling correlation
researchRouter.get('/overlay/us100/rates', (req, res) => {
  try {
    const instId = instrumentId('US100');
    const limit = Math.min(Number(req.query.limit) || 500, 2000);

    const us100 = marketDb.prepare(
      `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
       ORDER BY ts DESC LIMIT ?`
    ).all(instId, limit).reverse();

    const dgs10 = getSeriesData('DGS10', { limit });
    const dfii10 = getSeriesData('DFII10', { limit });

    res.json({ us100, dgs10, dfii10 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/earnings/us100 — constituent earnings
researchRouter.get('/earnings/us100', async (req, res) => {
  try {
    let rows = getConstituents();
    if (!rows.length) {
      ingestConstituents();
      rows = getConstituents();
    }
    const symbols = rows.map((r) => r.symbol);

    let earnings = getUpcomingEarnings(symbols);
    if (!earnings.length) {
      try {
        await ingestEarnings(symbols);
        earnings = getUpcomingEarnings(symbols);
      } catch { /* degrade */ }
    }

    const weightMap = {};
    for (const r of rows) weightMap[r.symbol] = r.weight;

    const enriched = earnings.map((e) => ({
      ...e,
      weight: weightMap[e.symbol] ?? 0,
      importance: (weightMap[e.symbol] ?? 0) * 10,
      mag7: isMag7(e.symbol),
    }));
    enriched.sort((a, b) => a.report_date - b.report_date);

    const freshness = marketDb
      .prepare("SELECT last_ok, status FROM source_health WHERE source = 'finnhub_earnings'")
      .get();

    res.json({
      count: enriched.length,
      earnings: enriched,
      freshness: freshness
        ? { source: 'finnhub', last_ok: freshness.last_ok, status: freshness.status }
        : { source: 'finnhub', last_ok: null, status: 'no_data' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/vol/:instrument — IV/RV, VXN/GVZ, expected move
researchRouter.get('/vol/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });

    seedVolSeries();
    const volSeriesId = symbol === 'US100' ? 'VXN' : 'GVZ';
    const latest = getLatestVol(volSeriesId);
    const history = getVolHistory(volSeriesId, { limit: 60 });

    const iv = latest?.value ?? null;
    let expectedMoveDay = null;
    let expectedMoveWeek = null;

    if (iv != null) {
      const instId = instrumentId(symbol);
      const lastPrice = marketDb.prepare(
        `SELECT c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 1`
      ).get(instId);
      const price = lastPrice?.c;
      if (price) {
        expectedMoveDay = price * (iv / 100) / Math.sqrt(252);
        expectedMoveWeek = price * (iv / 100) / Math.sqrt(52);
      }
    }

    const vals = history.map((h) => h.value).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const max = vals.length ? Math.max(...vals) : null;
    const min = vals.length ? Math.min(...vals) : null;
    const pctRank = iv != null && vals.length
      ? (vals.filter((v) => v <= iv).length / vals.length) * 100
      : null;

    res.json({
      instrument: symbol,
      volIndex: volSeriesId,
      current: iv,
      pctRank,
      avg60d: avg,
      high60d: max,
      low60d: min,
      expectedMove: {
        daily: expectedMoveDay,
        weekly: expectedMoveWeek,
      },
      history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/research/ingest/cboe — trigger CBOE vol ingest
researchRouter.post('/ingest/cboe', async (_req, res) => {
  try {
    const results = await ingestAllVol();
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/brief/:instrument — cached AI daily brief
researchRouter.get('/brief/:instrument', async (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateMs = today.getTime();

    const cached = marketDb.prepare(
      'SELECT * FROM briefs WHERE instrument = ? AND date = ?'
    ).get(symbol, dateMs);

    if (cached) {
      return res.json({
        instrument: symbol,
        date: dateMs,
        content: cached.content,
        model: cached.model,
        cached: true,
      });
    }

    const instId = instrumentId(symbol);
    const recentBars = marketDb.prepare(
      `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
       ORDER BY ts DESC LIMIT 10`
    ).all(instId).reverse();

    const volSeriesId = symbol === 'US100' ? 'VXN' : 'GVZ';
    const latestVol = getLatestVol(volSeriesId);

    let context = `${symbol} — Last 10 daily bars:\n`;
    for (const b of recentBars) {
      context += `${new Date(b.ts).toISOString().slice(0, 10)}: O=${b.o} H=${b.h} L=${b.l} C=${b.c}\n`;
    }
    if (latestVol) context += `\n${volSeriesId}: ${latestVol.value}`;

    if (symbol === 'US100') {
      let rows = getConstituents();
      if (rows.length) {
        const mag7 = rows.filter((r) => isMag7(r.symbol));
        context += `\nMag-7 weights: ${mag7.map((r) => `${r.symbol} ${r.weight}%`).join(', ')}`;
      }
    }

    const system = `You are a concise market analyst. Provide a brief daily analysis (3-5 bullet points) for the given instrument. Include: trend assessment, key levels, volatility read, and what to watch. Use data provided only — never invent numbers.`;
    const prompt = `Generate today's daily brief for ${symbol}.\n\n${context}`;

    let content, model;
    try {
      const result = await callLLM({ system, prompt });
      content = result.text;
      model = result.model;
    } catch (err) {
      return res.json({
        instrument: symbol,
        date: dateMs,
        content: null,
        model: null,
        error: err.message,
      });
    }

    marketDb.prepare(
      `INSERT INTO briefs (instrument, date, content, model) VALUES (?, ?, ?, ?)
       ON CONFLICT(instrument, date) DO UPDATE SET content = excluded.content, model = excluded.model`
    ).run(symbol, dateMs, content, model);

    res.json({ instrument: symbol, date: dateMs, content, model, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/rates — rates board (nominal/real/spreads/breakevens/fed/DXY)
researchRouter.get('/rates', (_req, res) => {
  try {
    seedSeriesRegistry();
    const ids = [
      'DGS3MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS30',
      'DFII5', 'DFII10', 'T5YIE', 'T10YIE', 'T10Y2Y',
      'DTWEXBGS', 'FEDFUNDS', 'BAMLH0A0HYM2',
    ];
    const board = {};
    for (const id of ids) {
      const latest = marketDb.prepare(
        'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
      ).get(id);
      const prev = marketDb.prepare(
        'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1 OFFSET 1'
      ).get(id);
      const meta = getSeriesMeta(id);
      board[id] = {
        name: meta?.name ?? id,
        unit: meta?.unit ?? '',
        value: latest?.value ?? null,
        ts: latest?.ts ?? null,
        prev: prev?.value ?? null,
        change: latest?.value != null && prev?.value != null
          ? latest.value - prev.value : null,
      };
    }

    // Yield curve points for chart
    const curveIds = ['DGS3MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS30'];
    const curveLabels = ['3M', '1Y', '2Y', '5Y', '10Y', '30Y'];
    const yieldCurve = curveIds.map((id, i) => ({
      tenor: curveLabels[i],
      yield: board[id]?.value ?? null,
    }));

    res.json({ board, yieldCurve });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/econ — economic data tracker + surprise
researchRouter.get('/econ', (_req, res) => {
  try {
    seedSeriesRegistry();
    const econIds = ['CPIAUCSL', 'PCEPI', 'PAYEMS', 'UNRATE', 'FEDFUNDS'];
    const indicators = [];

    for (const id of econIds) {
      const meta = getSeriesMeta(id);
      // Pull 13 monthly points so YoY spans a true 12 months (latest vs 12 back).
      const recent = marketDb.prepare(
        'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 13'
      ).all(id).reverse();
      const latest = recent.length ? recent[recent.length - 1] : null;
      const prev = recent.length > 1 ? recent[recent.length - 2] : null;
      const yearAgo = recent.length >= 13 ? recent[recent.length - 13] : null;

      let mom = null;
      let yoy = null;
      if (latest && prev && prev.value) {
        mom = ((latest.value - prev.value) / prev.value) * 100;
      }
      if (latest && yearAgo && yearAgo.value) {
        yoy = ((latest.value - yearAgo.value) / yearAgo.value) * 100;
      }

      indicators.push({
        id,
        name: meta?.name ?? id,
        unit: meta?.unit ?? '',
        value: latest?.value ?? null,
        ts: latest?.ts ?? null,
        prev: prev?.value ?? null,
        mom,
        yoy,
        sparkline: recent.slice(-12).map((r) => r.value),
      });
    }

    res.json({ indicators });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/regime — risk regime label
researchRouter.get('/regime', (_req, res) => {
  try {
    seedVolSeries();
    const vix = getLatestVol('VIX');
    const vxn = getLatestVol('VXN');

    const dxy = marketDb.prepare(
      'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
    ).get('DTWEXBGS');

    const hySpread = marketDb.prepare(
      'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 1'
    ).get('BAMLH0A0HYM2');

    const vixVal = vix?.value ?? null;
    const hyVal = hySpread?.value ?? null;

    let score = 0;
    let factors = [];

    // Factor signals are constrained to bullish/neutral/bearish so the panel's
    // SIGNAL_COLOR map (green/muted/red) resolves every row.
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

    if (dxy?.value != null) {
      factors.push({ name: 'DXY', value: dxy.value, signal: 'neutral' });
    }

    if (vxn?.value != null) {
      factors.push({ name: 'VXN', value: vxn.value, signal: 'neutral' });
    }

    // Regime vocabulary matches the API contract + RegimePanel badge map:
    // risk-on / neutral / risk-off / crisis.
    let regime;
    if (score >= 2) regime = 'risk-on';
    else if (score >= 0) regime = 'neutral';
    else if (score >= -2) regime = 'risk-off';
    else regime = 'crisis';

    res.json({ regime, score, factors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
