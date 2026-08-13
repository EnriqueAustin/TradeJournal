import { ALPACA_KEY, ALPACA_SECRET } from '../../env.js';

const BASE = 'https://data.alpaca.markets/v2';

export function alpacaConfigured() {
  return Boolean(ALPACA_KEY && ALPACA_SECRET);
}

export async function fetchSnapshots(symbols) {
  if (!alpacaConfigured()) return {};
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 50) {
    chunks.push(symbols.slice(i, i + 50));
  }

  const out = {};
  for (const chunk of chunks) {
    const url = `${BASE}/stocks/snapshots?symbols=${chunk.join(',')}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Alpaca snapshots ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    for (const [sym, snap] of Object.entries(data)) {
      const lt = snap.latestTrade;
      const lq = snap.latestQuote;
      const bar = snap.dailyBar;
      const prevBar = snap.prevDailyBar;
      out[sym] = {
        price: lt?.p ?? null,
        bid: lq?.bp ?? null,
        ask: lq?.ap ?? null,
        open: bar?.o ?? null,
        high: bar?.h ?? null,
        low: bar?.l ?? null,
        close: bar?.c ?? null,
        volume: bar?.v ?? null,
        prevClose: prevBar?.c ?? null,
        change: lt?.p && prevBar?.c ? lt.p - prevBar.c : null,
        changePct: lt?.p && prevBar?.c ? ((lt.p - prevBar.c) / prevBar.c) * 100 : null,
        ts: lt?.t ? new Date(lt.t).getTime() : null,
      };
    }
  }
  return out;
}
