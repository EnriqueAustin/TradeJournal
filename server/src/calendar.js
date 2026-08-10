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

// ForexFactory's CDN aggressively throttles non-browser clients (429) and can
// briefly 404 a feed while it republishes. Use a browser-like User-Agent and
// retry transient statuses with exponential backoff before giving up.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real browser UA — the plain 'TradeJournal/1.0' agent gets 429'd on sight.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// A full browser header set — Cloudflare fingerprints on more than just the UA,
// so send the sec-ch-ua / sec-fetch hints a real Chrome request carries.
const BROWSER_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Referer: 'https://www.forexfactory.com/',
  Origin: 'https://www.forexfactory.com',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

async function fetchFeed(url, { retries = 2, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS });
    } catch (e) {
      lastErr = new Error(`ForexFactory network error for ${url}: ${e.message}`);
      continue;
    }
    // A 404 is not transient here — ForexFactory just hasn't published that
    // week's file yet — so surface it immediately instead of hammering the CDN.
    if (res.status === 404) throw new Error(`ForexFactory 404 for ${url}`);
    // 429 (rate limit) and 5xx are transient; back off and retry.
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`ForexFactory ${res.status} for ${url}`);
      continue;
    }
    if (!res.ok) throw new Error(`ForexFactory ${res.status} for ${url}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('Unexpected ForexFactory payload');
    return json;
  }
  throw lastErr;
}

const upsertStmt = () =>
  db.prepare(`
    INSERT INTO news_events (id, dt, currency, impact, title, forecast, previous, actual, url, source, fetched_at)
    VALUES (@id, @dt, @currency, @impact, @title, @forecast, @previous, @actual, @url, 'forexfactory', datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      forecast = excluded.forecast,
      previous = excluded.previous,
      -- actual/url only arrive from the browser scrape, not the JSON feed, so
      -- keep the existing value when a source (the feed) supplies none.
      actual   = COALESCE(excluded.actual, actual),
      url      = COALESCE(excluded.url, url),
      impact   = excluded.impact,
      fetched_at = excluded.fetched_at
  `);

// Map raw ForexFactory feed items into upsert rows, skipping anything without a
// parseable date or title. Shared by the server-side fetch and the browser/CLI
// ingest path so both normalize identically.
function mapFeedItems(items) {
  const rows = [];
  if (!Array.isArray(items)) return rows;
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
      url: it.url ? String(it.url) : null,
    });
  }
  return rows;
}

// Upsert mapped rows in a single transaction; returns the number written.
function upsertRows(rows) {
  const stmt = upsertStmt();
  let count = 0;
  const tx = db.transaction((list) => {
    for (const r of list) {
      stmt.run(r);
      count++;
    }
  });
  tx(rows);
  return count;
}

/**
 * Ingest raw ForexFactory feed data supplied by a client (browser or CLI on a
 * residential IP), bypassing the CDN block on the server's own outbound IP.
 * Accepts either a bare array of FF items, or an object keyed by feed name
 * ({ thisweek: [...], nextweek: [...] }) as posted by scripts/ingest-news.
 * @returns {{ inserted:number, received:number }}
 */
export function ingestNews(payload) {
  let items = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    for (const v of Object.values(payload)) {
      if (Array.isArray(v)) items = items.concat(v);
    }
  }
  if (!items.length) throw new Error('No calendar items in payload');
  const rows = mapFeedItems(items);
  const inserted = upsertRows(rows);
  lastError = null;
  return { inserted, received: items.length };
}

/**
 * Fetch one or more ForexFactory weekly feeds and upsert them.
 * @param {string[]} feeds subset of ['lastweek','thisweek','nextweek']
 * @returns {{ inserted:number, feeds:string[] }}
 */
export async function refreshNews(feeds = ['thisweek', 'nextweek']) {
  const want = feeds.filter((f) => FF_FEEDS[f]);

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
    rows.push(...mapFeedItems(items));
  }

  // All requested feeds failed → surface the error so the caller can 502.
  if (okFeeds === 0 && want.length > 0) {
    throw new Error(errors.join('; ') || 'No feeds fetched');
  }

  const count = upsertRows(rows);
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
      `SELECT id, dt, currency, impact, title, forecast, previous, actual, url
         FROM news_events ${where} ORDER BY dt ASC LIMIT ${limit}`
    )
    .all(params);
}

// ---------- background scheduler ----------
// Keeps the cache warm and pulls fresh actuals as ForexFactory publishes them,
// independent of any client. Survives client resets because it lives on the
// server; on server boot we refresh once, then poll on an interval.
let schedulerTimer = null;
let refreshing = false;
let lastError = null;

/** Refresh guarded against overlapping runs; never throws. */
export async function safeRefresh(feeds) {
  if (refreshing) return { skipped: true };
  refreshing = true;
  try {
    const r = await refreshNews(feeds);
    lastError = null;
    return r;
  } catch (e) {
    lastError = e.message;
    console.error('[news] refresh failed:', e.message);
    return { error: e.message };
  } finally {
    refreshing = false;
  }
}

export function startNewsScheduler(intervalSec = 300) {
  if (process.env.NODE_ENV === 'test') return null;
  stopNewsScheduler();
  // Kick off an initial fetch shortly after boot without blocking startup.
  setTimeout(() => safeRefresh(), 1000).unref?.();
  const ms = Math.max(60, intervalSec) * 1000;
  schedulerTimer = setInterval(() => safeRefresh(), ms);
  schedulerTimer.unref?.();
  console.log(`[news] scheduler running every ${Math.round(ms / 1000)}s`);
  return schedulerTimer;
}

export function stopNewsScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
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
    refreshing,
    auto: schedulerTimer != null,
    last_error: lastError,
  };
}
