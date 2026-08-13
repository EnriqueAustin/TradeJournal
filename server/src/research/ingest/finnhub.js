import { FINNHUB_KEY } from '../../env.js';
import { marketDb } from '../schema.js';

const BASE = 'https://finnhub.io/api/v1';

export function finnhubConfigured() {
  return Boolean(FINNHUB_KEY);
}

const upsertEarning = marketDb.prepare(
  `INSERT INTO earnings (symbol, report_date, time, eps_est, eps_act, rev_est, rev_act)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(symbol, report_date) DO UPDATE SET
     time = excluded.time,
     eps_est = COALESCE(excluded.eps_est, earnings.eps_est),
     eps_act = COALESCE(excluded.eps_act, earnings.eps_act),
     rev_est = COALESCE(excluded.rev_est, earnings.rev_est),
     rev_act = COALESCE(excluded.rev_act, earnings.rev_act)`
);

export async function ingestEarnings(symbols) {
  if (!finnhubConfigured()) return { skipped: true, reason: 'FINNHUB_KEY not set' };

  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  const to = new Date();
  to.setMonth(to.getMonth() + 3);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const url = `${BASE}/calendar/earnings?from=${fromStr}&to=${toStr}&token=${FINNHUB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Finnhub earnings ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const calendar = body.earningsCalendar || [];

  const symSet = new Set(symbols.map((s) => s.toUpperCase()));
  const tx = marketDb.transaction((rows) => {
    let n = 0;
    for (const e of rows) {
      if (!symSet.has(e.symbol?.toUpperCase())) continue;
      const reportDate = new Date(e.date + 'T00:00:00Z').getTime();
      const time = e.hour === 'bmo' ? 'bmo' : e.hour === 'amc' ? 'amc' : 'dmt';
      upsertEarning.run(
        e.symbol.toUpperCase(),
        reportDate,
        time,
        e.epsEstimate ?? null,
        e.epsActual ?? null,
        e.revenueEstimate ?? null,
        e.revenueActual ?? null
      );
      n++;
    }
    return n;
  });

  const count = tx(calendar);
  updateHealth(null);
  return { count };
}

export function getUpcomingEarnings(symbols, { limit = 50 } = {}) {
  const now = Date.now() - 7 * 86400000;
  const placeholders = symbols.map(() => '?').join(',');
  return marketDb.prepare(
    `SELECT symbol, report_date, time, eps_est, eps_act, rev_est, rev_act
     FROM earnings WHERE symbol IN (${placeholders}) AND report_date >= ?
     ORDER BY report_date ASC LIMIT ?`
  ).all(...symbols, now, limit);
}

export function getRecentEarnings(symbols, { limit = 50 } = {}) {
  const placeholders = symbols.map(() => '?').join(',');
  return marketDb.prepare(
    `SELECT symbol, report_date, time, eps_est, eps_act, rev_est, rev_act
     FROM earnings WHERE symbol IN (${placeholders})
     ORDER BY report_date DESC LIMIT ?`
  ).all(...symbols, limit);
}

function updateHealth(error) {
  const source = 'finnhub_earnings';
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
