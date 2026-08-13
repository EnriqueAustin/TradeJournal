import { marketDb } from '../schema.js';

const MAG7 = new Set(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA']);

const QQQ_TOP = [
  { symbol: 'AAPL',  weight: 8.87, sector: 'Technology' },
  { symbol: 'MSFT',  weight: 8.29, sector: 'Technology' },
  { symbol: 'NVDA',  weight: 7.61, sector: 'Technology' },
  { symbol: 'AMZN',  weight: 5.48, sector: 'Consumer Discretionary' },
  { symbol: 'META',  weight: 4.98, sector: 'Communication Services' },
  { symbol: 'GOOGL', weight: 2.87, sector: 'Communication Services' },
  { symbol: 'GOOG',  weight: 2.74, sector: 'Communication Services' },
  { symbol: 'TSLA',  weight: 3.86, sector: 'Consumer Discretionary' },
  { symbol: 'AVGO',  weight: 4.63, sector: 'Technology' },
  { symbol: 'COST',  weight: 2.60, sector: 'Consumer Staples' },
  { symbol: 'NFLX',  weight: 2.32, sector: 'Communication Services' },
  { symbol: 'TMUS',  weight: 1.75, sector: 'Communication Services' },
  { symbol: 'AMD',   weight: 1.60, sector: 'Technology' },
  { symbol: 'ADBE',  weight: 1.52, sector: 'Technology' },
  { symbol: 'QCOM',  weight: 1.41, sector: 'Technology' },
  { symbol: 'LIN',   weight: 1.40, sector: 'Materials' },
  { symbol: 'TXN',   weight: 1.32, sector: 'Technology' },
  { symbol: 'ISRG',  weight: 1.30, sector: 'Health Care' },
  { symbol: 'AMGN',  weight: 1.20, sector: 'Health Care' },
  { symbol: 'INTU',  weight: 1.20, sector: 'Technology' },
  { symbol: 'BKNG',  weight: 1.18, sector: 'Consumer Discretionary' },
  { symbol: 'PEP',   weight: 1.10, sector: 'Consumer Staples' },
  { symbol: 'AMAT',  weight: 1.08, sector: 'Technology' },
  { symbol: 'PANW',  weight: 0.97, sector: 'Technology' },
  { symbol: 'ADP',   weight: 0.90, sector: 'Industrials' },
  { symbol: 'MU',    weight: 0.85, sector: 'Technology' },
  { symbol: 'LRCX',  weight: 0.82, sector: 'Technology' },
  { symbol: 'KLAC',  weight: 0.78, sector: 'Technology' },
  { symbol: 'MELI',  weight: 0.75, sector: 'Consumer Discretionary' },
  { symbol: 'SNPS',  weight: 0.72, sector: 'Technology' },
  { symbol: 'CDNS',  weight: 0.68, sector: 'Technology' },
  { symbol: 'INTC',  weight: 0.66, sector: 'Technology' },
  { symbol: 'CRWD',  weight: 0.65, sector: 'Technology' },
  { symbol: 'MDLZ',  weight: 0.60, sector: 'Consumer Staples' },
  { symbol: 'MAR',   weight: 0.55, sector: 'Consumer Discretionary' },
  { symbol: 'PYPL',  weight: 0.54, sector: 'Financials' },
  { symbol: 'MRVL',  weight: 0.53, sector: 'Technology' },
  { symbol: 'CEG',   weight: 0.52, sector: 'Utilities' },
  { symbol: 'CSX',   weight: 0.50, sector: 'Industrials' },
  { symbol: 'ORLY',  weight: 0.49, sector: 'Consumer Discretionary' },
];

export { MAG7 };

const upsertStmt = marketDb.prepare(
  `INSERT INTO constituents (index_id, symbol, weight, sector, asof)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(index_id, symbol, asof) DO UPDATE SET
     weight = excluded.weight, sector = excluded.sector`
);

export function ingestConstituents() {
  const asof = startOfDayMs();
  const tx = marketDb.transaction(() => {
    let n = 0;
    for (const c of QQQ_TOP) {
      upsertStmt.run('QQQ', c.symbol, c.weight, c.sector, asof);
      n++;
    }
    return n;
  });
  const count = tx();
  updateHealth(null);
  return { count, asof };
}

export function getConstituents() {
  const latest = marketDb.prepare(
    `SELECT MAX(asof) as latest FROM constituents WHERE index_id = 'QQQ'`
  ).get();
  if (!latest?.latest) return [];
  return marketDb.prepare(
    `SELECT index_id, symbol, weight, sector, asof FROM constituents
     WHERE index_id = 'QQQ' AND asof = ? ORDER BY weight DESC`
  ).all(latest.latest);
}

export function isMag7(symbol) {
  return MAG7.has(symbol);
}

function startOfDayMs() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function updateHealth(error) {
  const source = 'constituents_qqq';
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
