import { parse as parseHtml } from 'node-html-parser';
import {
  parseMt5Time,
  parseFlexibleTime,
  sessionFromTime,
  normalizeInstrument,
  computeRMultiple,
} from './util.js';
import { parseXlsx, isZip } from './xlsx.js';

// ---------- Low-level CSV parsing ----------
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// ---------- Header mapping ----------
const HEADER_ALIASES = {
  time: ['time', 'open time', 'close time', 'date'],
  deal: ['deal'],
  symbol: ['symbol'],
  type: ['type'],
  direction: ['direction'],
  volume: ['volume', 'size', 'lots'],
  price: ['price'],
  order: ['order'],
  position: ['position'],
  commission: ['commission'],
  fee: ['fee'],
  swap: ['swap'],
  profit: ['profit'],
  comment: ['comment'],
};

function buildHeaderMap(headerCells) {
  const norm = headerCells.map((h) => String(h).trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < norm.length; i++) {
      if (aliases.includes(norm[i]) && map[key] === undefined) {
        map[key] = i;
        break;
      }
    }
  }
  return map;
}

// Loose match: any table row that could be a deals/positions header.
function looksLikeHeader(cells) {
  const norm = cells.map((c) => String(c).trim().toLowerCase());
  return norm.includes('symbol') && norm.includes('profit');
}

function normalizedHeader(cells) {
  return cells.map((c) => String(c).trim().toLowerCase());
}

// Match-Trader closed positions export:
// ID,Symbol,Open Time,Volume,Side,Close Time,Open Price,Close Price,...
function looksLikeMatchTraderClosedHeader(cells) {
  const norm = normalizedHeader(cells);
  return (
    norm.includes('id') &&
    norm.includes('symbol') &&
    norm.includes('side') &&
    norm.includes('open time') &&
    norm.includes('close time') &&
    norm.includes('open price') &&
    norm.includes('close price') &&
    norm.includes('profit')
  );
}

// Strict match for the MT5 *Deals* header specifically. A full MT5 statement
// contains Positions, Orders and Deals sections; the Positions header also has
// "symbol"+"profit", so we must single out Deals by its "deal"/"direction"
// columns — otherwise rows get mapped against the wrong columns.
function looksLikeDealsHeader(cells) {
  const norm = cells.map((c) => String(c).trim().toLowerCase());
  return (
    norm.includes('symbol') &&
    (norm.includes('deal') || norm.includes('direction'))
  );
}

// The Positions section header — carries Stop-Loss (S/L) and Take-Profit (T/P),
// which the Deals section does not. Identified by "Position" + an "S/L"/"T/P".
function looksLikePositionsHeader(cells) {
  const norm = cells.map((c) => String(c).trim().toLowerCase().replace(/\s/g, ''));
  return (
    norm.includes('position') &&
    norm.includes('symbol') &&
    (norm.includes('s/l') || norm.includes('t/p'))
  );
}

// Extract a map: position id -> { stop_price, target_price } from the Positions
// section (present in full MT5 statements — HTML and XLSX). Returns empty for
// deals-only exports. Position id equals the opening order id, so trades built
// from the Deals section can be matched by their entry deal's order.
//
// Column mapping can't rely on the header: MT5 Positions *data* rows carry a
// hidden colspan cell (and a colspan Profit) that the header row lacks, which
// shifts every index. Instead we anchor on the buy/sell "Type" cell — after it
// (skipping the hidden blank) the numeric run is fixed:
//   Volume, EntryPrice, S/L, T/P, ExitTime, ExitPrice, Commission, Swap, Profit
function rowsToPositions(rows) {
  const hIdx = rows.findIndex(looksLikePositionsHeader);
  if (hIdx === -1) return new Map();
  const map = new Map();
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    // stop at the next section (Orders / Deals / Results headers).
    if (looksLikeDealsHeader(r) || looksLikePositionsHeader(r)) break;
    const first = String(r[0] ?? '').trim().toLowerCase();
    if (['orders', 'deals', 'results'].includes(first)) break;

    const typeIdx = r.findIndex((c) => /^(buy|sell)$/i.test(String(c).trim()));
    if (typeIdx === -1) continue; // spacer / summary row
    // Position id = the large numeric cell just before Type (e.g. 33398031).
    let pos = '';
    for (let k = typeIdx - 1; k >= 0; k--) {
      const v = String(r[k] ?? '').trim();
      if (/^\d{5,}$/.test(v)) {
        pos = v;
        break;
      }
    }
    if (!pos) continue;
    // Skip the hidden blank cell(s), then read the numeric run.
    let j = typeIdx + 1;
    while (j < r.length && String(r[j]).trim() === '') j++;
    // j → Volume, j+1 → EntryPrice, j+2 → S/L, j+3 → T/P
    const sl = num(r[j + 2]);
    const tp = num(r[j + 3]);
    map.set(pos, {
      stop_price: sl > 0 ? sl : null,
      target_price: tp > 0 ? tp : null,
    });
  }
  return map;
}

