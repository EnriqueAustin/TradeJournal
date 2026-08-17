import crypto from 'node:crypto';
import { marketDb } from '../schema.js';
import { callLLM } from '../../ai.js';

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

const GDELT_QUERIES = {
  XAUUSD: '"gold price" OR "XAUUSD" OR "gold futures" OR "precious metals" OR "gold market" OR "gold rally" OR "gold selloff" OR "bullion"',
  US100: '"nasdaq" OR "nasdaq 100" OR "tech stocks" OR "QQQ" OR "S&P 500" OR "Mag-7" OR "magnificent seven"',
};

const RSS_FEEDS = [
  { url: 'https://www.kitco.com/feed', source: 'kitco' },
  { url: 'https://www.investing.com/rss/news_14.rss', source: 'investing.com' },
  { url: 'https://www.fxstreet.com/rss', source: 'fxstreet' },
];

const GOLD_KW = /\bgold\b|xauusd|xau|precious metal|bullion|GLD\b|gold futures/i;
const NQ_KW = /nasdaq|QQQ\b|US100\b|NAS100\b|tech stocks?\b|AAPL\b|MSFT\b|NVDA\b|AMZN\b|GOOG\b|META\b|TSLA\b/i;

const UA = 'TradeJournal/1.0 (research tool)';

