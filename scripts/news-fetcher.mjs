#!/usr/bin/env node
// Host-side ForexFactory fetcher for Trade Journal.
//
// The app server (Docker container) is Cloudflare-blocked (429) from the FF
// feed, and the browser can't read it directly (no CORS headers). But THIS
// host's outbound IP is not blocked — so this tiny always-on service fetches
// the feed here and POSTs it to the server's /api/news/ingest endpoint.
//
// It does two jobs:
//   1. Serves GET /refresh with CORS allowed for the app origin, so the app's
//      "Refresh now" button can trigger an on-demand pull the instant a
//      high-impact actual is released.
//   2. Optionally auto-polls on an interval so the calendar stays fresh
//      hands-free (set POLL_SEC=0 to disable).
//
// RATE LIMITS: faireconomy throttles by IP. Occasional fetches are fine, but
// bursts get the IP 429'd for SEVERAL MINUTES. So keep POLL_SEC generous
// (180s+) and don't spam the button — one refresh a minute or so after a
// release is enough to pick up the actual. This free feed cannot do
// sub-minute polling; if you need that, use a keyed provider instead.
//
//   node scripts/news-fetcher.mjs
//
// Config via env:
//   FETCHER_PORT   port to listen on            (default 4100)
//   INGEST_URL     where to POST feed JSON       (default http://localhost:8080/api/news/ingest)
//   ALLOW_ORIGIN   CORS origin for the button    (default http://localhost:8080)
//   NEWS_FEEDS     comma list of feeds           (default thisweek,nextweek)
//   POLL_SEC       background auto-poll seconds   (default 0 = off; min 60, use 180+)
//
// Requires Node 18+ (global fetch).

import http from 'node:http';

const PORT = Number(process.env.FETCHER_PORT || 4100);
const INGEST_URL =
  process.env.INGEST_URL || 'http://localhost:8080/api/news/ingest';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'http://localhost:8080';
const FEEDS = (process.env.NEWS_FEEDS || 'thisweek,nextweek')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const POLL_SEC = Number(process.env.POLL_SEC || 0);

const FF_FEEDS = {
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  lastweek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.forexfactory.com/',
};

async function fetchFeed(name) {
  const url = FF_FEEDS[name];
  if (!url) throw new Error(`unknown feed "${name}"`);
  const res = await fetch(url, { headers: HEADERS });
  // nextweek legitimately 404s until ForexFactory publishes it mid-week.
  if (res.status === 404) return null;
  // 429 = IP rate-limited; retrying now won't help (cooldown is minutes).
  if (res.status === 429) {
    throw new Error(`${name}: rate-limited (429) — wait a few minutes`);
  }
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`${name}: unexpected payload`);
  return json;
}

// Fetch every configured feed and POST the combined payload to the server.
async function pullAndIngest() {
  const payload = {};
  let fetched = 0;
  for (const name of FEEDS) {
    const items = await fetchFeed(name); // let errors bubble to the caller
    if (items) {
      payload[name] = items;
      fetched += items.length;
    }
  }
  if (fetched === 0) throw new Error('no events fetched');

  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ingest HTTP ${res.status}: ${body.error || 'failed'}`);
  }
  return { fetched, ...body };
}

const server = http.createServer(async (req, res) => {
  // CORS so the browser button (different origin) may call us.
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/refresh') {
    try {
      const result = await pullAndIngest();
      console.log(
        `[refresh] ingested ${result.inserted}/${result.received} events`
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      console.error('[refresh] failed:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`news-fetcher listening on http://localhost:${PORT}`);
  console.log(`  → ingesting to ${INGEST_URL}`);
  console.log(`  → CORS origin ${ALLOW_ORIGIN}`);
  if (POLL_SEC > 0) {
    console.log(`  → auto-poll every ${POLL_SEC}s`);
    const tick = () =>
      pullAndIngest()
        .then((r) => console.log(`[poll] ingested ${r.inserted}/${r.received}`))
        .catch((e) => console.error('[poll] failed:', e.message));
    tick();
    setInterval(tick, Math.max(60, POLL_SEC) * 1000);
  } else {
    console.log('  → auto-poll disabled (set POLL_SEC=30 to enable)');
  }
});