function num(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v).replace(/\s/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function weightedAverage(items, valueKey, weightKey = 'volume') {
  const volume = items.reduce((s, item) => s + num(item[weightKey]), 0);
  if (!volume) return items.length ? num(items[0][valueKey]) : 0;
  return (
    items.reduce((s, item) => s + num(item[valueKey]) * num(item[weightKey]), 0) /
    volume
  );
}

function firstPositive(items, key) {
  const item = items.find((r) => num(r[key]) > 0);
  return item ? num(item[key]) : null;
}

function buildColumnGetter(headerCells) {
  const header = normalizedHeader(headerCells);
  const index = new Map(header.map((h, i) => [h, i]));
  return (row, name) => row[index.get(name)];
}

function rowsToMatchTraderTrades(rows, accountId, source) {
  const headerIdx = rows.findIndex(looksLikeMatchTraderClosedHeader);
  if (headerIdx === -1) return [];

  const get = buildColumnGetter(rows[headerIdx]);
  const byId = new Map();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const id = String(get(r, 'id') ?? '').trim();
    const symbol = String(get(r, 'symbol') ?? '').trim();
    const side = String(get(r, 'side') ?? '').trim().toLowerCase();
    const openTime = parseFlexibleTime(get(r, 'open time'));
    const closeTime = parseFlexibleTime(get(r, 'close time'));
    if (!id || !symbol || !side || !openTime || !closeTime) continue;

    const item = {
      id,
      symbol,
      side,
      openTime,
      closeTime,
      volume: num(get(r, 'volume')),
      openPrice: num(get(r, 'open price')),
      closePrice: num(get(r, 'close price')),
      stopLoss: num(get(r, 'stop loss')),
      takeProfit: num(get(r, 'take profit')),
      swap: num(get(r, 'swap')),
      commission: num(get(r, 'commission')),
      profit: num(get(r, 'profit')),
    };

    if (!item.volume || !item.openPrice || !item.closePrice) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(item);
  }

  const trades = [];
  for (const [id, rowsForTrade] of byId) {
    const sorted = [...rowsForTrade].sort((a, b) =>
      a.closeTime.localeCompare(b.closeTime)
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const entry_time = sorted.reduce(
      (min, row) => (row.openTime < min ? row.openTime : min),
      first.openTime
    );
    const exit_time = last.closeTime;
    const entry_price = weightedAverage(sorted, 'openPrice');
    const exit_price = weightedAverage(sorted, 'closePrice');
    const size = sorted.reduce((s, row) => s + row.volume, 0);
    const gross_pnl = sorted.reduce((s, row) => s + row.profit, 0);
    const commission = Math.abs(sorted.reduce((s, row) => s + row.commission, 0));
    const swap = sorted.reduce((s, row) => s + row.swap, 0);
    const net_pnl = gross_pnl - commission + swap;
    const stop_price = firstPositive(sorted, 'stopLoss');
    const target_price = firstPositive(sorted, 'takeProfit');
    const hold_time_sec = Math.max(
      0,
      Math.round(
        (new Date(exit_time).getTime() - new Date(entry_time).getTime()) / 1000
      )
    );

    trades.push({
      account_id: accountId,
      instrument: normalizeInstrument(first.symbol),
      direction: first.side === 'buy' ? 'long' : 'short',
      entry_time,
      exit_time,
      entry_price,
      exit_price,
      size,
      gross_pnl,
      commission,
      swap,
      net_pnl,
      r_multiple: computeRMultiple({
        entry_price,
        exit_price,
        stop_price,
        size,
        gross_pnl,
        net_pnl,
      }),
      stop_price,
      target_price,
      mae: null,
      mfe: null,
      hold_time_sec,
      session: sessionFromTime(entry_time),
      source,
      ext_id: id,
      _executions: [
        {
          exec_time: entry_time,
          price: entry_price,
          size,
          side: 'in',
          profit: 0,
          commission: null,
          swap: null,
        },
        ...sorted.map((row) => ({
          exec_time: row.closeTime,
          price: row.closePrice,
          size: row.volume,
          side: 'out',
          profit: row.profit,
          commission: Math.abs(row.commission),
          swap: row.swap,
        })),
      ],
    });
  }

  return trades;
}

// Turn an array-of-rows (each row = array of cell strings) into deal objects.
function rowsToDeals(rows) {
  // find header row — prefer the Deals header (has deal/direction columns),
  // fall back to any symbol+profit header for simpler CSV exports.
  let headerIdx = rows.findIndex(looksLikeDealsHeader);
  if (headerIdx === -1) headerIdx = rows.findIndex(looksLikeHeader);
  if (headerIdx === -1) return [];
  const map = buildHeaderMap(rows[headerIdx]);
  const deals = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k) => (map[k] !== undefined ? r[map[k]] : undefined);
    const symbol = (get('symbol') || '').toString().trim();
    const timeRaw = (get('time') || '').toString().trim();
    if (!symbol || !timeRaw) continue; // skip summary / blank rows
    const time = parseMt5Time(timeRaw);
    if (!time) continue;
    const typeRaw = (get('type') || '').toString().trim().toLowerCase();
    let dir = (get('direction') || '').toString().trim().toLowerCase();
    // Direction column holds in/out. Fall back: infer nothing here.
    if (dir !== 'in' && dir !== 'out') dir = '';
    deals.push({
      time,
      deal: (get('deal') || '').toString().trim(),
      symbol,
      type: typeRaw, // buy | sell
      direction: dir, // in | out (may be '')
      volume: num(get('volume')),
      price: num(get('price')),
      order: (get('order') || '').toString().trim(),
      position: (get('position') || '').toString().trim(),
      commission: num(get('commission')),
      fee: num(get('fee')),
      swap: num(get('swap')),
      profit: num(get('profit')),
      comment: (get('comment') || '').toString().trim(),
    });
  }
  return deals;
}