function newsId(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

const upsertNews = marketDb.prepare(
  `INSERT INTO news (id, ts, source, headline, url, instruments, sentiment)
   VALUES (?, ?, ?, ?, ?, ?, NULL)
   ON CONFLICT(id) DO NOTHING`
);

function tagInstruments(text) {
  const g = GOLD_KW.test(text);
  const n = NQ_KW.test(text);
  if (g && n) return 'XAUUSD,US100';
  if (g) return 'XAUUSD';
  if (n) return 'US100';
  return null;
}

export async function ingestGdelt() {
  let inserted = 0, skipped = 0;

  for (const [instrument, query] of Object.entries(GDELT_QUERIES)) {
    const params = new URLSearchParams({
      query,
      mode: 'ArtList',
      format: 'json',
      maxrecords: '75',
      timespan: '60min',
    });

    try {
      const res = await fetch(`${GDELT_BASE}?${params}`, {
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) {
        console.warn(`GDELT ${instrument}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const articles = json.articles || [];

      const tx = marketDb.transaction(() => {
        for (const art of articles) {
          if (!art.url || !art.title) continue;
          const id = newsId(art.url);
          const ts = art.seendate
            ? new Date(art.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).getTime()
            : Date.now();
          if (isNaN(ts)) continue;

          const existing = marketDb.prepare('SELECT id FROM news WHERE id = ?').get(id);
          if (existing) { skipped++; continue; }

          const tagged = tagInstruments(art.title) || instrument;
          const domain = art.domain || new URL(art.url).hostname;
          upsertNews.run(id, ts, domain, art.title, art.url, tagged);
          inserted++;
        }
      });
      tx();
    } catch (err) {
      console.warn(`GDELT ${instrument}:`, err.message);
    }
  }

  return { inserted, skipped };
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>|<title>([\s\S]*?)<\/title>/i);
    const link = block.match(/<link>([\s\S]*?)<\/link>/i);
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const desc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>|<description>([\s\S]*?)<\/description>/i);

    const headline = (title?.[1] || title?.[2] || '').trim();
    const url = (link?.[1] || '').trim();
    if (!headline || !url) continue;

    const dateStr = (pubDate?.[1] || '').trim();
    const ts = dateStr ? new Date(dateStr).getTime() : Date.now();
    const description = (desc?.[1] || desc?.[2] || '').trim();

    items.push({ headline, url, ts: isNaN(ts) ? Date.now() : ts, description });
  }
  return items;
}

export async function ingestRss() {
  let inserted = 0, skipped = 0;

  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' },
      });
      if (!res.ok) {
        console.warn(`RSS ${feed.source}: HTTP ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const items = parseRssItems(xml);

      const tx = marketDb.transaction(() => {
        for (const item of items) {
          const id = newsId(item.url);
          const existing = marketDb.prepare('SELECT id FROM news WHERE id = ?').get(id);
          if (existing) { skipped++; continue; }

          const text = `${item.headline} ${item.description || ''}`;
          const instruments = tagInstruments(text);
          upsertNews.run(id, item.ts, feed.source, item.headline, item.url, instruments);
          inserted++;
        }
      });
      tx();
    } catch (err) {
      console.warn(`RSS ${feed.source}:`, err.message);
    }
  }

  return { inserted, skipped };
}

export async function scoreSentiment({ limit = 20 } = {}) {
  const unscored = marketDb.prepare(
    'SELECT id, headline, instruments FROM news WHERE sentiment IS NULL ORDER BY ts DESC LIMIT ?'
  ).all(limit);

  if (!unscored.length) return { scored: 0 };

  const batch = unscored.map(r => ({ id: r.id, headline: r.headline }));

  const system = `You are a financial sentiment classifier. Score each headline for market impact.
Return ONLY a JSON array: [{"id":"...","sentiment":0.0}]
- sentiment: -1.0 (very bearish) to 1.0 (very bullish), 0 = neutral
- Consider the impact on the instruments mentioned (gold = XAUUSD, tech/nasdaq = US100)
Be precise: rate cuts = bullish equities, strong jobs = hawkish = bearish gold, etc.`;

  const prompt = `Score these headlines:\n${batch.map(b => `[${b.id}] ${b.headline}`).join('\n')}`;

  try {
    const raw = await callLLM({ system, prompt });
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { scored: 0, error: 'no JSON array in response' };

    const scores = JSON.parse(jsonMatch[0]);
    const updateStmt = marketDb.prepare('UPDATE news SET sentiment = ? WHERE id = ?');

    const tx = marketDb.transaction(() => {
      let n = 0;
      for (const s of scores) {
        if (typeof s.id !== 'string' || typeof s.sentiment !== 'number') continue;
        const clamped = Math.max(-1, Math.min(1, s.sentiment));
        updateStmt.run(clamped, s.id);
        n++;
      }
      return n;
    });

    return { scored: tx() };
  } catch (err) {
    return { scored: 0, error: err.message };
  }
}

export function getNewsFeed({ instrument, limit = 50, since, sentiment, source } = {}) {
  let sql = 'SELECT * FROM news WHERE 1=1';
  const params = [];

  if (instrument) {
    sql += ' AND instruments LIKE ?';
    params.push(`%${instrument}%`);
  }
  if (since) {
    sql += ' AND ts > ?';
    params.push(since);
  }
  if (sentiment === 'bullish') {
    sql += ' AND sentiment > 0.2';
  } else if (sentiment === 'bearish') {
    sql += ' AND sentiment < -0.2';
  } else if (sentiment === 'neutral') {
    sql += ' AND sentiment BETWEEN -0.2 AND 0.2';
  }
  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  sql += ' ORDER BY ts DESC LIMIT ?';
  params.push(limit);

  return marketDb.prepare(sql).all(...params);
}

export function getNewsSummary() {
  const since = Date.now() - 24 * 60 * 60 * 1000;

  const total24h = marketDb.prepare(
    'SELECT COUNT(*) as c FROM news WHERE ts > ?'
  ).get(since).c;

  const bullish = marketDb.prepare(
    'SELECT COUNT(*) as c FROM news WHERE ts > ? AND sentiment > 0.2'
  ).get(since).c;

  const bearish = marketDb.prepare(
    'SELECT COUNT(*) as c FROM news WHERE ts > ? AND sentiment < -0.2'
  ).get(since).c;

  const neutral = marketDb.prepare(
    'SELECT COUNT(*) as c FROM news WHERE ts > ? AND sentiment BETWEEN -0.2 AND 0.2'
  ).get(since).c;

  const topSources = marketDb.prepare(
    'SELECT source, COUNT(*) as count FROM news WHERE ts > ? AND source IS NOT NULL GROUP BY source ORDER BY count DESC LIMIT 5'
  ).all(since);

  const lastRow = marketDb.prepare(
    "SELECT last_ok FROM source_health WHERE source = 'news_gdelt'"
  ).get();

  return {
    total24h,
    bullish,
    bearish,
    neutral,
    topSources,
    lastIngest: lastRow?.last_ok || null,
  };
}

function updateHealth(source, error) {
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

export async function ingestAllNews() {
  const results = { gdelt: null, rss: null, sentiment: null };

  try {
    results.gdelt = await ingestGdelt();
    updateHealth('news_gdelt', null);
  } catch (err) {
    results.gdelt = { error: err.message };
    updateHealth('news_gdelt', err.message);
  }

  try {
    results.rss = await ingestRss();
    updateHealth('news_rss', null);
  } catch (err) {
    results.rss = { error: err.message };
    updateHealth('news_rss', err.message);
  }

  try {
    results.sentiment = await scoreSentiment();
  } catch (err) {
    results.sentiment = { scored: 0, error: err.message };
  }

  return results;
}
