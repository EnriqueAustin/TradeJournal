import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// import.js is pure (no db singleton), but set a scratch JOURNAL_DB defensively
// in case a transitive import ever pulls in db.js.
process.env.JOURNAL_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'tj-import-')),
  'test.db'
);

const { parseImport, extractRows } = await import('./import.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(__dirname, '..', '..', 'samples');
const buf = (s) => Buffer.from(s, 'utf8');
const byTime = (a, b) => a.entry_time.localeCompare(b.entry_time);

// ---------------------------------------------------------------------------
// MT5 deals CSV — the real sample fixture. 8 deals → 4 round-trip trades.
// ---------------------------------------------------------------------------
test('MT5 deals CSV groups deals into round-trip trades by position', () => {
  const buffer = fs.readFileSync(path.join(samplesDir, 'mt5_deals_sample.csv'));
  const { trades, dealCount } = parseImport(buffer, {
    filename: 'mt5_deals_sample.csv',
    accountId: 1,
  });
  assert.equal(dealCount, 8);
  assert.equal(trades.length, 4);

  const t = [...trades].sort(byTime);
  // Position 9001: XAUUSD long, +142.50 gross, -7.00 commission => 135.50 net.
  assert.equal(t[0].instrument, 'XAUUSD');
  assert.equal(t[0].direction, 'long');
  assert.equal(t[0].size, 0.5);
  assert.ok(Math.abs(t[0].gross_pnl - 142.5) < 1e-9);
  assert.ok(Math.abs(t[0].commission - 7.0) < 1e-9);
  assert.ok(Math.abs(t[0].net_pnl - 135.5) < 1e-9);
  assert.equal(t[0].ext_id, '9001');

  // Position 9003: XAUUSD long (deal 105 is a buy 'in'), -54 gross,
  // -4.20 comm, -0.50 swap => -58.70 net.
  const p9003 = trades.find((x) => x.ext_id === '9003');
  assert.equal(p9003.direction, 'long');
  assert.ok(Math.abs(p9003.net_pnl - -58.7) < 1e-9);

  // Every trade carries an entry, an exit and a session bucket.
  for (const tr of trades) {
    assert.ok(tr.entry_time && tr.exit_time);
    assert.ok(tr.hold_time_sec > 0);
    assert.ok(tr.session);
  }
});

test('re-parsing the same deals yields stable ext_ids (dedupe key is stable)', () => {
  const buffer = fs.readFileSync(path.join(samplesDir, 'mt5_deals_sample.csv'));
  const a = parseImport(buffer, { filename: 'a.csv', accountId: 1 });
  const b = parseImport(buffer, { filename: 'a.csv', accountId: 1 });
  const ids = (r) => r.trades.map((t) => t.ext_id).sort();
  assert.deepEqual(ids(a), ids(b));
  // These ext_ids drive the (account_id, ext_id) unique index that dedupes.
  assert.deepEqual(ids(a), ['9001', '9002', '9003', '9004']);
});

// ---------------------------------------------------------------------------
// Partial fills / scale-out — deals with no Position column net by symbol.
// One entry (1.0) scaled out in two 0.5 exits => a SINGLE trade.
// ---------------------------------------------------------------------------
test('scale-out partial exits collapse into one trade (netting fallback)', () => {
  const csv = [
    'Time,Deal,Symbol,Type,Direction,Volume,Price,Order,Commission,Fee,Swap,Profit',
    '2026.07.21 07:00:00,201,XAUUSD,buy,in,1.00,2400.00,301,-4.00,0,0,0.00',
    '2026.07.21 07:30:00,202,XAUUSD,sell,out,0.50,2410.00,302,-2.00,0,0,50.00',
    '2026.07.21 08:00:00,203,XAUUSD,sell,out,0.50,2420.00,303,-2.00,0,0,100.00',
  ].join('\n');
  const { trades } = parseImport(buf(csv), { filename: 'deals.csv', accountId: 1 });
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.direction, 'long');
  assert.equal(t.size, 1.0);
  // Weighted-avg exit of two equal-size fills = (2410+2420)/2 = 2415.
  assert.ok(Math.abs(t.exit_price - 2415) < 1e-9);
  // gross 150, commission |−4−2−2| = 8 => net 142.
  assert.ok(Math.abs(t.gross_pnl - 150) < 1e-9);
  assert.ok(Math.abs(t.net_pnl - 142) < 1e-9);
  // Three executions recorded (1 in, 2 out).
  assert.equal(t._executions.length, 3);
  assert.equal(t._executions.filter((e) => e.side === 'out').length, 2);
});

