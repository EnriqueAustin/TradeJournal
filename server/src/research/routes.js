import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { marketDb, MARKET_DB_PATH, instrumentId } from './schema.js';
import { analyticsHealth, compute } from './analyticsClient.js';
import { safeIngestOanda } from './ingest/oanda.js';
import { ingestConstituents, getConstituents, isMag7 } from './ingest/constituents.js';
import { alpacaConfigured, fetchSnapshots } from './ingest/alpaca.js';
import { fredConfigured, ingestFredSeries, getSeriesData, getSeriesMeta, listSeries, seedSeriesRegistry, ingestAllFred } from './ingest/fred.js';
import { ingestEarnings, getUpcomingEarnings } from './ingest/finnhub.js';
import { getLatestVol, getVolHistory, ingestAllVol, seedVolSeries } from './ingest/cboe.js';
import { ingestCftc, getCotHistory } from './ingest/cftc.js';
import { ingestGldEtf, parseAndStoreGld, getEtfHistory } from './ingest/etf.js';
import { ingestCalendar, ingestCalendarPayload, getCalendarEvents, getEventsForReaction } from './ingest/calendar.js';
import { ingestAllNews, getNewsFeed, getNewsSummary } from './ingest/news.js';
import { captureSnapshot, getSnapshot } from './snapshot.js';
import { callLLM } from '../ai.js';
import { db as journalDb } from '../db.js';
import {
  FRED_API_KEY,
  FINNHUB_KEY,
  ALPACA_KEY,
  OANDA_API_TOKEN,
  AI_MODEL,
} from '../env.js';

export const researchRouter = Router();

