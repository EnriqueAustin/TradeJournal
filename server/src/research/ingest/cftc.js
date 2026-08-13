import { marketDb } from '../schema.js';

const GOLD_MARKET = 'GOLD - COMMODITY EXCHANGE INC.';

const upsertCot = marketDb.prepare(
  `INSERT INTO cot (report_date, market, mm_long, mm_short, comm_long, comm_short, oi)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(report_date, market) DO UPDATE SET
     mm_long = excluded.mm_long, mm_short = excluded.mm_short,
     comm_long = excluded.comm_long, comm_short = excluded.comm_short,
     oi = excluded.oi`
);

// CFTC Disaggregated Futures-Only report (CSV)
// Current year: https://www.cftc.gov/dea/newcot/f_disagg.txt
// Historical: https://www.cftc.gov/files/dea/history/fut_disagg_txt_YYYY.zip
// We use the current-year text file (comma-delimited) which covers Jan–present.

export async function ingestCftc() {
  const url = 'https://www.cftc.gov/dea/newcot/f_disagg.txt';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TradeJournal/1.0 (research tool)' },
  });
  if (!res.ok) throw new Error(`CFTC ${res.status}: ${res.statusText}`);

  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CFTC: empty response');

  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const idx = (name) => {
    const i = header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
    if (i === -1) throw new Error(`CFTC: column "${name}" not found in header`);
    return i;
  };

  const iMarket = idx('Market_and_Exchange_Names');
  const iDate = idx('As_of_Date_In_Form_YYMMDD');
  const iMmLong = idx('M_Money_Positions_Long_All');
  const iMmShort = idx('M_Money_Positions_Short_All');
  const iProdLong = idx('Prod_Merc_Positions_Long_All');
  const iProdShort = idx('Prod_Merc_Positions_Short_All');
  const iOi = idx('Open_Interest_All');

  const tx = marketDb.transaction(() => {
    let n = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const market = cols[iMarket] || '';
      if (!market.includes('GOLD')) continue;

      const dateStr = cols[iDate];
      // Format YYMMDD
      const yy = parseInt(dateStr.slice(0, 2), 10);
      const mm = parseInt(dateStr.slice(2, 4), 10) - 1;
      const dd = parseInt(dateStr.slice(4, 6), 10);
      const year = yy < 50 ? 2000 + yy : 1900 + yy;
      const ts = Date.UTC(year, mm, dd);

      upsertCot.run(
        ts,
        GOLD_MARKET,
        parseInt(cols[iMmLong], 10) || 0,
        parseInt(cols[iMmShort], 10) || 0,
        parseInt(cols[iProdLong], 10) || 0,
        parseInt(cols[iProdShort], 10) || 0,
        parseInt(cols[iOi], 10) || 0,
      );
      n++;
    }
    return n;
  });

  const count = tx();
  updateHealth(null);
  return { count };
}

function updateHealth(error) {
  const source = 'cftc_gold';
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

export function getCotHistory(market = GOLD_MARKET, { limit = 156 } = {}) {
  return marketDb.prepare(
    'SELECT report_date, market, mm_long, mm_short, comm_long, comm_short, oi FROM cot WHERE market = ? ORDER BY report_date DESC LIMIT ?'
  ).all(market, limit).reverse();
}

export function getLatestCot(market = GOLD_MARKET) {
  return marketDb.prepare(
    'SELECT report_date, market, mm_long, mm_short, comm_long, comm_short, oi FROM cot WHERE market = ? ORDER BY report_date DESC LIMIT 1'
  ).get(market) ?? null;
}