test('weighted-average entry across two scale-in fills', () => {
  const csv = [
    'Time,Deal,Symbol,Type,Direction,Volume,Price,Order,Position,Commission,Fee,Swap,Profit',
    '2026.07.21 07:00:00,301,US100,buy,in,1.00,20000.00,401,7001,-2,0,0,0',
    '2026.07.21 07:05:00,302,US100,buy,in,3.00,20040.00,402,7001,-6,0,0,0',
    '2026.07.21 07:40:00,303,US100,sell,out,4.00,20100.00,403,7001,-8,0,0,300',
  ].join('\n');
  const { trades } = parseImport(buf(csv), { filename: 'deals.csv', accountId: 1 });
  assert.equal(trades.length, 1);
  // (1*20000 + 3*20040)/4 = 20030.
  assert.ok(Math.abs(trades[0].entry_price - 20030) < 1e-9);
  assert.equal(trades[0].size, 4);
});

// ---------------------------------------------------------------------------
// Match-Trader closed positions export — a different header/shape entirely.
// ---------------------------------------------------------------------------
test('Match-Trader closed positions parse with stop/target and net P&L', () => {
  const csv = [
    'ID,Symbol,Side,Open Time,Close Time,Volume,Open Price,Close Price,Stop Loss,Take Profit,Commission,Swap,Profit',
    'MT100,XAUUSD,BUY,2026-07-21 07:00:00,2026-07-21 07:45:00,0.50,2400.00,2410.00,2395.00,2415.00,3.00,0.00,500.00',
  ].join('\n');
  const { trades } = parseImport(buf(csv), { filename: 'mt.csv', accountId: 1 });
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.ext_id, 'MT100');
  assert.equal(t.direction, 'long');
  assert.equal(t.stop_price, 2395);
  assert.equal(t.target_price, 2415);
  // net = gross 500 - commission 3 + swap 0 = 497.
  assert.ok(Math.abs(t.net_pnl - 497) < 1e-9);
  // Stop 5 below entry with a +10 move at $/pt from gross => a real R value.
  assert.ok(t.r_multiple != null && t.r_multiple > 0);
});

// ---------------------------------------------------------------------------
// SpreadsheetML (.xml) and HTML extraction reach the same deal rows as CSV.
// ---------------------------------------------------------------------------
test('SpreadsheetML XML extracts the same deal rows as CSV', () => {
  const rowXml = (cells) =>
    '<Row>' + cells.map((c) => `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join('') + '</Row>';
  const xml =
    '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table>' +
    rowXml(['Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order', 'Position', 'Commission', 'Fee', 'Swap', 'Profit']) +
    rowXml(['2026.07.21 07:00:00', '401', 'XAUUSD', 'buy', 'in', '0.50', '2400.00', '501', '8001', '-3', '0', '0', '0']) +
    rowXml(['2026.07.21 07:30:00', '402', 'XAUUSD', 'sell', 'out', '0.50', '2410.00', '502', '8001', '-3', '0', '0', '250']) +
    '</Table></Worksheet></Workbook>';
  const rows = extractRows(buf(xml), 'stmt.xml', '');
  assert.ok(rows.length >= 3);
  const { trades } = parseImport(buf(xml), { filename: 'stmt.xml', accountId: 1 });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].ext_id, '8001');
  assert.ok(Math.abs(trades[0].net_pnl - 244) < 1e-9); // 250 - 6 comm
});

test('MT5 HTML statement Deals table is parsed', () => {
  const tr = (cells, tag = 'td') =>
    '<tr>' + cells.map((c) => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
  const html =
    '<html><body><table>' +
    tr(['Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order', 'Position', 'Commission', 'Fee', 'Swap', 'Profit'], 'th') +
    tr(['2026.07.21 07:00:00', '501', 'US100', 'sell', 'in', '1.00', '20100.00', '601', '9101', '-2', '0', '0', '0']) +
    tr(['2026.07.21 07:20:00', '502', 'US100', 'buy', 'out', '1.00', '20080.00', '602', '9101', '-2', '0', '0', '200']) +
    '</table></body></html>';
  const { trades } = parseImport(buf(html), { filename: 'stmt.html', accountId: 1 });
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.instrument, 'US100');
  assert.equal(t.direction, 'short');
  assert.equal(t.source, 'html');
  assert.ok(Math.abs(t.net_pnl - 196) < 1e-9); // 200 - 4 comm
});