// Decode an upload's bytes to text, honouring the BOM. MetaTrader 5 HTML
// reports are UTF-16LE (BOM FF FE); CSV/XML exports are usually UTF-8. Reading
// UTF-16 as UTF-8 yields NUL-interleaved garbage and silently parses 0 rows.
function bufferToText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16(); // UTF-16BE → LE
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return buffer.subarray(3).toString('utf8');
  // No BOM: sniff for UTF-16LE (many NUL bytes in the head).
  const n = Math.min(buffer.length, 400);
  let nulls = 0;
  for (let i = 0; i < n; i++) if (buffer[i] === 0) nulls++;
  if (n && nulls > n / 4) return buffer.toString('utf16le');
  return buffer.toString('utf8');
}

// Which underlying format is this upload? (used for extraction + source tag)
function detectFormat(buffer, filename = '', mimetype = '') {
  if (isZip(buffer) || /\.xlsx$/i.test(filename) ||
      /spreadsheetml|officedocument/i.test(mimetype)) {
    return 'xlsx';
  }
  const head = bufferToText(buffer).slice(0, 400);
  if (
    /\.xml$/i.test(filename) ||
    (/^\s*<\?xml/i.test(head) &&
      /urn:schemas-microsoft-com:office:spreadsheet|<Workbook/i.test(head))
  ) {
    return 'xml';
  }
  if (
    /\.html?$/i.test(filename) ||
    /html/i.test(mimetype) ||
    /^\s*</.test(head)
  ) {
    return 'html';
  }
  return 'csv';
}

