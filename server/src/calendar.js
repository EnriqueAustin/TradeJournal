// Economic-calendar ingest — pulls the free ForexFactory weekly JSON feed and
// caches events in SQLite so trade timelines can overlay high-impact news.
// No API key required. Outbound internet only when /api/news/refresh is called.
import crypto from 'node:crypto';
import { db } from './db.js';

// ForexFactory publishes rolling weekly feeds via faireconomy's CDN.
const FF_FEEDS = {
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  lastweek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
};

function normImpact(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  if (s.startsWith('low')) return 'low';
  if (s.startsWith('holiday') || s.startsWith('non')) return 'holiday';
  return 'low';
}

// FF `date` is RFC3339 with an offset (e.g. 2024-01-05T08:30:00-05:00).
// Store as ISO UTC so it lines up with our bar/trade times.
function toUtcIso(raw) {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function eventId(currency, dt, title) {
  return crypto
    .createHash('sha1')
    .update(`${currency}|${dt}|${title}`)
    .digest('hex')
    .slice(0, 16);
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'TradeJournal/1.0' },
  });
  if (!res.ok) throw new Error(`ForexFactory ${res.status} for ${url}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('Unexpected ForexFactory payload');
  return json;
}

const upsertStmt = () =>
  db.prepare(`
    INSERT INTO news_events (id, dt, currency, impact, title, forecast, previous, actual, source, fetched_at)
    VALUES (@id, @dt, @currency, @impact, @title, @forecast, @previous, @actual, 'forexfactory', datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      forecast = excluded.forecast,
      previous = excluded.previous,
      actual   = excluded.actual,
      impact   = excluded.impact,
      fetched_at = excluded.fetched_at
  `);

/**
 * Fetch one or more ForexFactory weekly feeds and upsert them.
 * @param {string[]} feeds subset of ['lastweek','thisweek','nextweek']
 * @returns {{ inserted:number, feeds:string[] }}
 */
export async function refreshNews(feeds = ['thisweek', 'nextweek']) {
  const want = feeds.filter((f) => FF_FEEDS[f]);
  const stmt = upsertStmt();
  let count = 0;

  const rows = [];
  const errors = [];
  let okFeeds = 0;
  for (const f of want) {
    let items;
    try {
      items = await fetchFeed(FF_FEEDS[f]);
      okFeeds++;
    } catch (e) {
      // A single missing/late feed shouldn't fail the whole refresh.
      errors.push(`${f}: ${e.message}`);
      continue;
    }
    for (const it of items) {
      const dt = toUtcIso(it.date);
      if (!dt) continue;
      const currency = String(it.country || it.currency || '').toUpperCase();
      const title = String(it.title || '').trim();
      if (!title) continue;
      rows.push({
        id: eventId(currency, dt, title),
        dt,
        currency,
        impact: normImpact(it.impact),
        title,
        forecast: it.forecast ? String(it.forecast) : null,
        previous: it.previous ? String(it.previous) : null,
        actual: it.actual ? String(it.actual) : null,
      });
    }
  }

  // All requested feeds failed → surface the error so the caller can 502.
  if (okFeeds === 0 && want.length > 0) {
    throw new Error(errors.join('; ') || 'No feeds fetched');
  }

  const tx = db.transaction((list) => {
    for (const r of list) {
      stmt.run(r);
      count++;
    }
  });
  tx(rows);
  return { inserted: count, feeds: want, errors };
}

/**
 * Query cached events in a time window, optionally filtered by impact/currency.
 * @param {{ from?:string, to?:string, impact?:string, currency?:string, limit?:number }} q
 */
export function getNews(q = {}) {
  const clauses = [];
  const params = {};
  if (q.from) {
    clauses.push('dt >= @from');
    params.from = q.from;
  }
  if (q.to) {
    clauses.push('dt <= @to');
    params.to = q.to;
  }
  if (q.impact) {
    const list = String(q.impact)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (list.length) {
      clauses.push(`impact IN (${list.map((_, i) => `@imp${i}`).join(',')})`);
      list.forEach((v, i) => (params[`imp${i}`] = v));
    }
  }
  if (q.currency) {
    const list = String(q.currency)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (list.length) {
      clauses.push(`currency IN (${list.map((_, i) => `@cur${i}`).join(',')})`);
      list.forEach((v, i) => (params[`cur${i}`] = v));
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Number(q.limit) || 500, 2000);
  return db
    .prepare(
      `SELECT id, dt, currency, impact, title, forecast, previous, actual
         FROM news_events ${where} ORDER BY dt ASC LIMIT ${limit}`
    )
    .all(params);
}

export function newsStatus() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(dt) AS earliest,
              MAX(dt) AS latest,
              MAX(fetched_at) AS last_refresh
         FROM news_events`
    )
    .get();
  return {
    count: row.count || 0,
    earliest: row.earliest || null,
    latest: row.latest || null,
    last_refresh: row.last_refresh || null,
  };
}
