import express, { Router } from 'express';
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
import { callLLM } from '../ai.js';
import {
  FRED_API_KEY,
  FINNHUB_KEY,
  ALPACA_KEY,
  OANDA_API_TOKEN,
  AI_MODEL,
} from '../env.js';

export const researchRouter = Router();

const VALID_TF = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']);
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

// GET /api/research/drivers/:instrument — driver scorecard
researchRouter.get('/drivers/:instrument', (req, res) => {
  try {
    const symbol = resolveInstrument(req.params.instrument);
    if (symbol !== 'XAUUSD') return res.status(400).json({ error: 'Driver scorecard only available for XAUUSD' });

    seedSeriesRegistry();
    seedVolSeries();

    const instId = instrumentId('XAUUSD');
    const goldPrices = marketDb.prepare(
      `SELECT ts, c FROM prices WHERE instrument_id = ? AND timeframe = 'D1' ORDER BY ts DESC LIMIT 120`
    ).all(instId).reverse().map(r => r.c);

    const drivers = GOLD_DRIVERS.map(drv => {
      let dataPoints;
      if (drv.id === 'GVZ') {
        dataPoints = getVolHistory('GVZ', { limit: 120 }).map(r => r.value).filter(v => v != null);
      } else {
        dataPoints = marketDb.prepare(
          'SELECT value FROM series_data WHERE series_id = ? ORDER BY ts DESC LIMIT 120'
        ).all(drv.id).reverse().map(r => r.value).filter(v => v != null);
      }

      const current = dataPoints.length ? dataPoints[dataPoints.length - 1] : null;
      const window60 = dataPoints.slice(-60);
      const z = zScore(window60);
      const corr = rollingCorrelation(dataPoints.slice(-60), goldPrices.slice(-60));

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
        id: drv.id,
        name: drv.name,
        value: current,
        zScore: z != null ? Math.round(z * 100) / 100 : null,
        signal,
        correlation: corr != null ? Math.round(corr * 100) / 100 : null,
        relationship: drv.relationship,
      };
    });

    const signalScores = { bullish: 1, neutral: 0, bearish: -1 };
    const scored = drivers.filter(d => d.signal);
    const compositeScore = scored.length
      ? scored.reduce((s, d) => s + signalScores[d.signal], 0) / scored.length
      : 0;
    let compositeLabel = 'neutral';
    if (compositeScore > 0.3) compositeLabel = 'tailwind';
    else if (compositeScore < -0.3) compositeLabel = 'headwind';

    const fredHealth = marketDb.prepare(
      "SELECT last_ok, status FROM source_health WHERE source = 'fred_dfii10'"
    ).get();

    res.json({
      instrument: 'XAUUSD',
      drivers,
      composite: { score: Math.round(compositeScore * 100) / 100, label: compositeLabel },
      freshness: fredHealth
        ? { source: 'fred+cboe', last_ok: fredHealth.last_ok, status: fredHealth.status }
        : { source: 'fred+cboe', last_ok: null, status: 'no_data' },
    });
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
