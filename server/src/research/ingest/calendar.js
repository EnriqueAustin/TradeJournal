import crypto from 'node:crypto';
import { marketDb } from '../schema.js';

const FF_FEEDS = {
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  lastweek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normImpact(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  if (s.startsWith('low')) return 'low';
  if (s.startsWith('holiday') || s.startsWith('non')) return 'holiday';
  return 'low';
}

function eventId(currency, tsMs, title) {
  return crypto
    .createHash('sha1')
    .update(`${currency}|${tsMs}|${title}`)
    .digest('hex')
    .slice(0, 16);
}

function parseNumeric(val) {
  if (val == null || val === '') return null;
  const s = String(val).replace(/[%KMBTkbt,]/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapFeedItems(items) {
  const rows = [];
  if (!Array.isArray(items)) return rows;
  for (const it of items) {
    const d = new Date(it.date);
    if (Number.isNaN(d.getTime())) continue;
    const tsMs = d.getTime();
    const country = String(it.country || it.currency || '').toUpperCase();
    const title = String(it.title || '').trim();
    if (!title) continue;
    rows.push({
      id: eventId(country, tsMs, title),
      ts: tsMs,
      country,
      name: title,
      impact: normImpact(it.impact),
      consensus: parseNumeric(it.forecast),
      prior: parseNumeric(it.previous),
      actual: parseNumeric(it.actual),
    });
  }
  return rows;
}

const upsertStmt = () =>
  marketDb.prepare(`
    INSERT INTO calendar_events (id, ts, country, name, impact, consensus, prior, actual)
    VALUES (@id, @ts, @country, @name, @impact, @consensus, @prior, @actual)
    ON CONFLICT(id) DO UPDATE SET
      actual    = COALESCE(excluded.actual, actual),
      consensus = COALESCE(excluded.consensus, consensus),
      prior     = COALESCE(excluded.prior, prior),
      impact    = excluded.impact
  `);

function upsertRows(rows) {
  const stmt = upsertStmt();
  let count = 0;
  const tx = marketDb.transaction((list) => {
    for (const r of list) {
      stmt.run(r);
      count++;
    }
  });
  tx(rows);
  return count;
}

async function fetchFeed(url, { retries = 2, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS });
    } catch (e) {
      lastErr = new Error(`Calendar network error for ${url}: ${e.message}`);
      continue;
    }
    if (res.status === 404) throw new Error(`Calendar 404 for ${url}`);
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Calendar ${res.status} for ${url}`);
      continue;
    }
    if (!res.ok) throw new Error(`Calendar ${res.status} for ${url}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('Unexpected calendar payload');
    return json;
  }
  throw lastErr;
}

export async function ingestCalendar(feeds = ['lastweek', 'thisweek', 'nextweek']) {
  const want = feeds.filter((f) => FF_FEEDS[f]);
  const rows = [];
  const errors = [];
  let okFeeds = 0;

  for (const f of want) {
    try {
      const items = await fetchFeed(FF_FEEDS[f]);
      rows.push(...mapFeedItems(items));
      okFeeds++;
    } catch (e) {
      errors.push(`${f}: ${e.message}`);
    }
  }

  if (okFeeds === 0 && want.length > 0) {
    throw new Error(errors.join('; ') || 'No calendar feeds fetched');
  }

  const count = upsertRows(rows);

  marketDb
    .prepare(
      `INSERT INTO source_health (source, last_ok, status)
       VALUES ('calendar_ff', ?, 'ok')
       ON CONFLICT(source) DO UPDATE SET last_ok = excluded.last_ok, status = 'ok', last_error = NULL`
    )
    .run(Date.now());

  return { inserted: count, feeds: want, errors };
}

export function ingestCalendarPayload(payload) {
  let items = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    if (payload.events && Array.isArray(payload.events)) {
      items = payload.events;
    } else {
      for (const v of Object.values(payload)) {
        if (Array.isArray(v)) items = items.concat(v);
      }
    }
  }
  if (!items.length) throw new Error('No calendar items in payload');
  const rows = mapFeedItems(items);
  const inserted = upsertRows(rows);

  marketDb
    .prepare(
      `INSERT INTO source_health (source, last_ok, status)
       VALUES ('calendar_ff', ?, 'ok')
       ON CONFLICT(source) DO UPDATE SET last_ok = excluded.last_ok, status = 'ok', last_error = NULL`
    )
    .run(Date.now());

  return { inserted, received: items.length };
}

export function getCalendarEvents({ impact, country, from, to, limit = 200 } = {}) {
  const clauses = [];
  const params = {};

  if (from) {
    clauses.push('ts >= @from');
    params.from = Number(from);
  }
  if (to) {
    clauses.push('ts <= @to');
    params.to = Number(to);
  }
  if (impact) {
    const list = String(impact).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (list.length) {
      clauses.push(`impact IN (${list.map((_, i) => `@imp${i}`).join(',')})`);
      list.forEach((v, i) => (params[`imp${i}`] = v));
    }
  }
  if (country) {
    const list = String(country).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) {
      clauses.push(`country IN (${list.map((_, i) => `@ctry${i}`).join(',')})`);
      list.forEach((v, i) => (params[`ctry${i}`] = v));
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Number(limit) || 200, 1000);

  return marketDb
    .prepare(`SELECT id, ts, country, name, impact, consensus, prior, actual
              FROM calendar_events ${where} ORDER BY ts ASC LIMIT ${lim}`)
    .all(params);
}

export function getEventsForReaction(eventPattern, { limit = 100 } = {}) {
  return marketDb
    .prepare(
      `SELECT id, ts, country, name, impact, consensus, prior, actual
       FROM calendar_events
       WHERE name LIKE @pattern AND actual IS NOT NULL
       ORDER BY ts DESC LIMIT @limit`
    )
    .all({ pattern: `%${eventPattern}%`, limit: Math.min(limit, 200) });
}
