import { marketDb } from '../schema.js';

const upsertHolding = marketDb.prepare(
  `INSERT INTO etf_holdings (etf, date, tonnes, shares, aum)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(etf, date) DO UPDATE SET
     tonnes = excluded.tonnes, shares = excluded.shares, aum = excluded.aum`
);

// GLD historical data CSV from SPDR/World Gold Council
// URL may change — fallback to manual import via POST body.
const GLD_URL = 'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive.csv';

export async function ingestGldEtf() {
  const res = await fetch(GLD_URL, {
    headers: {
      'User-Agent': 'TradeJournal/1.0 (research tool)',
      Accept: 'text/csv,*/*',
    },
  });
  if (!res.ok) throw new Error(`GLD CSV ${res.status}: ${res.statusText}`);

  const text = await res.text();
  return parseAndStoreGld(text);
}

export function parseAndStoreGld(csvText) {
  const lines = csvText.trim().split('\n');
  // Find the header row (may have preamble rows)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('date') && (lower.includes('tonnes') || lower.includes('ton') || lower.includes('gold'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    // Fallback: assume first row is header
    headerIdx = 0;
  }

  const header = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const dateCol = header.findIndex(h => h.includes('date'));
  const tonnesCol = header.findIndex(h => h.includes('tonnes') || h.includes('ton'));
  const sharesCol = header.findIndex(h => h.includes('shares') || h.includes('share'));
  const aumCol = header.findIndex(h => h.includes('aum') || h.includes('value') || h.includes('nav'));

  if (dateCol === -1) throw new Error('GLD CSV: no date column found');

  const tx = marketDb.transaction(() => {
    let n = 0;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      if (cols.length <= dateCol) continue;

      const dateStr = cols[dateCol];
      if (!dateStr) continue;

      // Try multiple date formats
      let ts;
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts[2]?.length === 4) {
          // MM/DD/YYYY
          ts = Date.UTC(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        } else {
          ts = new Date(dateStr + 'T00:00:00Z').getTime();
        }
      } else {
        ts = new Date(dateStr + 'T00:00:00Z').getTime();
      }
      if (isNaN(ts)) continue;

      const tonnes = tonnesCol >= 0 ? parseFloat(cols[tonnesCol]) : null;
      const shares = sharesCol >= 0 ? parseFloat(cols[sharesCol]) : null;
      const aum = aumCol >= 0 ? parseFloat(cols[aumCol]) : null;

      if (tonnes == null && shares == null) continue;

      upsertHolding.run('GLD', ts, isNaN(tonnes) ? null : tonnes, isNaN(shares) ? null : shares, isNaN(aum) ? null : aum);
      n++;
    }
    return n;
  });

  const count = tx();
  updateHealth(null);
  return { etf: 'GLD', count };
}

function updateHealth(error) {
  const source = 'etf_gld';
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

export function getEtfHistory(etf = 'GLD', { limit = 90 } = {}) {
  return marketDb.prepare(
    'SELECT date, tonnes, shares, aum FROM etf_holdings WHERE etf = ? ORDER BY date DESC LIMIT ?'
  ).all(etf, limit).reverse();
}

export function getLatestEtf(etf = 'GLD') {
  return marketDb.prepare(
    'SELECT date, tonnes, shares, aum FROM etf_holdings WHERE etf = ? ORDER BY date DESC LIMIT 1'
  ).get(etf) ?? null;
}
