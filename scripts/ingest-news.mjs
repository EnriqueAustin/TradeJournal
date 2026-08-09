#!/usr/bin/env node
// Fetch the ForexFactory weekly calendar feeds from THIS machine (a residential
// IP that Cloudflare doesn't block) and POST them to the Trade Journal server's
// /api/news/ingest endpoint. Run it on a schedule (Task Scheduler / cron) to
// keep the in-app Economic Calendar populated without the server ever touching
// the CDN itself.
//
//   node scripts/ingest-news.mjs
//
// Config via env:
//   NEWS_INGEST_URL   where to POST (default http://localhost:8080/api/news/ingest)
//   NEWS_FEEDS        comma list of feeds (default thisweek,nextweek)
//
// Requires Node 18+ (uses global fetch).

const INGEST_URL =
  process.env.NEWS_INGEST_URL || 'http://localhost:8080/api/news/ingest';
const FEEDS = (process.env.NEWS_FEEDS || 'thisweek,nextweek')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const FF_FEEDS = {
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  lastweek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
};

// A real browser header set so Cloudflare serves us like a normal visitor.
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
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`${name}: unexpected payload`);
  return json;
}

async function main() {
  const payload = {};
  let total = 0;
  for (const name of FEEDS) {
    try {
      const items = await fetchFeed(name);
      if (items) {
        payload[name] = items;
        total += items.length;
        console.log(`fetched ${name}: ${items.length} events`);
      } else {
        console.log(`skipped ${name}: not published yet (404)`);
      }
    } catch (e) {
      console.error(`error fetching ${name}: ${e.message}`);
    }
  }

  if (total === 0) {
    console.error('nothing fetched — leaving server cache untouched');
    process.exit(1);
  }

  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`ingest failed: HTTP ${res.status}`, body);
    process.exit(1);
  }
  console.log(`ingested ${body.inserted} of ${body.received} events → ${INGEST_URL}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