// Decode the small set of XML entities that appear in SpreadsheetML data cells.
function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// Parse SpreadsheetML 2003 (.xml) — <Row><Cell><Data>value</Data></Cell></Row>,
// honouring ss:Index gaps — into an array-of-rows of cell strings.
function spreadsheetMlToRows(xml) {
  const rows = [];
  const rowRe = /<(?:\w+:)?Row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Row>/gi;
  const cellRe = /<(?:\w+:)?Cell\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?Cell>)/gi;
  const dataRe = /<(?:\w+:)?Data\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Data>/i;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    let col = 0;
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[1]))) {
      const idxM = /ss:Index="(\d+)"/i.exec(cm[1] || '');
      if (idxM) col = Number(idxM[1]) - 1;
      const dm = dataRe.exec(cm[2] || '');
      cells[col] = dm ? decodeXmlEntities(dm[1]) : '';
      col++;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// ---------- Extract raw rows from CSV / HTML / XML / XLSX ----------
export function extractRows(buffer, filename = '', mimetype = '') {
  const fmt = detectFormat(buffer, filename, mimetype);
  if (fmt === 'xlsx') return parseXlsx(buffer);
  const text = bufferToText(buffer);
  if (fmt === 'xml') return spreadsheetMlToRows(text);
  if (fmt === 'html') return htmlToRows(text);
  return parseCsv(text);
}

function htmlToRows(html) {
  const root = parseHtml(html);
  const tables = root.querySelectorAll('table');
  let best = [];
  let bestScore = 0;
  for (const table of tables) {
    const trs = table.querySelectorAll('tr');
    const rows = trs.map((tr) =>
      tr.querySelectorAll('th,td').map((td) => td.text.trim())
    );
    // Prefer a table holding the Deals header (score 2) over a generic
    // symbol+profit header (score 1); break ties by row count.
    const score = rows.some(looksLikeDealsHeader)
      ? 2
      : rows.some(looksLikeHeader)
        ? 1
        : 0;
    if (score > bestScore || (score === bestScore && rows.length > best.length)) {
      if (score > 0) {
        best = rows;
        bestScore = score;
      }
    }
  }
  if (best.length) return best;
  // fallback: flatten every row across all tables
  const all = [];
  for (const table of tables) {
    for (const tr of table.querySelectorAll('tr')) {
      all.push(tr.querySelectorAll('th,td').map((td) => td.text.trim()));
    }
  }
  return all;
}

// ---------- Group deals into round-trip trades ----------
function inferSide(deal, seenForPosition) {
  if (deal.direction === 'in' || deal.direction === 'out') return deal.direction;
  // fallback: first deal of a position is 'in', rest 'out'
  return seenForPosition ? 'out' : 'in';
}

function buildTrade(accountId, deals, extId, source, positions) {
  const ins = deals.filter((d) => d._side === 'in');
  const outs = deals.filter((d) => d._side === 'out');
  const entryDeals = ins.length ? ins : deals.slice(0, 1);
  const exitDeals = outs.length ? outs : deals.slice(1);

  const sumVol = (arr) => arr.reduce((s, d) => s + d.volume, 0);
  const wavgPrice = (arr) => {
    const v = sumVol(arr);
    if (!v) return arr.length ? arr[0].price : 0;
    return arr.reduce((s, d) => s + d.price * d.volume, 0) / v;
  };

  const entrySorted = [...entryDeals].sort((a, b) => a.time.localeCompare(b.time));
  const exitSorted = [...exitDeals].sort((a, b) => a.time.localeCompare(b.time));

  const firstIn = entrySorted[0];
  const lastOut = exitSorted[exitSorted.length - 1] || firstIn;

  const direction = firstIn && firstIn.type === 'buy' ? 'long' : 'short';
  const entry_time = firstIn ? firstIn.time : null;
  const exit_time = lastOut ? lastOut.time : null;
  const entry_price = wavgPrice(entryDeals);
  const exit_price = wavgPrice(exitDeals.length ? exitDeals : entryDeals);
  const size = sumVol(entryDeals);

  const gross_pnl = deals.reduce((s, d) => s + d.profit, 0);
  const commission = Math.abs(
    deals.reduce((s, d) => s + d.commission + d.fee, 0)
  );
  const swap = deals.reduce((s, d) => s + d.swap, 0);
  const net_pnl = gross_pnl - commission + swap;

  const hold_time_sec =
    entry_time && exit_time
      ? Math.max(
          0,
          Math.round(
            (new Date(exit_time).getTime() - new Date(entry_time).getTime()) /
              1000
          )
        )
      : null;

  // Stop/target come from the Positions section. Position id == opening order id,
  // so match on the entry deal's order (or its position id if the deals carry one).
  const posInfo =
    positions && firstIn
      ? positions.get(String(firstIn.position)) ||
        positions.get(String(firstIn.order))
      : null;
  let stop_price = posInfo ? posInfo.stop_price : null;
  let target_price = posInfo ? posInfo.target_price : null;
  // MT5 reports only the FINAL S/L (and T/P) — typically a trailing/breakeven
  // stop dragged into profit while managing the trade, NOT the original risk
  // stop, which the statement doesn't retain. A protective stop must sit on the
  // loss side of entry (below for a long, above for a short); anything on the
  // profit side is a trail, so drop it rather than mislabel it as the original.
  if (stop_price != null) {
    const valid =
      direction === 'long' ? stop_price < entry_price : stop_price > entry_price;
    if (!valid) stop_price = null;
  }
  if (target_price != null) {
    const valid =
      direction === 'long'
        ? target_price > entry_price
        : target_price < entry_price;
    if (!valid) target_price = null;
  }
  const r_multiple = computeRMultiple({
    entry_price,
    exit_price,
    stop_price,
    size,
    gross_pnl,
    net_pnl,
  });

  return {
    account_id: accountId,
    instrument: normalizeInstrument(firstIn ? firstIn.symbol : deals[0].symbol),
    direction,
    entry_time,
    exit_time,
    entry_price,
    exit_price,
    size,
    gross_pnl,
    commission,
    swap,
    net_pnl,
    r_multiple,
    stop_price,
    target_price,
    mae: null,
    mfe: null,
    hold_time_sec,
    session: sessionFromTime(entry_time),
    source,
    ext_id: extId,
    _executions: deals.map((d) => ({
      exec_time: d.time,
      price: d.price,
      size: d.volume,
      side: d._side,
      profit: d.profit,
      commission: Math.abs(d.commission + d.fee),
      swap: d.swap,
    })),
  };
}

function groupDeals(accountId, deals, source, positions) {
  const trades = [];
  const withPosition = deals.filter((d) => d.position);
  const withoutPosition = deals.filter((d) => !d.position);

  // Group by Position id
  const byPos = new Map();
  for (const d of withPosition) {
    if (!byPos.has(d.position)) byPos.set(d.position, []);
    byPos.get(d.position).push(d);
  }
  for (const [pos, group] of byPos) {
    const sorted = [...group].sort((a, b) => a.time.localeCompare(b.time));
    let seenIn = false;
    for (const d of sorted) {
      d._side = inferSide(d, seenIn);
      if (d._side === 'in') seenIn = true;
    }
    trades.push(buildTrade(accountId, sorted, String(pos), source, positions));
  }

  // Netting fallback for deals lacking a Position id (e.g. MT5 HTML statements,
  // whose Deals section carries no Position column — deals only reference the
  // Order that spawned them, and scale-out orders differ from the entry order).
  // Accumulate a position per symbol and only close it once the running volume
  // returns to flat, so multi-partial scale-outs stay in ONE trade instead of
  // the first exit closing it and the rest being dropped.
  const bySymbol = new Map();
  for (const d of withoutPosition) {
    const key = d.symbol;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key).push(d);
  }
  const flushOpen = (open) => {
    if (open.length)
      trades.push(
        buildTrade(accountId, open, open[0].deal || open[0].time, source, positions)
      );
  };
  for (const [, arr] of bySymbol) {
    const sorted = [...arr].sort((a, b) => a.time.localeCompare(b.time));
    let open = [];
    let openVol = 0;
    for (const d of sorted) {
      const side = inferSide(d, open.length > 0);
      d._side = side;
      open.push(d);
      openVol += side === 'in' ? d.volume : -d.volume;
      // Flat again → the round-trip is complete; emit and reset.
      if (Math.abs(openVol) < 1e-6) {
        flushOpen(open);
        open = [];
        openVol = 0;
      }
    }
    flushOpen(open); // leftover still-open position, if any
  }

  return trades;
}

// ---------- Public entry point ----------
export function parseImport(buffer, { filename, mimetype, accountId }) {
  const fmt = detectFormat(buffer, filename, mimetype);
  // trades.source only allows csv|html|ea|api — map spreadsheet formats to csv.
  const source = fmt === 'html' ? 'html' : 'csv';
  const rows = extractRows(buffer, filename, mimetype);
  const matchTraderTrades = rowsToMatchTraderTrades(rows, accountId, source);
  if (matchTraderTrades.length) {
    return { trades: matchTraderTrades, dealCount: matchTraderTrades.length };
  }
  const deals = rowsToDeals(rows);
  const positions = rowsToPositions(rows); // stop/target by position id
  const trades = groupDeals(accountId, deals, source, positions);
  return { trades, dealCount: deals.length };
}