const VALID_TF = new Set(['S5', 'M1', 'M5', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1']);
const SYMBOL_MAP = { XAUUSD: 'XAUUSD', US100: 'US100', XAGUSD: 'XAGUSD', WTICO_USD: 'WTICO_USD', xauusd: 'XAUUSD', us100: 'US100', xagusd: 'XAGUSD', wtico_usd: 'WTICO_USD' };

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

// GET /api/research/brief/:instrument?mode=enhanced — cached AI daily brief
researchRouter.get('/brief/:instrument', async (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const enhanced = req.query.mode === 'enhanced';

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateMs = today.getTime();

    const briefType = enhanced ? 'enhanced' : 'basic';
    const cached = marketDb.prepare(
      'SELECT * FROM briefs WHERE instrument = ? AND date = ? AND brief_type = ?'
    ).get(symbol, dateMs, briefType);

    if (cached) {
      return res.json({
        instrument: symbol,
        date: dateMs,
        content: cached.content,
        model: cached.model,
        briefType,
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

    if (enhanced) {
      const recentNews = getNewsFeed({ instrument: symbol, limit: 10 });
      if (recentNews.length) {
        context += '\n\nRecent headlines:\n';
        for (const n of recentNews) {
          const dt = new Date(n.ts).toISOString().slice(0, 16);
          const sent = n.sentiment != null ? ` [sentiment: ${n.sentiment.toFixed(2)}]` : '';
          context += `- ${dt} ${n.headline}${sent}\n`;
        }
      }

      const now = Date.now();
      const upcomingEvents = getCalendarEvents({ impact: 'high', from: now, to: now + 48 * 3600000, limit: 10 });
      if (upcomingEvents.length) {
        context += '\nUpcoming high-impact events (next 48h):\n';
        for (const e of upcomingEvents) {
          const dt = new Date(e.ts).toISOString().slice(0, 16);
          context += `- ${dt} ${e.country} ${e.name}${e.consensus != null ? ` (fcst: ${e.consensus}, prior: ${e.prior})` : ''}\n`;
        }
      }

      seedVolSeries();
      const vixRow = getLatestVol('VIX');
      const hyRow = marketDb.prepare("SELECT value FROM series_data WHERE series_id = 'BAMLH0A0HYM2' ORDER BY ts DESC LIMIT 1").get();
      const regime = computeRegimeForDay(vixRow?.value, hyRow?.value);
      context += `\nRisk regime: ${regime}`;
      if (vixRow) context += ` (VIX: ${vixRow.value})`;
    }

    const system = enhanced
      ? `You are a senior market analyst at a Bloomberg-style terminal. Write a structured daily brief for ${symbol}.

Format:
## Market Snapshot
1-2 sentences: price, trend direction, key level proximity.

## Key Drivers Today
2-3 bullets: what's moving the market (news, events, macro).

## Risk Assessment
1-2 bullets: regime, vol read, positioning extremes.

## What to Watch
2-3 bullets: upcoming events, levels, catalysts.

Rules: Use ONLY the data provided. Never invent numbers. Be specific with prices and levels. If data is missing, say "data unavailable" for that section.`
      : `You are a concise market analyst. Provide a brief daily analysis (3-5 bullet points) for the given instrument. Include: trend assessment, key levels, volatility read, and what to watch. Use data provided only — never invent numbers.`;

    const prompt = `Generate today's ${enhanced ? 'enhanced ' : ''}daily brief for ${symbol}.\n\n${context}`;

    let content, model;
    try {
      content = await callLLM({ system, prompt });
      model = AI_MODEL || 'unknown';
    } catch (err) {
      return res.json({
        instrument: symbol,
        date: dateMs,
        content: null,
        model: null,
        briefType,
        error: err.message,
      });
    }

    marketDb.prepare(
      `INSERT INTO briefs (instrument, date, content, model, brief_type) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(instrument, date) DO UPDATE SET content = excluded.content, model = excluded.model`
    ).run(symbol, dateMs, content, model, briefType);

    res.json({ instrument: symbol, date: dateMs, content, model, briefType, cached: false });
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

// ---------- Analytics result cache (Python compute) ----------
// Keyed by a caller-supplied key that already encodes the data version, so a
// hit means the inputs are unchanged. Payload stored as JSON in analytics_cache.

function analyticsCacheGet(key) {
  const row = marketDb.prepare('SELECT payload FROM analytics_cache WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

function analyticsCacheSet(key, payload) {
  const json = JSON.stringify(payload);
  marketDb.prepare(
    `INSERT INTO analytics_cache (key, input_hash, data_version, payload, ts)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET input_hash=excluded.input_hash,
       data_version=excluded.data_version, payload=excluded.payload, ts=excluded.ts`
  ).run(key, createHash('sha1').update(json).digest('hex'), key, json, Date.now());
}

// ---------- Epic 3 — Gold cockpit ----------

const GOLD_DRIVERS = [
  { id: 'DFII10', name: '10Y Real Yield', relationship: 'inverse', zThresh: 0.5 },
  { id: 'DFII5',  name: '5Y Real Yield',  relationship: 'inverse', zThresh: 0.5 },
  { id: 'DTWEXBGS', name: 'USD Index',    relationship: 'inverse', zThresh: 0.5 },
  { id: 'T10YIE', name: '10Y Breakeven',  relationship: 'direct',  zThresh: 0.5 },
  { id: 'GVZ',    name: 'Gold Vol (GVZ)', relationship: 'direct',  zThresh: 1.0 },
  { id: 'BAMLH0A0HYM2', name: 'HY Spread', relationship: 'direct', zThresh: 0.5 },
  { id: 'FEDFUNDS', name: 'Fed Funds',    relationship: 'inverse', zThresh: 0.5 },
];

function zScore(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (values[values.length - 1] - mean) / sd;
}

function rollingCorrelation(xs, ys) {
  if (xs.length < 5 || ys.length < 5) return null;
  const n = Math.min(xs.length, ys.length);
  const x = xs.slice(-n), y = ys.slice(-n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

// Gather the aligned inputs the driver scorecard needs from market.db.
// Node owns all DB I/O (single writer); the arrays are handed to Python compute
// or to the Node fallback. Returns { gold:[{ts,c}], drivers:[{...,series}] }.
function gatherDriverInputs() {
  seedSeriesRegistry();
  seedVolSeries();
  const instId = instrumentId('XAUUSD');
  const gold = marketDb.prepare(
    `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 120`
  ).all(instId).reverse();

  const drivers = GOLD_DRIVERS.map(drv => {
    let series;
    if (drv.id === 'GVZ') {
      series = getVolHistory('GVZ', { limit: 120 })
        .map(r => ({ ts: r.ts, value: r.value })).filter(r => r.value != null);
    } else {
      series = marketDb.prepare(
        'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 120'
      ).all(drv.id).reverse().filter(r => r.value != null);
    }
    return { id: drv.id, name: drv.name, relationship: drv.relationship, zThresh: drv.zThresh, series };
  });
  return { gold, drivers };
}

// Node fallback: same enriched shape as the Python compute, minus the heavy
// stats (beta/r2/pValue left null; correlation is level-based, not returns-based).
// Used only when the analytics service is unreachable so the panel never blanks.
function computeDriversNode({ gold, drivers }) {
  const goldC = gold.map(r => r.c);
  const signalScores = { bullish: 1, neutral: 0, bearish: -1 };
  const scored = drivers.map(drv => {
    const values = drv.series.map(r => r.value);
    const current = values.length ? values[values.length - 1] : null;
    const z = zScore(values.slice(-60));
    const corr = rollingCorrelation(values.slice(-60), goldC.slice(-60));
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
    return {
      id: drv.id, name: drv.name, value: current,
      zScore: z != null ? Math.round(z * 100) / 100 : null,
      zChange: null, signal,
      correlation: corr != null ? Math.round(corr * 100) / 100 : null,
      beta: null, r2: null, pValue: null, contribution: null,
      relationship: drv.relationship,
    };
  });
  const composite = scored.reduce((s, d) => s + signalScores[d.signal], 0) / (scored.length || 1);
  let label = 'neutral';
  if (composite > 0.3) label = 'tailwind';
  else if (composite < -0.3) label = 'headwind';
  return {
    instrument: 'XAUUSD',
    drivers: scored,
    composite: { score: Math.round(composite * 100) / 100, label, confidence: null },
    engine: 'node',
  };
}

// GET /api/research/drivers/:instrument — driver scorecard (Python compute,
// Node stub fallback). Cached by data-version (latest input ts) so we recompute
// only when new data arrives.
researchRouter.get('/drivers/:instrument', async (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (symbol !== 'XAUUSD') return res.status(400).json({ error: 'Driver scorecard only available for XAUUSD' });

    const inputs = gatherDriverInputs();

    // Data version = newest timestamp across every input series.
    const maxTs = Math.max(
      0,
      ...inputs.gold.map(r => r.ts),
      ...inputs.drivers.flatMap(d => d.series.map(r => r.ts)),
    );
    const cacheKey = `drivers:XAUUSD:v${maxTs}`;

    const fredHealth = marketDb.prepare(
      "SELECT last_ok, status FROM source_health WHERE source = 'fred_dfii10'"
    ).get();
    const freshness = fredHealth
      ? { source: 'fred+cboe', last_ok: fredHealth.last_ok, status: fredHealth.status }
      : { source: 'fred+cboe', last_ok: null, status: 'no_data' };

    const cached = analyticsCacheGet(cacheKey);
    if (cached) return res.json({ ...cached, freshness });

    let result;
    try {
      result = await compute('/compute/drivers', {
        instrument: 'XAUUSD', window: 60, gold: inputs.gold, drivers: inputs.drivers,
      });
      analyticsCacheSet(cacheKey, result);
    } catch {
      // Analytics down → serve the Node stub (not cached; retry Python next call).
      result = computeDriversNode(inputs);
    }

    res.json({ ...result, freshness });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/overlay/xauusd/realyield — gold vs inverted DFII10
researchRouter.get('/overlay/xauusd/realyield', (req, res) => {
  try {
    const instId = instrumentId('XAUUSD');
    const limit = Math.min(Number(req.query.limit) || 250, 2000);

    const gold = marketDb.prepare(
      `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
       ORDER BY ts DESC LIMIT ?`
    ).all(instId, limit).reverse();

    const realYield = getSeriesData('DFII10', { limit });

    // Compute 60-day rolling correlation
    const goldMap = new Map(gold.map(g => [Math.floor(g.ts / 86400000), g.c]));
    const paired = [];
    for (const r of realYield) {
      const dayKey = Math.floor(r.ts / 86400000);
      if (goldMap.has(dayKey)) {
        paired.push({ g: goldMap.get(dayKey), r: r.value });
      }
    }
    const last60 = paired.slice(-60);
    const corr60d = last60.length >= 10
      ? rollingCorrelation(last60.map(p => p.g), last60.map(p => p.r))
      : null;

    res.json({
      gold,
      realYield,
      correlation60d: corr60d != null ? Math.round(corr60d * 100) / 100 : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Session windows in UTC hours [startHour, endHour). Asian = Tokyo/Sydney,
// London = pre-NY European session, NY = the session the strategy trades.
const SESSION_WINDOWS = [
  { key: 'ASIA', label: 'Asian', start: 0, end: 7 },
  { key: 'LON', label: 'London', start: 7, end: 12 },
];
const LON_OPEN_HOUR = 7; // ~London session open (07:00 UTC); first bar at/after
const NY_OPEN_HOUR = 13; // ~NY session open (13:00 UTC); first bar at/after this

// Compute intraday session liquidity levels from the latest day of M1 bars.
// Returns level rows { label, price, type:'session' } for the Asian & London
// range extremes, the NY open, and the current day's running high/low.
function computeSessionLevels(instId) {
  const latest = marketDb
    .prepare("SELECT MAX(ts) AS maxTs FROM prices WHERE instrument_id = ? AND timeframe = 'M1'")
    .get(instId);
  if (latest?.maxTs == null) return [];

  // Start of the UTC day the latest M1 bar falls in.
  const dayStart = Math.floor(latest.maxTs / 86400000) * 86400000;
  const m1 = marketDb
    .prepare(
      `SELECT ts, o, h, l, c FROM prices
       WHERE instrument_id = ? AND timeframe = 'M1' AND ts >= ? ORDER BY ts`
    )
    .all(instId, dayStart);
  if (!m1.length) return [];

  const round = (n) => Math.round(n * 100) / 100;
  const out = [];

  for (const w of SESSION_WINDOWS) {
    const inWin = m1.filter((b) => {
      const hr = new Date(b.ts).getUTCHours();
      return hr >= w.start && hr < w.end;
    });
    if (!inWin.length) continue;
    const hi = Math.max(...inWin.map((b) => b.h));
    const lo = Math.min(...inWin.map((b) => b.l));
    out.push({ label: `${w.label} H`, price: round(hi), type: 'session' });
    out.push({ label: `${w.label} L`, price: round(lo), type: 'session' });
  }

  // Session opens — the open of the first M1 bar at/after each session hour.
  // Both London and NY are traded, so both opens are first-class levels.
  const lonBar = m1.find((b) => new Date(b.ts).getUTCHours() >= LON_OPEN_HOUR);
  if (lonBar) out.push({ label: 'London Open', price: round(lonBar.o), type: 'session' });
  const nyBar = m1.find((b) => new Date(b.ts).getUTCHours() >= NY_OPEN_HOUR);
  if (nyBar) out.push({ label: 'NY Open', price: round(nyBar.o), type: 'session' });

  // Today's running high/low (the intraday liquidity built so far).
  out.push({ label: 'Day H', price: round(Math.max(...m1.map((b) => b.h))), type: 'session' });
  out.push({ label: 'Day L', price: round(Math.min(...m1.map((b) => b.l))), type: 'session' });

  return out;
}

// GET /api/research/levels/:instrument — auto key levels (pivots, rounds, structure)
researchRouter.get('/levels/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });

    const instId = instrumentId(symbol);
    const bars = marketDb.prepare(
      `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
       ORDER BY ts DESC LIMIT 10`
    ).all(instId);

    if (!bars.length) return res.json({ instrument: symbol, currentPrice: null, levels: [] });

    const latest = bars[0];
    const prev = bars[1] || latest;
    const currentPrice = latest.c;

    const levels = [];

    // Classic pivot points from prior day
    const pp = (prev.h + prev.l + prev.c) / 3;
    levels.push({ label: 'PP', price: Math.round(pp * 100) / 100, type: 'pivot' });
    levels.push({ label: 'R1', price: Math.round((2 * pp - prev.l) * 100) / 100, type: 'pivot' });
    levels.push({ label: 'S1', price: Math.round((2 * pp - prev.h) * 100) / 100, type: 'pivot' });
    levels.push({ label: 'R2', price: Math.round((pp + (prev.h - prev.l)) * 100) / 100, type: 'pivot' });
    levels.push({ label: 'S2', price: Math.round((pp - (prev.h - prev.l)) * 100) / 100, type: 'pivot' });
    levels.push({ label: 'R3', price: Math.round((prev.h + 2 * (pp - prev.l)) * 100) / 100, type: 'pivot' });
    levels.push({ label: 'S3', price: Math.round((prev.l - 2 * (prev.h - pp)) * 100) / 100, type: 'pivot' });

    // Round numbers (gold = $50 increments; US100 = 500-pt increments)
    const step = symbol === 'XAUUSD' ? 50 : 500;
    const base = Math.floor(currentPrice / step) * step;
    for (let i = -2; i <= 3; i++) {
      const p = base + i * step;
      if (p > 0) levels.push({ label: `Round ${p}`, price: p, type: 'round' });
    }

    // Prior day H/L
    levels.push({ label: 'Prev Day H', price: prev.h, type: 'structure' });
    levels.push({ label: 'Prev Day L', price: prev.l, type: 'structure' });

    // Prior week H/L (from last 5 bars)
    const weekBars = bars.slice(0, 5);
    if (weekBars.length >= 3) {
      const weekH = Math.max(...weekBars.map(b => b.h));
      const weekL = Math.min(...weekBars.map(b => b.l));
      levels.push({ label: 'Prev Week H', price: weekH, type: 'structure' });
      levels.push({ label: 'Prev Week L', price: weekL, type: 'structure' });
    }

    // Intraday session liquidity levels (Wicks-Don't-Lie style) — the pools the
    // NY session hunts: Asian & London range extremes + the NY open. Computed
    // from the most recent day of M1 bars (UTC session windows). These are the
    // levels that actually matter for a session-timed liquidity-sweep strategy;
    // the pivots above are context.
    for (const s of computeSessionLevels(instId)) levels.push(s);

    // Equal highs/lows — clustered swing extremes = resting liquidity pools, the
    // stops a sweep actually runs. Drawn as their own type so they can be toggled.
    // Capped to the most-touched pools within ~0.7 ADR of price so the chart stays
    // readable (the far/old clusters are noise for an intraday session trade).
    const structure = computeStructure(instId, 'M15');
    if (structure) {
      const adrInfo = computeAdr(instId);
      const nearAdr = (adrInfo?.adr ?? currentPrice * 0.01) * 0.7;
      const near = (p) => Math.abs(p - currentPrice) <= nearAdr;
      for (const eh of structure.equalHighs.filter((e) => near(e.price)).slice(0, 3))
        levels.push({ label: `Equal Highs ×${eh.count}`, price: eh.price, type: 'liquidity' });
      for (const el of structure.equalLows.filter((e) => near(e.price)).slice(0, 3))
        levels.push({ label: `Equal Lows ×${el.count}`, price: el.price, type: 'liquidity' });
    }

    // Deduplicate by price (keep first occurrence) and sort
    const seen = new Set();
    const unique = levels.filter(l => {
      const key = l.price.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => b.price - a.price);

    res.json({
      instrument: symbol,
      currentPrice,
      levels: unique,
      freshness: { source: 'oanda', last_ok: latest.ts, status: 'ok' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/adr/:instrument?days=14 — Average Daily Range and how much
// of it today has already used. Wick-fill setups are higher-probability near
// ADR exhaustion (mean-reversion) and continuation is lower — so % used is a
// first-class read for a session scalper.
researchRouter.get('/adr/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const n = Math.max(3, Math.min(60, Number(req.query.days) || 14));

    const instId = instrumentId(symbol);
    // n prior complete days + today (latest), newest first.
    const bars = marketDb
      .prepare(
        `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
         ORDER BY ts DESC LIMIT ?`
      )
      .all(instId, n + 1);
    if (bars.length < 2) return res.json({ instrument: symbol, adr: null, samples: 0 });

    const today = bars[0];
    const prior = bars.slice(1); // exclude today from the average
    const ranges = prior.map((b) => b.h - b.l);
    const adr = ranges.reduce((s, r) => s + r, 0) / ranges.length;
    const round = (x) => Math.round(x * 100) / 100;

    const todayRange = today.h - today.l;
    const pctUsed = adr > 0 ? todayRange / adr : null;

    res.json({
      instrument: symbol,
      adr: round(adr),
      samples: ranges.length,
      today: { open: today.o, high: today.h, low: today.l, range: round(todayRange) },
      pctUsed: pctUsed != null ? Math.round(pctUsed * 1000) / 1000 : null,
      // Projection: a full-ADR day extends the current extreme to the far side.
      projectedHigh: round(today.l + adr),
      projectedLow: round(today.h - adr),
      freshness: { source: 'oanda', last_ok: today.ts, status: 'ok' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The liquidity pools a sweep hunts: intraday session levels + prior-day H/L.
function huntLevels(instId) {
  const out = computeSessionLevels(instId).map((l) => ({ label: l.label, price: l.price }));
  const d1 = marketDb
    .prepare(
      `SELECT h, l FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 2`
    )
    .all(instId);
  if (d1[1]) {
    out.push({ label: 'Prev Day H', price: Math.round(d1[1].h * 100) / 100 });
    out.push({ label: 'Prev Day L', price: Math.round(d1[1].l * 100) / 100 });
  }
  return out;
}

// GET /api/research/sweeps/:instrument?limit=8 — recent liquidity sweeps: an M1
// bar that pierced a level then closed back on the other side (the stop-hunt /
// wick rejection that is the "Wicks Don't Lie" entry trigger).
researchRouter.get('/sweeps/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const limit = Math.max(1, Math.min(30, Number(req.query.limit) || 8));

    const instId = instrumentId(symbol);
    const latest = marketDb
      .prepare("SELECT MAX(ts) AS maxTs FROM prices WHERE instrument_id = ? AND timeframe = 'M1'")
      .get(instId);
    if (latest?.maxTs == null) return res.json({ instrument: symbol, sweeps: [] });

    // Scan the last ~2 days of M1.
    const from = latest.maxTs - 2 * 86400000;
    const m1 = marketDb
      .prepare(
        `SELECT ts, o, h, l, c FROM prices
         WHERE instrument_id = ? AND timeframe = 'M1' AND ts >= ? ORDER BY ts`
      )
      .all(instId, from);
    const levels = huntLevels(instId);
    if (!m1.length || !levels.length) return res.json({ instrument: symbol, sweeps: [] });

    // Rejection = size of the rejecting wick relative to the candle body, capped
    // at 9.9 so a doji (body≈0) doesn't produce a meaningless huge ratio.
    const rej = (wickPart, body) =>
      Math.min(9.9, Math.round((wickPart / Math.max(body, 1e-6)) * 10) / 10);

    const sweeps = [];
    for (const b of m1) {
      const body = Math.abs(b.c - b.o);
      for (const lv of levels) {
        // Bearish sweep: pierced ABOVE the level but closed back below it.
        if (b.h > lv.price && b.c < lv.price && b.o < lv.price) {
          sweeps.push({
            ts: b.ts, level: lv.label, price: lv.price, direction: 'bearish',
            wick: Math.round((b.h - lv.price) * 100) / 100,
            rejection: rej(b.h - Math.max(b.o, b.c), body),
          });
        }
        // Bullish sweep: pierced BELOW the level but closed back above it.
        else if (b.l < lv.price && b.c > lv.price && b.o > lv.price) {
          sweeps.push({
            ts: b.ts, level: lv.label, price: lv.price, direction: 'bullish',
            wick: Math.round((lv.price - b.l) * 100) / 100,
            rejection: rej(Math.min(b.o, b.c) - b.l, body),
          });
        }
      }
    }
    // Most recent first.
    sweeps.sort((a, b) => b.ts - a.ts);
    res.json({
      instrument: symbol,
      sweeps: sweeps.slice(0, limit),
      freshness: { source: 'oanda', last_ok: latest.maxTs, status: 'ok' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Market structure (swings, MSS/BOS, equal-liquidity pools) ─────────────────
// The Wicks-Don't-Lie entry is sweep → structure shift → wick-fill. These helpers
// give the "structure shift" and the equal-high/low liquidity pools that are the
// actual pools a sweep hunts (not just session/prior-day extremes).

// Pivot swing detection on an ascending bar series. A swing high at i has the
// strictly-highest high over [i-k, i+k]; a swing low the strictly-lowest low.
// Returns swings ascending in time, collapsing consecutive same-type swings to
// the extreme: [{ ts, price, type:'H'|'L' }].
function computeSwings(bars, k = 2) {
  const raw = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isH = false;
      if (bars[j].l <= bars[i].l) isL = false;
    }
    if (isH) raw.push({ ts: bars[i].ts, price: bars[i].h, type: 'H' });
    if (isL) raw.push({ ts: bars[i].ts, price: bars[i].l, type: 'L' });
  }
  raw.sort((a, b) => a.ts - b.ts);
  const out = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && last.type === s.type) {
      const moreExtreme = s.type === 'H' ? s.price > last.price : s.price < last.price;
      if (moreExtreme) out[out.length - 1] = s;
    } else out.push(s);
  }
  return out;
}

// Cluster swing highs/lows that sit within `tol` of each other into equal-liquidity
// pools (>=2 swings resting at the same price = the stops a sweep runs). Returns
// { equalHighs:[{price,count}], equalLows:[...] }, strongest (most-touched) first.
function computeEqualLevels(swings, tol) {
  const round = (n) => Math.round(n * 100) / 100;
  const cluster = (points) => {
    const sorted = [...points].sort((a, b) => a.price - b.price);
    const groups = [];
    for (const p of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(p.price - g.sum / g.count) <= tol) {
        g.sum += p.price; g.count++; g.tss.push(p.ts);
      } else {
        groups.push({ sum: p.price, count: 1, tss: [p.ts] });
      }
    }
    return groups
      .filter((g) => g.count >= 2)
      .map((g) => ({ price: round(g.sum / g.count), count: g.count, lastTs: Math.max(...g.tss) }))
      .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
  };
  return {
    equalHighs: cluster(swings.filter((s) => s.type === 'H')),
    equalLows: cluster(swings.filter((s) => s.type === 'L')),
  };
}

// Full structure read for one instrument/timeframe: directional bias (HH/HL vs
// LH/LL), the most recent structure shift (BOS = continuation, CHoCH = reversal /
// MSS), the swing list, and equal-liquidity pools. Returns null if too little data.
function computeStructure(instId, tf = 'M15') {
  const rows = marketDb
    .prepare(
      `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = ?
       ORDER BY ts DESC LIMIT 400`
    )
    .all(instId, tf);
  if (rows.length < 20) return null;
  const bars = rows.reverse(); // ascending
  const swings = computeSwings(bars, 2);
  const highs = swings.filter((s) => s.type === 'H');
  const lows = swings.filter((s) => s.type === 'L');

  let bias = 'neutral';
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
    const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
    const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
    if (hh && hl) bias = 'bullish';
    else if (lh && ll) bias = 'bearish';
  }

  // Most recent structure shift: newest bar that closes beyond the last swing
  // high (bullish break) or last swing low (bearish break). A break WITH the bias
  // is a BOS (continuation); AGAINST it is a CHoCH (reversal = the MSS we want
  // after a sweep).
  const lastH = highs[highs.length - 1];
  const lastL = lows[lows.length - 1];
  let shift = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    if (lastH && b.ts > lastH.ts && b.c > lastH.price) {
      shift = { type: bias === 'bullish' ? 'BOS' : 'CHoCH', direction: 'bullish', ts: b.ts, level: lastH.price };
      break;
    }
    if (lastL && b.ts > lastL.ts && b.c < lastL.price) {
      shift = { type: bias === 'bearish' ? 'BOS' : 'CHoCH', direction: 'bearish', ts: b.ts, level: lastL.price };
      break;
    }
  }

  const adrInfo = computeAdr(instId);
  const tol = (adrInfo?.adr ?? bars[bars.length - 1].c * 0.01) * 0.03;
  const { equalHighs, equalLows } = computeEqualLevels(swings, tol);

  return {
    tf, bias, shift,
    swings: swings.slice(-12),
    equalHighs, equalLows,
    lastTs: bars[bars.length - 1].ts,
  };
}

// GET /api/research/structure/:instrument?tf=M15 — market structure read:
// bias, latest BOS/CHoCH (MSS), swings, and equal-liquidity pools.
researchRouter.get('/structure/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const tf = (req.query.tf || 'M15').toUpperCase();
    if (!VALID_TF.has(tf)) return res.status(400).json({ error: `Invalid timeframe: ${tf}` });
    const instId = instrumentId(symbol);
    if (instId == null) return res.status(400).json({ error: 'Instrument not seeded' });

    const structure = computeStructure(instId, tf);
    if (!structure) return res.json({ instrument: symbol, tf, bias: 'neutral', shift: null, swings: [], equalHighs: [], equalLows: [] });
    res.json({
      instrument: symbol, ...structure,
      freshness: { source: 'oanda', last_ok: structure.lastTs, status: 'ok' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Average daily range over `n` prior complete days (excludes today). Shared by
// the ADR endpoint's logic and the radar. Returns { adr, today } or null.
function computeAdr(instId, n = 14) {
  const bars = marketDb
    .prepare(
      `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1'
       ORDER BY ts DESC LIMIT ?`
    )
    .all(instId, n + 1);
  if (bars.length < 2) return null;
  const today = bars[0];
  const prior = bars.slice(1);
  const adr = prior.reduce((s, b) => s + (b.h - b.l), 0) / prior.length;
  return { adr, today };
}

// Which trading session is live right now, and minutes until the next open the
// strategy trades (London 07:00 UTC, NY 13:00 UTC). Both sessions are traded, so
// both are surfaced. NY is treated as live through ~21:00 UTC, London 07–13.
function sessionClock(now = new Date()) {
  const h = now.getUTCHours();
  const minsInto = (openH) => ((h - openH) * 60 + now.getUTCMinutes());
  const minsTo = (openH) => {
    let d = (openH - h) * 60 - now.getUTCMinutes();
    if (d <= 0) d += 24 * 60; // next occurrence
    return d;
  };
  let live = 'off';
  if (h >= 7 && h < 13) live = 'London';
  else if (h >= 13 && h < 21) live = 'New York';
  // Kill zones — the higher-probability windows of each session (London 07–10,
  // NY 12–15 UTC). Setups inside a KZ are prioritized.
  let killzone = null;
  if (h >= 7 && h < 10) killzone = 'London';
  else if (h >= 12 && h < 15) killzone = 'New York';
  return {
    live,
    killzone,
    minsIntoLondon: h >= 7 && h < 13 ? minsInto(7) : null,
    minsIntoNY: h >= 13 && h < 21 ? minsInto(13) : null,
    minsToLondon: minsTo(7),
    minsToNY: minsTo(13),
  };
}

// GET /api/research/radar/:instrument — the live "Setup Radar": evaluates the
// current tape against the things a Wicks-Don't-Lie session scalper watches and
// returns a prioritized signal list. Composes session-open proximity, key-level
// proximity (scaled to ADR), ADR exhaustion, fresh sweeps, and the session clock.
// severity: 'hot' (actionable now) > 'warn' (caution) > 'info' (context).
researchRouter.get('/radar/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const instId = instrumentId(symbol);
    if (instId == null) return res.status(400).json({ error: 'Instrument not seeded' });

    const round = (x) => Math.round(x * 100) / 100;
    const latest = marketDb
      .prepare(
        `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'M1'
         ORDER BY ts DESC LIMIT 1`
      )
      .get(instId);
    if (!latest) return res.json({ instrument: symbol, price: null, signals: [] });

    const price = latest.c;
    const adrInfo = computeAdr(instId);
    const adr = adrInfo?.adr ?? null;
    // "Approaching" band: 15% of ADR (fallback to 0.2% of price if no ADR yet).
    const nearBand = adr != null ? adr * 0.15 : price * 0.002;

    const signals = [];
    const clock = sessionClock();

    // 1) Session clock — live session (flagged when inside a kill zone) or open.
    if (clock.live !== 'off') {
      const inKz = clock.killzone === clock.live;
      signals.push({
        severity: inKz ? 'warn' : 'info', kind: 'session',
        title: inKz ? `${clock.live} KILL ZONE` : `${clock.live} session live`,
        detail: inKz
          ? 'Prime window — highest-probability sweeps here.'
          : (clock.live === 'London'
              ? `${clock.minsIntoLondon}m into London (KZ 07–10 UTC)`
              : `${clock.minsIntoNY}m into New York (KZ 12–15 UTC)`),
      });
    }
    for (const [name, mins] of [['London', clock.minsToLondon], ['New York', clock.minsToNY]]) {
      if (mins > 0 && mins <= 30) {
        signals.push({
          severity: 'warn', kind: 'session-open',
          title: `${name} open in ${mins}m`,
          detail: 'Session open — expect a liquidity grab.',
        });
      }
    }

    // Market structure (M15) — bias, MSS/BOS, and equal-liquidity pools. The
    // equal pools are added to the hunt levels so sweeps of resting liquidity are
    // caught, not just session/prior-day extremes.
    const structure = computeStructure(instId, 'M15');
    const eqLevels = [];
    if (structure) {
      for (const eh of structure.equalHighs) eqLevels.push({ label: `Equal Highs ×${eh.count}`, price: eh.price });
      for (const el of structure.equalLows) eqLevels.push({ label: `Equal Lows ×${el.count}`, price: el.price });
    }

    // 2) Proximity to hunt levels (session levels + PDH/PDL + equal pools).
    const levels = [...huntLevels(instId), ...eqLevels];
    for (const lv of levels) {
      const dist = Math.abs(price - lv.price);
      if (dist <= nearBand) {
        signals.push({
          severity: 'hot', kind: 'level-approach',
          title: `Approaching ${lv.label}`,
          detail: `${round(dist)} away (${price > lv.price ? 'above' : 'below'} @ ${lv.price}) — watch for a sweep.`,
          level: lv.label, price: lv.price, distance: round(dist),
        });
      }
    }

    // 3) ADR exhaustion — mean-reversion risk / poor breakout continuation.
    if (adr != null && adrInfo.today) {
      const usedPct = (adrInfo.today.h - adrInfo.today.l) / adr;
      if (usedPct >= 0.9) {
        signals.push({
          severity: 'warn', kind: 'adr-exhausted',
          title: `ADR ${Math.round(usedPct * 100)}% used`,
          detail: 'Daily range near exhausted — favour fades, avoid fresh breakout entries.',
        });
      }
    }

    // 4) Fresh sweeps in the last 20 minutes — the wick-fill entry trigger.
    const sweepFrom = latest.ts - 20 * 60000;
    const recentM1 = marketDb
      .prepare(
        `SELECT ts, o, h, l, c FROM prices WHERE instrument_id = ? AND timeframe = 'M1'
         AND ts >= ? ORDER BY ts`
      )
      .all(instId, sweepFrom);
    const freshSweeps = [];
    for (const b of recentM1) {
      for (const lv of levels) {
        const bearish = b.h > lv.price && b.c < lv.price && b.o < lv.price;
        const bullish = b.l < lv.price && b.c > lv.price && b.o > lv.price;
        if (!bearish && !bullish) continue;
        const agoMin = Math.round((latest.ts - b.ts) / 60000);
        const direction = bullish ? 'bullish' : 'bearish';
        freshSweeps.push({ direction, ts: b.ts, level: lv.label });
        signals.push({
          severity: 'hot', kind: 'sweep',
          title: `${lv.label} swept ${agoMin}m ago`,
          detail: bullish
            ? `Bullish sweep — wick-fill long setup off ${lv.label}.`
            : `Bearish sweep — wick-fill short setup off ${lv.label}.`,
          level: lv.label, price: lv.price, direction, ts: b.ts,
        });
      }
    }

    // 5) Market structure — bias context, recent MSS/BOS, and the confirmed
    // wick-fill trigger (sweep + structure shift in the same direction).
    if (structure) {
      if (structure.bias !== 'neutral') {
        signals.push({
          severity: 'info', kind: 'bias',
          title: `Structure ${structure.bias} (M15)`,
          detail: structure.bias === 'bullish'
            ? 'M15 making higher highs & higher lows.'
            : 'M15 making lower highs & lower lows.',
        });
      }
      const sh = structure.shift;
      if (sh) {
        const agoMin = Math.round((latest.ts - sh.ts) / 60000);
        if (agoMin <= 180) {
          const isMSS = sh.type === 'CHoCH';
          signals.push({
            severity: isMSS ? 'warn' : 'info', kind: 'structure-shift',
            title: `${sh.direction} ${sh.type} (M15) ${agoMin}m ago`,
            detail: isMSS
              ? `Structure shifted ${sh.direction} through ${sh.level} — reversal confirmation.`
              : `${sh.direction} break of structure through ${sh.level} — continuation.`,
            direction: sh.direction, ts: sh.ts,
          });
          // Confirmed setup: a fresh sweep + a structure shift the same way = the
          // full Wicks-Don't-Lie trigger (sweep → MSS → wick-fill entry).
          const combo = freshSweeps.find((s) => s.direction === sh.direction);
          if (combo) {
            signals.push({
              severity: 'hot', kind: 'confirmed-setup',
              title: `✦ Wick-fill ${sh.direction === 'bullish' ? 'LONG' : 'SHORT'} confirmed`,
              detail: `Swept ${combo.level} + ${sh.direction} ${sh.type} — sweep→shift trigger is set.`,
              direction: sh.direction, level: combo.level,
              ts: Math.max(combo.ts, sh.ts) + 1, // +1 so it sorts above its parts
            });
          }
        }
      }
    }

    // Prioritize: hot > warn > info; within a tier, most recent sweep first.
    const rank = { hot: 0, warn: 1, info: 2 };
    signals.sort((a, b) => (rank[a.severity] - rank[b.severity]) || ((b.ts || 0) - (a.ts || 0)));

    res.json({
      instrument: symbol,
      price: round(price),
      adr: adr != null ? round(adr) : null,
      session: clock.live,
      killzone: clock.killzone,
      bias: structure?.bias ?? 'neutral',
      signals,
      freshness: { source: 'oanda', last_ok: latest.ts, status: 'ok' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// t-statistic approximation for significance
function tStat(returns) {
  const n = returns.length;
  if (n < 3) return { tStat: 0, pValue: 1, significant: false };
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(returns.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  if (std === 0) return { tStat: 0, pValue: 1, significant: false };
  const t = mean / (std / Math.sqrt(n));
  const df = n - 1;
  const p = Math.exp(-0.717 * Math.abs(t) - 0.416 * t * t);
  return { tStat: Math.round(t * 100) / 100, pValue: Math.round(p * 1000) / 1000, significant: p < 0.05 };
}

function medianOf(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildBuckets(bucketMap) {
  return Object.entries(bucketMap).map(([label, returns]) => {
    const n = returns.length;
    const avgReturn = n ? returns.reduce((a, b) => a + b, 0) / n : 0;
    const winRate = n ? (returns.filter(r => r > 0).length / n) * 100 : 0;
    const sig = tStat(returns);
    return {
      label,
      avgReturn: Math.round(avgReturn * 100) / 100,
      medianReturn: Math.round(medianOf(returns) * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      sampleSize: n,
      tStat: sig.tStat,
      pValue: sig.pValue,
      significant: sig.significant,
    };
  });
}

// GET /api/research/seasonality/:instrument — enhanced with granularity
researchRouter.get('/seasonality/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const granularity = req.query.granularity || 'monthly';

    const instId = instrumentId(symbol);
    const tf = granularity === 'session' ? 'H1' : 'D1';
    const bars = marketDb.prepare(
      `SELECT ts, o, c FROM prices WHERE instrument_id = ? AND timeframe = ? ORDER BY ts ASC`
    ).all(instId, tf);

    const freshness = { source: 'oanda', last_ok: bars.length ? bars[bars.length - 1].ts : null, status: bars.length ? 'ok' : 'no_data' };

    if (granularity === 'monthly') {
      const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
        const [, curr] = entries[i];
        const [, prev] = entries[i - 1];
        const ret = ((curr.last - prev.last) / prev.last) * 100;
        monthReturns[curr.month].push(ret);
      }

      const months = monthReturns.map((returns, i) => {
        const n = returns.length;
        const avgReturn = n ? returns.reduce((a, b) => a + b, 0) / n : 0;
        const winRate = n ? (returns.filter(r => r > 0).length / n) * 100 : 0;
        const sig = tStat(returns);
        return {
          month: i + 1,
          label: monthLabels[i],
          avgReturn: Math.round(avgReturn * 100) / 100,
          medianReturn: Math.round(medianOf(returns) * 100) / 100,
          winRate: Math.round(winRate * 10) / 10,
          sampleSize: n,
          tStat: sig.tStat,
          pValue: sig.pValue,
          significant: sig.significant,
        };
      });

      // OpEx effect: 3rd Friday of each month
      const opexReturns = [];
      const nonOpexReturns = [];
      const weeklyCloses = new Map();
      for (const bar of bars) {
        const d = new Date(bar.ts);
        const isoWeek = getISOWeek(d);
        const key = `${d.getUTCFullYear()}-W${isoWeek}`;
        if (!weeklyCloses.has(key)) weeklyCloses.set(key, { first: bar.c, last: bar.c, ts: bar.ts });
        else weeklyCloses.get(key).last = bar.c;
      }
      const weekEntries = [...weeklyCloses.entries()].sort();
      for (let i = 1; i < weekEntries.length; i++) {
        const [, curr] = weekEntries[i];
        const [, prev] = weekEntries[i - 1];
        const ret = ((curr.last - prev.last) / prev.last) * 100;
        const d = new Date(curr.ts);
        const isOpex = isOpExWeek(d);
        if (isOpex) opexReturns.push(ret);
        else nonOpexReturns.push(ret);
      }

      let opexEffect = null;
      if (opexReturns.length >= 3 && nonOpexReturns.length >= 3) {
        const opexAvg = opexReturns.reduce((a, b) => a + b, 0) / opexReturns.length;
        const nonAvg = nonOpexReturns.reduce((a, b) => a + b, 0) / nonOpexReturns.length;
        const diff = opexAvg - nonAvg;
        opexEffect = {
          opexWeekAvg: Math.round(opexAvg * 100) / 100,
          nonOpexWeekAvg: Math.round(nonAvg * 100) / 100,
          significant: Math.abs(diff) > 0.3,
        };
      }

      return res.json({
        instrument: symbol,
        granularity: 'monthly',
        months,
        buckets: months,
        currentMonth: new Date().getUTCMonth() + 1,
        opexEffect,
        freshness,
      });
    }

    if (granularity === 'dow') {
      const dowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      const bucketMap = {};
      for (const l of dowLabels) bucketMap[l] = [];
      for (let i = 1; i < bars.length; i++) {
        const ret = ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
        const d = new Date(bars[i].ts);
        const dow = d.getUTCDay();
        if (dow >= 1 && dow <= 5) {
          bucketMap[dowLabels[dow - 1]].push(ret);
        }
      }
      return res.json({ instrument: symbol, granularity: 'dow', buckets: buildBuckets(bucketMap), freshness });
    }

    if (granularity === 'weekly') {
      const bucketMap = {};
      for (let w = 1; w <= 52; w++) bucketMap[`W${String(w).padStart(2, '0')}`] = [];
      for (let i = 1; i < bars.length; i++) {
        const ret = ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
        const d = new Date(bars[i].ts);
        const w = getISOWeek(d);
        if (w >= 1 && w <= 52) bucketMap[`W${String(w).padStart(2, '0')}`].push(ret);
      }
      return res.json({ instrument: symbol, granularity: 'weekly', buckets: buildBuckets(bucketMap), freshness });
    }

    if (granularity === 'session') {
      const bucketMap = { Asia: [], London: [], NewYork: [] };
      for (let i = 1; i < bars.length; i++) {
        const ret = ((bars[i].c - bars[i - 1].c) / bars[i - 1].c) * 100;
        const h = new Date(bars[i].ts).getUTCHours();
        if (h >= 0 && h < 8) bucketMap['Asia'].push(ret);
        else if (h >= 8 && h < 13) bucketMap['London'].push(ret);
        else if (h >= 13 && h < 21) bucketMap['NewYork'].push(ret);
      }
      return res.json({ instrument: symbol, granularity: 'session', buckets: buildBuckets(bucketMap), freshness });
    }

    res.status(400).json({ error: `Unknown granularity: ${granularity}. Use monthly|weekly|dow|session` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function isOpExWeek(date) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  let firstFri = first.getUTCDay() <= 5 ? (5 - first.getUTCDay() + 1) : (5 + 7 - first.getUTCDay() + 1);
  const thirdFri = firstFri + 14;
  const opexDate = new Date(Date.UTC(y, m, thirdFri));
  const opexWeek = getISOWeek(opexDate);
  return getISOWeek(date) === opexWeek;
}

// POST /api/research/ingest/cftc — trigger CFTC COT ingest
researchRouter.post('/ingest/cftc', async (_req, res) => {
  try {
    const result = await ingestCftc();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/cot/gold — COT positioning gauge
researchRouter.get('/cot/gold', (_req, res) => {
  try {
    const history = getCotHistory('GOLD - COMMODITY EXCHANGE INC.', { limit: 156 });
    if (!history.length) return res.status(404).json({ error: 'No COT data — run POST /ingest/cftc first' });

    const current = history[history.length - 1];
    const mmNet = current.mm_long - current.mm_short;
    const pctLong = current.mm_long + current.mm_short > 0
      ? (current.mm_long / (current.mm_long + current.mm_short)) * 100
      : 50;

    const prev = history.length >= 2 ? history[history.length - 2] : current;
    const prevNet = prev.mm_long - prev.mm_short;
    const wowChange = mmNet - prevNet;

    const nets = history.map(r => r.mm_long - r.mm_short);
    const sorted1y = [...nets.slice(-52)].sort((a, b) => a - b);
    const sorted3y = [...nets].sort((a, b) => a - b);
    const pctRank = (arr, val) => arr.length ? (arr.filter(v => v <= val).length / arr.length) * 100 : 50;

    const percentile1y = Math.round(pctRank(sorted1y, mmNet) * 10) / 10;
    const percentile3y = Math.round(pctRank(sorted3y, mmNet) * 10) / 10;
    const extreme = percentile1y > 90 || percentile1y < 10;

    const healthRow = marketDb.prepare(
      "SELECT last_ok, status FROM source_health WHERE source = 'cftc_gold'"
    ).get();

    res.json({
      current: {
        reportDate: current.report_date,
        mmLong: current.mm_long,
        mmShort: current.mm_short,
        mmNet,
        pctLong: Math.round(pctLong * 10) / 10,
        commLong: current.comm_long,
        commShort: current.comm_short,
        commNet: current.comm_long - current.comm_short,
        oi: current.oi,
        wowChange,
        percentile1y,
        percentile3y,
        extreme,
      },
      history: history.map(r => ({
        report_date: r.report_date,
        market: r.market,
        mm_long: r.mm_long,
        mm_short: r.mm_short,
        comm_long: r.comm_long,
        comm_short: r.comm_short,
        oi: r.oi,
      })),
      freshness: healthRow
        ? { source: 'cftc', last_ok: healthRow.last_ok, status: healthRow.status }
        : { source: 'cftc', last_ok: null, status: 'no_data' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/research/ingest/etf — trigger GLD ETF ingest
researchRouter.post('/ingest/etf', async (_req, res) => {
  try {
    const result = await ingestGldEtf();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/research/ingest/etf/upload — manual GLD CSV import (fallback when SPDR URL blocks)
researchRouter.post('/ingest/etf/upload', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    const csv = typeof req.body === 'string' ? req.body : '';
    if (!csv.trim()) return res.status(400).json({ error: 'Empty body — POST raw GLD CSV text' });
    const result = parseAndStoreGld(csv);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/etf-flows/gold — GLD ETF flows + trend
researchRouter.get('/etf-flows/gold', (_req, res) => {
  try {
    const history = getEtfHistory('GLD', { limit: 90 });
    if (!history.length) return res.status(404).json({ error: 'No ETF data — run POST /ingest/etf first' });

    const latest = history[history.length - 1];
    const prev = history.length >= 2 ? history[history.length - 2] : latest;
    const week5 = history.length >= 6 ? history[history.length - 6] : history[0];

    const dailyChange = (latest.tonnes ?? 0) - (prev.tonnes ?? 0);
    const weeklyChange = (latest.tonnes ?? 0) - (week5.tonnes ?? 0);

    // Trend from 20-day SMA slope
    const last20 = history.slice(-20).map(h => h.tonnes).filter(t => t != null);
    let trend = 'flat';
    if (last20.length >= 10) {
      const first10Avg = last20.slice(0, Math.floor(last20.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(last20.length / 2);
      const last10Avg = last20.slice(Math.floor(last20.length / 2)).reduce((a, b) => a + b, 0) / (last20.length - Math.floor(last20.length / 2));
      if (last10Avg > first10Avg + 0.5) trend = 'inflow';
      else if (last10Avg < first10Avg - 0.5) trend = 'outflow';
    }

    const healthRow = marketDb.prepare(
      "SELECT last_ok, status FROM source_health WHERE source = 'etf_gld'"
    ).get();

    res.json({
      etf: 'GLD',
      latestDate: latest.date,
      tonnes: latest.tonnes,
      dailyChangeTonnes: Math.round(dailyChange * 100) / 100,
      weeklyChangeTonnes: Math.round(weeklyChange * 100) / 100,
      trend,
      history: history.map(h => ({ date: h.date, tonnes: h.tonnes })),
      freshness: healthRow
        ? { source: 'spdr', last_ok: healthRow.last_ok, status: healthRow.status }
        : { source: 'spdr', last_ok: null, status: 'no_data' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/ratio/gold-silver — gold/silver ratio + percentile
researchRouter.get('/ratio/gold-silver', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 365, 2000);
    const goldId = instrumentId('XAUUSD');
    const silverId = instrumentId('XAGUSD');

    const goldBars = marketDb.prepare(
      `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT ?`
    ).all(goldId, limit).reverse();

    const silverBars = marketDb.prepare(
      `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT ?`
    ).all(silverId, limit).reverse();

    if (!goldBars.length || !silverBars.length) {
      return res.status(404).json({ error: 'No gold/silver price data — run OANDA ingest (includes XAG_USD)' });
    }

    // Align by day key
    const silverMap = new Map(silverBars.map(b => [Math.floor(b.ts / 86400000), b.c]));
    const ratios = [];
    for (const g of goldBars) {
      const dayKey = Math.floor(g.ts / 86400000);
      const silverPrice = silverMap.get(dayKey);
      if (silverPrice && silverPrice > 0) {
        ratios.push({ ts: g.ts, ratio: Math.round((g.c / silverPrice) * 100) / 100 });
      }
    }

    if (!ratios.length) {
      return res.status(404).json({ error: 'No overlapping gold/silver data' });
    }

    const currentRatio = ratios[ratios.length - 1].ratio;
    const vals = ratios.map(r => r.ratio);
    const avg1y = vals.reduce((a, b) => a + b, 0) / vals.length;
    const high1y = Math.max(...vals);
    const low1y = Math.min(...vals);
    const sorted = [...vals].sort((a, b) => a - b);
    const percentile1y = (sorted.filter(v => v <= currentRatio).length / sorted.length) * 100;

    res.json({
      ratio: currentRatio,
      avg1y: Math.round(avg1y * 100) / 100,
      high1y,
      low1y,
      percentile1y: Math.round(percentile1y * 10) / 10,
      history: ratios,
      freshness: { source: 'oanda', last_ok: ratios[ratios.length - 1].ts, status: 'ok' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Epic 4 — Events & reaction studies ----------

function toSession(tsMs) {
  const h = new Date(tsMs).getUTCHours();
  if (h >= 0 && h < 8) return 'asia';
  if (h >= 8 && h < 13) return 'europe';
  if (h >= 13 && h < 21) return 'us';
  return 'off';
}

function formatCountdown(diffMs) {
  if (diffMs <= 0) return null;
  const totalMin = Math.floor(diffMs / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// POST /api/research/ingest/calendar — trigger ForexFactory calendar ingest
researchRouter.post('/ingest/calendar', express.json(), async (req, res) => {
  try {
    if (req.body && (Array.isArray(req.body) || req.body.events || req.body.thisweek)) {
      const result = ingestCalendarPayload(req.body);
      return res.json(result);
    }
    const result = await ingestCalendar();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/calendar?impact=high&from=&to=&country=&limit=
researchRouter.get('/calendar', (req, res) => {
  try {
    const now = Date.now();
    const defaultFrom = now - 7 * 86400000;
    const defaultTo = now + 14 * 86400000;

    const events = getCalendarEvents({
      impact: req.query.impact || null,
      country: req.query.country || 'USD',
      from: req.query.from || defaultFrom,
      to: req.query.to || defaultTo,
      limit: req.query.limit || 200,
    });

    const enriched = events.map((e) => ({
      ...e,
      countdown: formatCountdown(e.ts - now),
      session: toSession(e.ts),
      isPast: e.ts < now,
    }));

    const nextHigh = enriched.find((e) => !e.isPast && e.impact === 'high') || null;

    const healthRow = marketDb
      .prepare("SELECT last_ok, status FROM source_health WHERE source = 'calendar_ff'")
      .get();

    res.json({
      events: enriched,
      count: enriched.length,
      nextHighImpact: nextHigh,
      freshness: healthRow
        ? { source: 'forexfactory', last_ok: healthRow.last_ok, status: healthRow.status }
        : { source: 'forexfactory', last_ok: null, status: 'no_data' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/events/upcoming?hours=24
researchRouter.get('/events/upcoming', (req, res) => {
  try {
    const now = Date.now();
    const hoursAhead = Math.min(Number(req.query.hours) || 24, 168);
    const cutoff = now + hoursAhead * 3600000;

    const events = getCalendarEvents({
      impact: 'high',
      from: now,
      to: cutoff,
      limit: 20,
    });

    const upcoming = events.map((e) => ({
      id: e.id,
      ts: e.ts,
      name: e.name,
      impact: e.impact,
      countdown: formatCountdown(e.ts - now),
      hoursAway: Math.round(((e.ts - now) / 3600000) * 10) / 10,
    }));

    let riskLevel = 'clear';
    if (upcoming.length > 0) {
      const nearest = upcoming[0].hoursAway;
      if (nearest < 1) riskLevel = 'imminent';
      else if (nearest < 4) riskLevel = 'approaching';
    }

    res.json({ events: upcoming, riskLevel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/events/markers/:instrument?tf=&from=&to=
researchRouter.get('/events/markers/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });

    const from = req.query.from ? Number(req.query.from) : Date.now() - 7 * 86400000;
    const to = req.query.to ? Number(req.query.to) : Date.now();

    const events = getCalendarEvents({
      impact: 'high,medium',
      country: 'USD',
      from,
      to,
      limit: 100,
    });

    const INVERTED_EVENTS = ['unemployment', 'claims', 'jobless'];

    const markers = events.map((e) => {
      let surprise = null;
      if (e.actual != null && e.consensus != null) {
        const diff = e.actual - e.consensus;
        const inverted = INVERTED_EVENTS.some((kw) => e.name.toLowerCase().includes(kw));
        const effectiveDiff = inverted ? -diff : diff;
        const threshold = Math.abs(e.consensus) * 0.02 || 0.1;
        if (Math.abs(diff) < threshold) surprise = 'inline';
        else surprise = effectiveDiff > 0 ? 'beat' : 'miss';
      }
      return {
        ts: e.ts,
        name: e.name,
        impact: e.impact,
        actual: e.actual,
        surprise,
      };
    });

    res.json({ instrument: symbol, markers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/event-reaction/:instrument?event=&limit=
researchRouter.get('/event-reaction/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const eventPattern = req.query.event;
    if (!eventPattern) return res.status(400).json({ error: 'event query param required' });

    const instId = instrumentId(symbol);
    if (instId == null) return res.status(400).json({ error: 'Instrument not seeded' });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = getEventsForReaction(eventPattern, { limit });

    if (!events.length) {
      return res.json({
        instrument: symbol,
        event: eventPattern,
        stats: [],
        byBeat: [],
        byMiss: [],
        history: [],
        sampleSize: 0,
        freshness: { source: 'calendar+prices', last_ok: null, status: 'no_data' },
      });
    }

    const INVERTED_EVENTS = ['unemployment', 'claims', 'jobless'];
    const inverted = INVERTED_EVENTS.some((kw) => eventPattern.toLowerCase().includes(kw));

    const WINDOWS = [
      { label: '5m', tf: 'M5', offsetMs: 5 * 60000 },
      { label: '15m', tf: 'M15', offsetMs: 15 * 60000 },
      { label: '30m', tf: 'M30', offsetMs: 30 * 60000 },
      { label: '60m', tf: 'H1', offsetMs: 60 * 60000 },
      { label: '1d', tf: 'D1', offsetMs: 24 * 3600000 },
    ];

    const history = [];

    for (const ev of events) {
      const preBar = marketDb.prepare(
        `SELECT c FROM prices
         WHERE instrument_id = ? AND timeframe = 'M5' AND ts <= ?
         ORDER BY ts DESC LIMIT 1`
      ).get(instId, ev.ts);

      if (!preBar) continue;
      const prePrice = preBar.c;

      let surprise = null;
      if (ev.actual != null && ev.consensus != null) {
        const diff = ev.actual - ev.consensus;
        const effectiveDiff = inverted ? -diff : diff;
        const threshold = Math.abs(ev.consensus) * 0.02 || 0.1;
        if (Math.abs(diff) < threshold) surprise = 'inline';
        else surprise = effectiveDiff > 0 ? 'beat' : 'miss';
      }

      const moves = {};
      const movesPct = {};

      for (const w of WINDOWS) {
        const targetTs = ev.ts + w.offsetMs;
        const postBar = marketDb.prepare(
          `SELECT c FROM prices
           WHERE instrument_id = ? AND timeframe = ? AND ts >= ? AND ts <= ?
           ORDER BY ts ASC LIMIT 1`
        ).get(instId, w.tf, targetTs - w.offsetMs * 0.5, targetTs + w.offsetMs * 0.5);

        if (postBar) {
          moves[w.label] = Math.round((postBar.c - prePrice) * 100) / 100;
          movesPct[w.label] = Math.round(((postBar.c - prePrice) / prePrice) * 10000) / 100;
        }
      }

      if (Object.keys(moves).length > 0) {
        history.push({
          eventDate: ev.ts,
          actual: ev.actual,
          consensus: ev.consensus,
          prior: ev.prior,
          surprise,
          prePrice,
          moves,
          movesPct,
        });
      }
    }

    function computeWindowStats(instances) {
      const results = [];
      for (const w of WINDOWS) {
        const vals = instances
          .map((h) => ({ abs: h.moves[w.label], pct: h.movesPct[w.label] }))
          .filter((v) => v.abs != null);
        if (!vals.length) {
          results.push({ window: w.label, avgMove: 0, avgMovePct: 0, avgDirectionalMove: 0, upPct: 0, downPct: 0, maxUp: 0, maxDown: 0, sampleSize: 0 });
          continue;
        }
        const absMoves = vals.map((v) => Math.abs(v.abs));
        const signedMoves = vals.map((v) => v.abs);
        const pctMoves = vals.map((v) => Math.abs(v.pct));
        const ups = vals.filter((v) => v.abs > 0).length;
        const downs = vals.filter((v) => v.abs < 0).length;
        results.push({
          window: w.label,
          avgMove: Math.round((absMoves.reduce((a, b) => a + b, 0) / absMoves.length) * 100) / 100,
          avgMovePct: Math.round((pctMoves.reduce((a, b) => a + b, 0) / pctMoves.length) * 100) / 100,
          avgDirectionalMove: Math.round((signedMoves.reduce((a, b) => a + b, 0) / signedMoves.length) * 100) / 100,
          upPct: Math.round((ups / vals.length) * 1000) / 10,
          downPct: Math.round((downs / vals.length) * 1000) / 10,
          maxUp: Math.max(...signedMoves, 0),
          maxDown: Math.min(...signedMoves, 0),
          sampleSize: vals.length,
        });
      }
      return results;
    }

    const stats = computeWindowStats(history);
    const byBeat = computeWindowStats(history.filter((h) => h.surprise === 'beat'));
    const byMiss = computeWindowStats(history.filter((h) => h.surprise === 'miss'));

    res.json({
      instrument: symbol,
      event: eventPattern,
      stats,
      byBeat,
      byMiss,
      history: history.reverse(),
      sampleSize: history.length,
      freshness: { source: 'calendar+prices', last_ok: Date.now(), status: history.length ? 'ok' : 'no_data' },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Epic 5 — Correlation, regression, comparison, spread ----------

const DEFAULT_CORR_SERIES = ['XAUUSD', 'US100', 'DGS10', 'DFII10', 'DTWEXBGS', 'VIX'];
const INSTRUMENT_SET = new Set(['XAUUSD', 'US100', 'XAGUSD', 'WTICO_USD']);

function getDailyValues(seriesId, limit) {
  if (INSTRUMENT_SET.has(seriesId)) {
    const instId = instrumentId(seriesId);
    if (instId == null) return [];
    return marketDb.prepare(
      `SELECT ts, c AS value FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT ?`
    ).all(instId, limit).reverse();
  }
  const volIds = new Set(['VIX', 'VXN', 'GVZ']);
  if (volIds.has(seriesId)) {
    seedVolSeries();
    return marketDb.prepare(
      'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
    ).all(seriesId, limit).reverse();
  }
  seedSeriesRegistry();
  return marketDb.prepare(
    'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
  ).all(seriesId, limit).reverse();
}

function alignByDay(...seriesArrays) {
  const dayMaps = seriesArrays.map(arr => {
    const m = new Map();
    for (const row of arr) {
      m.set(Math.floor(row.ts / 86400000), row.value);
    }
    return m;
  });
  const allDays = [...dayMaps[0].keys()].filter(d =>
    dayMaps.every(m => m.has(d) && m.get(d) != null)
  ).sort((a, b) => a - b);
  return { days: allDays, values: dayMaps.map(m => allDays.map(d => m.get(d))) };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = xs[i] - mx, yi = ys[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

// GET /api/research/correlation?window=60&series=XAUUSD,US100,DGS10
researchRouter.get('/correlation', (req, res) => {
  try {
    const window = Math.min(Number(req.query.window) || 60, 500);
    const seriesParam = req.query.series
      ? String(req.query.series).split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_CORR_SERIES;

    const raw = seriesParam.map(id => ({ id, data: getDailyValues(id, window + 50) }));
    const labels = raw.map(r => r.id);
    const n = labels.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    const cells = [];

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const { values } = alignByDay(raw[i].data, raw[j].data);
        const xs = values[0].slice(-window);
        const ys = values[1].slice(-window);
        const corr = pearson(xs, ys);
        const c = corr != null ? Math.round(corr * 1000) / 1000 : null;
        matrix[i][j] = c;
        matrix[j][i] = c;
        cells.push({ pair: [labels[i], labels[j]], corr: c, n: xs.length });
      }
    }

    res.json({ window, labels, matrix, cells, asOf: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/regression/:instrument?vs=DGS10&window=60
researchRouter.get('/regression/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    const vs = String(req.query.vs || 'DGS10').toUpperCase();
    const window = Math.min(Number(req.query.window) || 60, 500);

    const instData = getDailyValues(symbol, window + 50);
    const vsData = getDailyValues(vs, window + 50);
    const { days, values } = alignByDay(instData, vsData);

    const yPrices = values[0].slice(-window);
    const xPrices = values[1].slice(-window);

    if (yPrices.length < 10) {
      return res.json({ instrument: symbol, vs, window, error: 'insufficient data', n: yPrices.length });
    }

    const yReturns = [];
    const xReturns = [];
    for (let i = 1; i < yPrices.length; i++) {
      if (yPrices[i - 1] > 0 && xPrices[i - 1] > 0) {
        yReturns.push(Math.log(yPrices[i] / yPrices[i - 1]));
        xReturns.push(Math.log(xPrices[i] / xPrices[i - 1]));
      }
    }

    const n = xReturns.length;
    if (n < 5) return res.json({ instrument: symbol, vs, window, error: 'insufficient data', n });

    const mx = xReturns.reduce((a, b) => a + b, 0) / n;
    const my = yReturns.reduce((a, b) => a + b, 0) / n;
    let covXY = 0, varX = 0;
    for (let i = 0; i < n; i++) {
      covXY += (xReturns[i] - mx) * (yReturns[i] - my);
      varX += (xReturns[i] - mx) ** 2;
    }
    const beta = varX === 0 ? 0 : covXY / varX;
    const intercept = my - beta * mx;
    const corr = pearson(xReturns, yReturns);
    const r2 = corr != null ? corr * corr : null;

    const scatter = xReturns.map((x, i) => ({
      x: Math.round(x * 10000) / 10000,
      y: Math.round(yReturns[i] * 10000) / 10000,
    }));

    res.json({
      instrument: symbol,
      vs,
      window,
      beta: Math.round(beta * 10000) / 10000,
      r2: r2 != null ? Math.round(r2 * 10000) / 10000 : null,
      intercept: Math.round(intercept * 100000) / 100000,
      correlation: corr != null ? Math.round(corr * 1000) / 1000 : null,
      n,
      scatter,
      asOf: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/compare?series=XAUUSD,US100,DGS10&window=60&mode=zscore
researchRouter.get('/compare', (req, res) => {
  try {
    const seriesParam = req.query.series
      ? String(req.query.series).split(',').map(s => s.trim()).filter(Boolean)
      : ['XAUUSD', 'US100'];
    const window = Math.min(Number(req.query.window) || 60, 500);
    const mode = req.query.mode === 'pctChange' ? 'pctChange' : 'zscore';

    const raw = seriesParam.map(id => ({ id, data: getDailyValues(id, window + 50) }));
    const { days, values } = alignByDay(...raw.map(r => r.data));

    const sliced = values.map(v => v.slice(-window));
    const slicedDays = days.slice(-window);

    const data = slicedDays.map((dayKey, i) => {
      const point = { ts: dayKey * 86400000, values: {} };
      for (let s = 0; s < seriesParam.length; s++) {
        const arr = sliced[s];
        if (mode === 'zscore') {
          const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
          const std = Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length);
          point.values[seriesParam[s]] = std === 0 ? 0 : Math.round(((arr[i] - mean) / std) * 1000) / 1000;
        } else {
          const base = arr[0];
          point.values[seriesParam[s]] = base === 0 ? 0 : Math.round(((arr[i] - base) / base) * 10000) / 100;
        }
      }
      return point;
    });

    res.json({ series: seriesParam, mode, window, data, asOf: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/spread?long=XAUUSD&short=XAGUSD&mode=ratio
researchRouter.get('/spread', (req, res) => {
  try {
    const longSym = String(req.query.long || 'XAUUSD');
    const shortSym = String(req.query.short || 'XAGUSD');
    const mode = req.query.mode === 'difference' ? 'difference' : 'ratio';
    const limit = Math.min(Number(req.query.limit) || 365, 2000);

    const longData = getDailyValues(longSym, limit + 50);
    const shortData = getDailyValues(shortSym, limit + 50);
    const { days, values } = alignByDay(longData, shortData);

    const longs = values[0].slice(-limit);
    const shorts = values[1].slice(-limit);
    const slicedDays = days.slice(-limit);

    const spreadVals = longs.map((lv, i) => {
      const sv = shorts[i];
      return mode === 'ratio' ? (sv === 0 ? null : lv / sv) : lv - sv;
    }).filter(v => v != null);

    if (!spreadVals.length) {
      return res.json({ long: longSym, short: shortSym, mode, error: 'no overlapping data' });
    }

    const data = slicedDays.map((d, i) => {
      const sv = shorts[i];
      const val = mode === 'ratio' ? (sv === 0 ? null : longs[i] / sv) : longs[i] - sv;
      return { ts: d * 86400000, value: val != null ? Math.round(val * 10000) / 10000 : null, longPrice: longs[i], shortPrice: shorts[i] };
    });

    const current = spreadVals[spreadVals.length - 1];
    const mean = spreadVals.reduce((a, b) => a + b, 0) / spreadVals.length;
    const variance = spreadVals.reduce((a, v) => a + (v - mean) ** 2, 0) / spreadVals.length;
    const stddev = Math.sqrt(variance);
    const z = stddev === 0 ? 0 : (current - mean) / stddev;
    const sorted = [...spreadVals].sort((a, b) => a - b);
    const percentile = (sorted.filter(v => v <= current).length / sorted.length) * 100;

    res.json({
      long: longSym,
      short: shortSym,
      mode,
      current: Math.round(current * 10000) / 10000,
      mean: Math.round(mean * 10000) / 10000,
      stddev: Math.round(stddev * 10000) / 10000,
      zScore: Math.round(z * 100) / 100,
      percentile: Math.round(percentile * 10) / 10,
      data,
      asOf: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- S5.2 — Regime-conditional correlation + positioning ----------

function computeRegimeForDay(vixVal, hyVal) {
  let score = 0;
  if (vixVal != null) {
    if (vixVal < 15) score += 2;
    else if (vixVal < 20) score += 1;
    else if (vixVal < 30) score -= 1;
    else score -= 2;
  }
  if (hyVal != null) {
    if (hyVal < 3) score += 1;
    else if (hyVal >= 5) score -= 1;
  }
  if (score >= 2) return 'risk-on';
  if (score >= 0) return 'neutral';
  if (score >= -2) return 'risk-off';
  return 'crisis';
}

// GET /api/research/correlation/regime?window=252&series=...&regime=risk-on
researchRouter.get('/correlation/regime', (req, res) => {
  try {
    const window = Math.min(Number(req.query.window) || 252, 500);
    const targetRegime = req.query.regime || 'risk-on';
    const seriesParam = req.query.series
      ? String(req.query.series).split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_CORR_SERIES;

    seedVolSeries();
    seedSeriesRegistry();

    const vixData = marketDb.prepare(
      'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
    ).all('VIX', window + 50).reverse();
    const hyData = marketDb.prepare(
      'SELECT ts, value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT ?'
    ).all('BAMLH0A0HYM2', window + 50).reverse();

    const vixByDay = new Map(vixData.map(r => [Math.floor(r.ts / 86400000), r.value]));
    const hyByDay = new Map(hyData.map(r => [Math.floor(r.ts / 86400000), r.value]));

    const raw = seriesParam.map(id => {
      const data = getDailyValues(id, window + 50);
      return { id, dayMap: new Map(data.map(r => [Math.floor(r.ts / 86400000), r.value])) };
    });

    const allDays = [...raw[0].dayMap.keys()]
      .filter(d => raw.every(r => r.dayMap.has(d) && r.dayMap.get(d) != null))
      .sort((a, b) => a - b)
      .slice(-window);

    const regimeDays = allDays.filter(d => {
      const regime = computeRegimeForDay(vixByDay.get(d), hyByDay.get(d));
      return regime === targetRegime;
    });

    const labels = raw.map(r => r.id);
    const n = labels.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    const cells = [];

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const xs = regimeDays.map(d => raw[i].dayMap.get(d));
        const ys = regimeDays.map(d => raw[j].dayMap.get(d));
        const corr = pearson(xs, ys);
        const c = corr != null ? Math.round(corr * 1000) / 1000 : null;
        matrix[i][j] = c;
        matrix[j][i] = c;
        cells.push({ pair: [labels[i], labels[j]], corr: c, n: xs.length });
      }
    }

    res.json({
      window, labels, matrix, cells,
      regime: targetRegime,
      regimeDays: regimeDays.length,
      asOf: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/positioning/:instrument — consolidated positioning view
researchRouter.get('/positioning/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });

    let cot = null;
    if (symbol === 'XAUUSD') {
      const history = getCotHistory('GOLD - COMMODITY EXCHANGE INC.', { limit: 156 });
      if (history.length) {
        const current = history[history.length - 1];
        const mmNet = current.mm_long - current.mm_short;
        const pctLong = current.mm_long + current.mm_short > 0
          ? (current.mm_long / (current.mm_long + current.mm_short)) * 100 : 50;
        const prev = history.length >= 2 ? history[history.length - 2] : current;
        const prevNet = prev.mm_long - prev.mm_short;
        const nets = history.map(r => r.mm_long - r.mm_short);
        const sorted1y = [...nets.slice(-52)].sort((a, b) => a - b);
        const pctRank = (arr, val) => arr.length ? (arr.filter(v => v <= val).length / arr.length) * 100 : 50;
        const percentile1y = Math.round(pctRank(sorted1y, mmNet) * 10) / 10;

        cot = {
          mmNet,
          pctLong: Math.round(pctLong * 10) / 10,
          wowChange: mmNet - prevNet,
          percentile1y,
          extreme: percentile1y > 90 || percentile1y < 10,
        };
      }
    }

    let etf = null;
    if (symbol === 'XAUUSD') {
      const history = getEtfHistory('GLD', { limit: 30 });
      if (history.length) {
        const latest = history[history.length - 1];
        const prev = history.length >= 2 ? history[history.length - 2] : latest;
        const last20 = history.slice(-20).map(h => h.tonnes).filter(t => t != null);
        let trend = 'flat';
        if (last20.length >= 10) {
          const half = Math.floor(last20.length / 2);
          const firstAvg = last20.slice(0, half).reduce((a, b) => a + b, 0) / half;
          const lastAvg = last20.slice(half).reduce((a, b) => a + b, 0) / (last20.length - half);
          if (lastAvg > firstAvg + 0.5) trend = 'inflow';
          else if (lastAvg < firstAvg - 0.5) trend = 'outflow';
        }
        etf = {
          tonnes: latest.tonnes,
          delta: Math.round(((latest.tonnes ?? 0) - (prev.tonnes ?? 0)) * 100) / 100,
          trend,
        };
      }
    }

    let contrarian = { flag: false, reason: '' };
    if (cot?.extreme) {
      if (cot.percentile1y > 90) {
        contrarian = { flag: true, reason: `MM net long at ${cot.percentile1y.toFixed(0)}th percentile — historically bearish` };
      } else if (cot.percentile1y < 10) {
        contrarian = { flag: true, reason: `MM net long at ${cot.percentile1y.toFixed(0)}th percentile — historically bullish` };
      }
    }

    res.json({
      instrument: symbol,
      cot,
      etf,
      contrarian,
      asOf: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Epic 6: News & AI ──────────────────────────────────────────────

// POST /api/research/ingest/news — trigger GDELT + RSS news ingest
researchRouter.post('/ingest/news', express.json(), async (_req, res) => {
  try {
    const result = await ingestAllNews();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/news?instrument=XAUUSD&limit=50&since=&sentiment=&source=
researchRouter.get('/news', (req, res) => {
  try {
    const items = getNewsFeed({
      instrument: req.query.instrument || null,
      limit: Math.min(Number(req.query.limit) || 50, 200),
      since: req.query.since ? Number(req.query.since) : null,
      sentiment: req.query.sentiment || null,
      source: req.query.source || null,
    });

    res.json({
      items,
      total: items.length,
      asOf: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/news/summary — aggregated 24h stats
researchRouter.get('/news/summary', (_req, res) => {
  try {
    res.json(getNewsSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/research/explain-move — AI explain a price candle
researchRouter.post('/explain-move', express.json(), async (req, res) => {
  try {
    const { instrument, timestamp, timeframe, direction, magnitude } = req.body || {};
    const symbol = resolveInstrument(instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });
    if (!timestamp || !timeframe) return res.status(400).json({ error: 'timestamp and timeframe required' });

    const ts = Number(timestamp);
    const tf = String(timeframe);

    const cached = marketDb.prepare(
      'SELECT * FROM explanations WHERE instrument = ? AND ts = ? AND timeframe = ?'
    ).get(symbol, ts, tf);

    if (cached) {
      return res.json({
        instrument: symbol,
        timestamp: ts,
        explanation: cached.explanation,
        evidence: JSON.parse(cached.evidence_json || '{}'),
        model: cached.model,
        cached: true,
      });
    }

    const isDaily = tf === 'D1';
    const newsWindow = isDaily ? 12 * 3600000 : 2 * 3600000;
    const eventWindow = isDaily ? 24 * 3600000 : 4 * 3600000;

    const nearbyNews = getNewsFeed({
      instrument: symbol,
      since: ts - newsWindow,
      limit: 10,
    }).filter(n => n.ts <= ts + newsWindow);

    const nearbyEvents = getCalendarEvents({
      from: ts - eventWindow,
      to: ts + eventWindow,
      limit: 10,
    });

    seedVolSeries();
    const vixRow = getLatestVol('VIX');
    const hyRow = marketDb.prepare("SELECT value FROM series_data WHERE series_id = 'BAMLH0A0HYM2' ORDER BY ts DESC LIMIT 1").get();
    const regime = computeRegimeForDay(vixRow?.value, hyRow?.value);

    const corrSymbols = symbol === 'XAUUSD'
      ? ['DGS10', 'DFII10', 'DTWEXBGS', 'VIX', 'GVZ']
      : ['VIX', 'VXN', 'DGS10', 'DTWEXBGS'];

    const correlatedMoves = [];
    for (const cs of corrSymbols) {
      const row = marketDb.prepare(
        "SELECT value FROM series_data WHERE series_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1"
      ).get(cs, ts);
      const prevRow = marketDb.prepare(
        "SELECT value FROM series_data WHERE series_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1"
      ).get(cs, ts - 86400000);
      if (row && prevRow && prevRow.value) {
        const move = ((row.value - prevRow.value) / Math.abs(prevRow.value)) * 100;
        correlatedMoves.push({ symbol: cs, move: Math.round(move * 100) / 100 });
      }
    }

    const evidence = {
      nearbyNews: nearbyNews.map(n => ({ id: n.id, ts: n.ts, headline: n.headline, source: n.source, sentiment: n.sentiment })),
      nearbyEvents: nearbyEvents.map(e => ({ ts: e.ts, name: e.name, country: e.country, impact: e.impact, actual: e.actual, consensus: e.consensus })),
      regime,
      correlatedMoves,
    };

    let context = `${symbol} ${tf} candle at ${new Date(ts).toISOString()}: moved ${direction || 'unknown'} ${magnitude != null ? magnitude.toFixed(2) + '%' : 'unknown magnitude'}\n`;

    if (nearbyNews.length) {
      context += '\nNearby headlines:\n';
      for (const n of nearbyNews) {
        context += `- ${new Date(n.ts).toISOString().slice(0, 16)} ${n.headline}${n.sentiment != null ? ` [sent: ${n.sentiment.toFixed(2)}]` : ''}\n`;
      }
    }

    if (nearbyEvents.length) {
      context += '\nNearby economic events:\n';
      for (const e of nearbyEvents) {
        context += `- ${new Date(e.ts).toISOString().slice(0, 16)} ${e.country} ${e.name}`;
        if (e.actual != null) context += ` (actual: ${e.actual}, consensus: ${e.consensus}, prior: ${e.prior})`;
        context += '\n';
      }
    }

    context += `\nRisk regime: ${regime}`;
    if (vixRow) context += ` (VIX: ${vixRow.value})`;

    if (correlatedMoves.length) {
      context += '\nCorrelated moves:\n';
      for (const cm of correlatedMoves) {
        context += `- ${cm.symbol}: ${cm.move > 0 ? '+' : ''}${cm.move}%\n`;
      }
    }

    const system = `You are a market microstructure analyst. Explain why ${symbol} moved ${direction || ''} ${magnitude != null ? magnitude.toFixed(2) + '%' : ''} at ${new Date(ts).toISOString().slice(0, 16)}.

Use ONLY the evidence provided. Structure your response:
1. **Most likely driver** (1-2 sentences) — the single biggest factor
2. **Supporting factors** (2-3 bullets) — other contributors
3. **Context** (1 sentence) — regime/positioning backdrop

If the evidence doesn't clearly explain the move, say so — "this appears to be a positioning/flow-driven move without a clear news catalyst."`;

    const prompt = `Explain this move:\n\n${context}`;

    let explanation, model;
    try {
      explanation = await callLLM({ system, prompt });
      model = AI_MODEL || 'unknown';
    } catch (err) {
      return res.json({
        instrument: symbol,
        timestamp: ts,
        explanation: null,
        evidence,
        model: null,
        error: err.message,
        cached: false,
      });
    }

    marketDb.prepare(
      `INSERT INTO explanations (instrument, ts, timeframe, explanation, evidence_json, model)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(instrument, ts, timeframe) DO UPDATE SET
         explanation = excluded.explanation, evidence_json = excluded.evidence_json, model = excluded.model`
    ).run(symbol, ts, tf, explanation, JSON.stringify(evidence), model);

    res.json({ instrument: symbol, timestamp: ts, explanation, evidence, model, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Epic 7 — Journal Fusion ----------

// POST /api/research/snapshot/batch — batch capture for multiple trades
researchRouter.post('/snapshot/batch', express.json(), (req, res) => {
  try {
    const { trades } = req.body;
    if (!Array.isArray(trades) || !trades.length) {
      return res.status(400).json({ error: 'trades array required: [{ tradeId, instrument, entryTime }]' });
    }
    const results = trades.map(t => {
      try {
        const payload = captureSnapshot(t.tradeId, t.instrument, t.entryTime);
        return { tradeId: t.tradeId, ok: true };
      } catch (err) {
        return { tradeId: t.tradeId, ok: false, error: err.message };
      }
    });
    res.json({ captured: results.filter(r => r.ok).length, total: trades.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/research/snapshot/:tradeId — manually capture snapshot for a trade
researchRouter.post('/snapshot/:tradeId', express.json(), (req, res) => {
  try {
    const tradeId = Number(req.params.tradeId);
    if (!tradeId || tradeId < 1) return res.status(400).json({ error: 'Invalid tradeId' });
    const instrument = req.body?.instrument || null;
    const entryTime = req.body?.entryTime || null;
    const payload = captureSnapshot(tradeId, instrument, entryTime);
    res.json({ trade_id: tradeId, ts: entryTime || Date.now(), payload, captured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/snapshot/:tradeId — read stored snapshot
researchRouter.get('/snapshot/:tradeId', (req, res) => {
  try {
    const tradeId = Number(req.params.tradeId);
    if (!tradeId || tradeId < 1) return res.status(400).json({ error: 'Invalid tradeId' });
    const snapshot = getSnapshot(tradeId);
    if (!snapshot) return res.status(404).json({ error: 'No snapshot for this trade' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/edge/:instrument — edge analytics (P&L × market conditions)
researchRouter.get('/edge/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (!symbol) return res.status(400).json({ error: 'Unknown instrument' });

    const snapshots = marketDb.prepare(
      'SELECT trade_id, ts, payload_json FROM context_snapshots'
    ).all();
    if (!snapshots.length) {
      return res.json({ instrument: symbol, dimensions: {}, best_edge: null, total_trades: 0 });
    }

    const snapshotMap = new Map();
    for (const s of snapshots) {
      try {
        const payload = JSON.parse(s.payload_json);
        if (payload.instrument === symbol) snapshotMap.set(s.trade_id, payload);
      } catch { /* skip malformed */ }
    }

    const trades = journalDb.prepare(
      `SELECT id, instrument, direction, net_pnl, r_multiple, session, entry_time
       FROM trades WHERE instrument = ? AND is_backtest = 0 AND exit_time IS NOT NULL`
    ).all(symbol);

    const MIN_BUCKET = 5;
    const dims = { regime: {}, driver_composite: {}, vol_regime: {}, session: {}, dow: {}, event_proximity: {} };

    for (const t of trades) {
      const snap = snapshotMap.get(t.id);
      const win = (t.net_pnl ?? 0) > 0;
      const r = t.r_multiple;
      const pnl = t.net_pnl ?? 0;
      const entry = { win, r, pnl };

      // Session dimension (always available)
      const sess = t.session || 'unknown';
      (dims.session[sess] ??= []).push(entry);

      // Day of week
      if (t.entry_time) {
        const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t.entry_time).getUTCDay()];
        (dims.dow[dow] ??= []).push(entry);
      }

      if (!snap) continue;

      // Regime
      if (snap.regime?.label) {
        (dims.regime[snap.regime.label] ??= []).push(entry);
      }

      // Driver composite
      if (snap.drivers?.composite?.label) {
        (dims.driver_composite[snap.drivers.composite.label] ??= []).push(entry);
      }

      // Vol regime (quartiles)
      if (snap.vol?.percentile_60d != null) {
        const pctl = snap.vol.percentile_60d;
        const bucket = pctl > 75 ? 'high_vol' : pctl < 25 ? 'low_vol' : 'normal_vol';
        (dims.vol_regime[bucket] ??= []).push(entry);
      }

      // Event proximity
      if (snap.upcoming_events) {
        const entryMs = t.entry_time ? new Date(t.entry_time).getTime() : snap.captured_at;
        const nearEvent = snap.upcoming_events.some(e => Math.abs(e.ts - entryMs) < 2 * 3600 * 1000);
        const bucket = nearEvent ? 'near_event' : 'clean';
        (dims.event_proximity[bucket] ??= []).push(entry);
      }
    }

    const dimensions = {};
    for (const [dimName, buckets] of Object.entries(dims)) {
      const arr = [];
      for (const [bucket, entries] of Object.entries(buckets)) {
        const n = entries.length;
        if (n < MIN_BUCKET) continue;
        const wins = entries.filter(e => e.win).length;
        const avgPnl = entries.reduce((s, e) => s + e.pnl, 0) / n;
        const rVals = entries.filter(e => e.r != null).map(e => e.r);
        const avgR = rVals.length ? rVals.reduce((s, v) => s + v, 0) / rVals.length : null;
        const winRate = Math.round((wins / n) * 1000) / 10;
        const expectancy = avgR != null ? Math.round(((winRate / 100) * avgR - ((100 - winRate) / 100) * Math.abs(avgR)) * 100) / 100 : null;
        arr.push({
          category: dimName,
          bucket,
          trades_n: n,
          win_rate: winRate,
          avg_r: avgR != null ? Math.round(avgR * 100) / 100 : null,
          expectancy,
          avg_pnl: Math.round(avgPnl * 100) / 100,
        });
      }
      if (arr.length) dimensions[dimName] = arr;
    }

    let best_edge = null;
    let bestExp = -Infinity;
    for (const buckets of Object.values(dimensions)) {
      for (const b of buckets) {
        if (b.expectancy != null && b.expectancy > bestExp) {
          bestExp = b.expectancy;
          best_edge = { dimension: b.category, bucket: b.bucket, expectancy: b.expectancy };
        }
      }
    }

    res.json({ instrument: symbol, dimensions, best_edge, total_trades: trades.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/research/debrief/:tradeId — generate AI debrief for a trade
researchRouter.post('/debrief/:tradeId', async (req, res) => {
  try {
    const tradeId = Number(req.params.tradeId);
    if (!tradeId || tradeId < 1) return res.status(400).json({ error: 'Invalid tradeId' });

    const trade = journalDb.prepare(
      `SELECT t.*, s.name AS setup_name FROM trades t LEFT JOIN setups s ON t.setup_id = s.id WHERE t.id = ?`
    ).get(tradeId);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    const snapshot = getSnapshot(tradeId);
    const tags = journalDb.prepare(
      'SELECT tg.name, tg.category FROM trade_tags tt JOIN tags tg ON tt.tag_id = tg.id WHERE tt.trade_id = ?'
    ).all(tradeId);
    const notes = journalDb.prepare(
      'SELECT body FROM notes WHERE trade_id = ? ORDER BY created_at DESC LIMIT 3'
    ).all(tradeId);

    let context = `## Trade Details
- Instrument: ${trade.instrument}
- Direction: ${trade.direction}
- Entry: ${trade.entry_time} @ ${trade.entry_price}
- Exit: ${trade.exit_time} @ ${trade.exit_price}
- Net P&L: $${trade.net_pnl?.toFixed(2) ?? '?'}
- R Multiple: ${trade.r_multiple?.toFixed(2) ?? 'N/A'}
- Session: ${trade.session}
- Setup: ${trade.setup_name ?? 'None'}
- Hold time: ${trade.hold_time_sec ? Math.round(trade.hold_time_sec / 60) + ' minutes' : 'N/A'}
- MAE: ${trade.mae ?? 'N/A'} | MFE: ${trade.mfe ?? 'N/A'}`;

    if (tags.length) {
      context += `\n- Tags: ${tags.map(t => `${t.category}:${t.name}`).join(', ')}`;
    }
    if (notes.length) {
      context += `\n- Trader notes: ${notes.map(n => n.body).join(' | ')}`;
    }

    if (snapshot) {
      const p = snapshot.payload;
      context += '\n\n## Market Context at Entry';
      if (p.regime) context += `\n- Regime: ${p.regime.label} (score ${p.regime.score})`;
      if (p.drivers) context += `\n- Driver composite: ${p.drivers.composite.label} (${p.drivers.composite.score})`;
      if (p.vol) {
        context += `\n- Vol: IV=${p.vol.instrument_iv ?? '?'}, 60d pctl=${p.vol.percentile_60d ?? '?'}%, exp move=${p.vol.expected_move_1d ?? '?'}`;
      }
      if (p.positioning) {
        context += `\n- COT: net ${p.positioning.cot_net_mm?.toLocaleString() ?? '?'}, ${p.positioning.cot_pct_long ?? '?'}% long, 1Y pctl ${p.positioning.cot_percentile_1y ?? '?'}%`;
        context += `\n- ETF: ${p.positioning.etf_tonnes ?? '?'} tonnes, trend ${p.positioning.etf_trend ?? '?'}`;
      }
      if (p.upcoming_events?.length) {
        context += `\n- Upcoming events: ${p.upcoming_events.map(e => `${e.name} (${e.impact})`).join(', ')}`;
      }
      if (p.recent_news?.length) {
        context += `\n- Recent news: ${p.recent_news.map(n => n.headline).join('; ')}`;
      }
      if (p.rates) {
        context += `\n- Key rates: 10Y=${p.rates.DGS10}, Real 10Y=${p.rates.DFII10}, DXY=${p.rates.DTWEXBGS}, 2s10s=${p.rates.spread_2s10s}`;
      }
      if (p.seasonality) {
        if (p.seasonality.month) context += `\n- Seasonality: ${p.seasonality.month.name} avg ${p.seasonality.month.avg_return}%, win ${p.seasonality.month.win_rate}%`;
        if (p.seasonality.dow) context += `, ${p.seasonality.dow.name} avg ${p.seasonality.dow.avg_return}%, win ${p.seasonality.dow.win_rate}%`;
      }
    }

    const system = `You are an elite trading coach reviewing a completed trade with full market context.

Your job:
1. **Setup quality** (1-2 sentences) — Was this a good entry given the market conditions? Consider regime, drivers, vol, and positioning.
2. **Execution** (1-2 sentences) — Entry timing, sizing, stop placement relative to key levels and expected move.
3. **What went well** (1-2 bullets) — Specific strengths.
4. **What to improve** (1-2 bullets) — Specific, actionable feedback.
5. **Condition insight** (1 sentence) — Does this type of trade tend to work in these conditions?

Be direct, specific, and grounded in the data. No generic advice. Reference actual numbers from the context.`;

    const content = await callLLM({ system, prompt: context });
    const model = AI_MODEL || 'unknown';

    marketDb.prepare(
      `INSERT INTO debriefs (trade_id, content, model)
       VALUES (?, ?, ?)
       ON CONFLICT(trade_id) DO UPDATE SET content = excluded.content, model = excluded.model,
         created_at = CAST(strftime('%s','now') AS INTEGER) * 1000`
    ).run(tradeId, content, model);

    res.json({ trade_id: tradeId, content, model, created_at: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/research/debrief/:tradeId — read cached debrief
researchRouter.get('/debrief/:tradeId', (req, res) => {
  try {
    const tradeId = Number(req.params.tradeId);
    if (!tradeId || tradeId < 1) return res.status(400).json({ error: 'Invalid tradeId' });
    const row = marketDb.prepare('SELECT * FROM debriefs WHERE trade_id = ?').get(tradeId);
    if (!row) return res.status(404).json({ error: 'No debrief for this trade' });
    res.json({ trade_id: row.trade_id, content: row.content, model: row.model, created_at: row.created_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
