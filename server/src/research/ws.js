import { WebSocketServer } from 'ws';
import { OANDA_API_TOKEN, OANDA_ENV } from '../env.js';

const OANDA_HOSTS = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com',
};

const INSTRUMENTS = [
  { symbol: 'XAUUSD', oanda: 'XAU_USD' },
  { symbol: 'US100', oanda: 'NAS100_USD' },
];

const POLL_MS = 2000;

const latestPrices = new Map();
let wss = null;

function normTime(t) {
  const s = String(t).replace(/(\.\d{3})\d*Z$/, '$1Z');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchLatestPrice(oandaSymbol) {
  const host = OANDA_HOSTS[OANDA_ENV] || OANDA_HOSTS.practice;
  const url = new URL(`${host}/v3/instruments/${oandaSymbol}/candles`);
  url.searchParams.set('granularity', 'S5');
  url.searchParams.set('count', '1');
  url.searchParams.set('price', 'M');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_TOKEN}`,
      'Accept-Datetime-Format': 'RFC3339',
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const candle = json.candles?.[0];
  if (!candle?.mid) return null;

  const t = normTime(candle.time);
  return {
    ts: t ? t.getTime() : Date.now(),
    bid: Number(candle.mid.c),
    ask: Number(candle.mid.c),
    mid: Number(candle.mid.c),
  };
}

function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

let _pollTimer = null;

async function pollPrices() {
  if (!OANDA_API_TOKEN) return;

  for (const { symbol, oanda } of INSTRUMENTS) {
    try {
      const price = await fetchLatestPrice(oanda);
      if (!price) continue;

      const prev = latestPrices.get(symbol);
      latestPrices.set(symbol, price);

      if (!prev || prev.mid !== price.mid || price.ts - prev.ts >= 1000) {
        broadcast({
          type: 'price',
          instrument: symbol,
          ...price,
        });
      }
    } catch {
      // silently skip — next poll will retry
    }
  }
}

export function getLatestPrice(symbol) {
  return latestPrices.get(symbol) || null;
}

export function initResearchWs(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws/research') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    for (const [symbol, price] of latestPrices) {
      ws.send(JSON.stringify({ type: 'price', instrument: symbol, ...price }));
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // ignore
      }
    });
  });

  if (OANDA_API_TOKEN) {
    pollPrices();
    _pollTimer = setInterval(pollPrices, POLL_MS);
    _pollTimer.unref();
    console.log(`[signal] WS live prices polling every ${POLL_MS}ms`);
  } else {
    console.log('[signal] WS started but no OANDA token — no live prices');
  }

  return wss;
}
