// Actuals for the economic calendar.
//
// The free ForexFactory JSON feed carries forecast/previous but never `actual`
// (only the browser userscript scrape did), so past events stayed blank. The
// TradingView economic-calendar endpoint is public, not Cloudflare-walled, and
// does publish actuals — pull it for the recent window and match each blank FF
// event to a TV event by currency + release minute + title/forecast similarity.
// Pure helpers are exported for tests; the fetch lives in fetchTvEvents.

const TV_URL = 'https://economic-calendar.tradingview.com/events';

// FF currency → TV country code.
const CCY_COUNTRY = {
  USD: 'US',
  EUR: 'EU',
  GBP: 'GB',
  JPY: 'JP',
  AUD: 'AU',
  NZD: 'NZ',
  CAD: 'CA',
  CHF: 'CH',
  CNY: 'CN',
};

// FF and TV name the same release differently; fold both onto shared tokens.
const PHRASES = [
  [/\bm\/m\b/g, 'mom'],
  [/\by\/y\b/g, 'yoy'],
  [/\bq\/q\b/g, 'qoq'],
  [/\b3m\/y\b/g, '3mo yr'],
  [/\bcpi\b/g, 'inflation rate'],
  [/\bppi\b/g, 'producer prices'],
  [/\bfederal funds rate\b/g, 'fed interest rate decision'],
  [/\bofficial bank rate\b/g, 'interest rate decision'],
  [/\bcash rate\b/g, 'interest rate decision'],
  [/\bcore retail sales\b/g, 'retail sales ex autos'],
  [/\bnon-farm employment change\b/g, 'non farm payrolls'],
  [/\bunemployment claims\b/g, 'initial jobless claims'],
  [/\bgdp\b/g, 'gdp growth rate'],
  [/\bflash\b/g, ''],
  [/\bprelim\b/g, ''],
];
const STOP = new Set(['the', 'of', 'and', 'incl', 's', 'change', 'index']);

export function titleTokens(title) {
  let s = String(title || '').toLowerCase();
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  return new Set(
    s
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t && !STOP.has(t))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// "0.8%" / "-11.0K" / "4.00%" → number, or null.
export function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[%KMBT$€£¥,]/gi, '').trim());
  return Number.isFinite(n) ? n : null;
}

function decimals(s) {
  const m = /\.(\d+)/.exec(String(s || ''));
  return m ? m[1].length : null;
}

// TV actual → FF-style string ("1.2%", "8.3K", "4.00%"), borrowing the FF
// event's decimal places so it reads like the forecast beside it.
export function formatActual(tv, ff) {
  const a = num(tv.actual);
  if (a == null) return null;
  const dp = decimals(ff.forecast) ?? decimals(ff.previous);
  const body = dp != null ? a.toFixed(dp) : String(a);
  const scale = tv.scale ? String(tv.scale).toUpperCase() : '';
  const pct = tv.unit === '%' ? '%' : '';
  return `${body}${scale}${pct}`;
}

/**
 * Best TV match for one FF event, or null. Candidates must share currency and
 * release minute; among them, score title overlap plus agreement of forecast /
 * previous numbers, and require a clear signal before trusting it.
 */
export function matchEvent(ff, tvEvents) {
  const minute = String(ff.dt).slice(0, 16);
  const ffTok = titleTokens(ff.title);
  const ffF = num(ff.forecast);
  const ffP = num(ff.previous);
  let best = null;
  let bestScore = 0;
  for (const tv of tvEvents) {
    if (String(tv.currency || '').toUpperCase() !== ff.currency) continue;
    if (String(tv.date || '').slice(0, 16) !== minute) continue;
    if (num(tv.actual) == null) continue;
    const sim = jaccard(ffTok, titleTokens(tv.title));
    // An exact token match outranks a near-name that happens to share a number
    // (e.g. Retail Sales Ex Autos vs Ex Gas/Autos with the same previous).
    let score = sim * 4 + (sim === 1 ? 1.5 : 0);
    const tvF = num(tv.forecast);
    if (ffF != null && tvF != null && Math.abs(ffF - tvF) < 1e-9) score += 2;
    const tvP = num(tv.previous);
    if (ffP != null && tvP != null && Math.abs(ffP - tvP) < 1e-9) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = tv;
    }
  }
  return bestScore >= 2 ? best : null;
}

export function countriesFor(currencies) {
  return [...new Set(currencies.map((c) => CCY_COUNTRY[c]).filter(Boolean))];
}

export async function fetchTvEvents(fromIso, toIso, countries) {
  const qs = new URLSearchParams({ from: fromIso, to: toIso, countries: countries.join(',') });
  const res = await fetch(`${TV_URL}?${qs}`, {
    headers: {
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`TradingView calendar ${res.status}`);
  const json = await res.json();
  if (json?.status !== 'ok' || !Array.isArray(json.result)) {
    throw new Error('Unexpected TradingView calendar payload');
  }
  return json.result;
}
