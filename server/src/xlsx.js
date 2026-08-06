// Minimal, dependency-free reader for MT5 "Open XML (MS Office)" exports (.xlsx).
// An .xlsx is a ZIP of XML parts. We read the central directory, inflate the
// worksheet + sharedStrings parts, and return a 2-D array of cell strings that
// the import parser treats exactly like CSV/HTML rows.
import zlib from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// True when the buffer starts with the ZIP local-file-header signature ("PK\x03\x04").
export function isZip(buffer) {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === SIG_LOCAL;
}

// Decode an inflated XML part to text, honouring a UTF-16 BOM. MetaTrader 5's
// .xlsx export writes its parts (sheetN.xml, sharedStrings.xml) as UTF-16LE with
// an FF FE BOM; reading those as UTF-8 yields NUL-interleaved garbage that no
// regex matches, so the sheet parses to zero rows. Real Excel writes UTF-8.
function xmlText(buf) {
  if (!buf) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe)
    return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16(); // UTF-16BE → LE
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // last, so we don't double-decode
}

// Parse the ZIP central directory into { name -> {method, compSize, localOffset} }.
function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('invalid xlsx (no ZIP end-of-central-directory)');
  const cdCount = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const entries = {};
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buffer.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    entries[name] = { method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { buffer, entries };
}

// Inflate (or copy) one entry's bytes to a Buffer.
function readEntry(zip, name) {
  const e = zip.entries[name];
  if (!e) return null;
  const b = zip.buffer;
  const o = e.localOffset;
  if (b.readUInt32LE(o) !== SIG_LOCAL) throw new Error('invalid xlsx (bad local header)');
  const nameLen = b.readUInt16LE(o + 26);
  const extraLen = b.readUInt16LE(o + 28);
  const start = o + 30 + nameLen + extraLen;
  const comp = b.subarray(start, start + e.compSize);
  if (e.method === 0) return comp; // stored
  if (e.method === 8) return zlib.inflateRawSync(comp); // deflate
  throw new Error(`invalid xlsx (unsupported compression ${e.method})`);
}

function parseSharedStrings(buf) {
  if (!buf) return [];
  const xml = xmlText(buf);
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m;
  while ((m = siRe.exec(xml))) {
    const parts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tm;
    while ((tm = tRe.exec(m[1]))) parts.push(decodeEntities(tm[1]));
    out.push(parts.join(''));
  }
  return out;
}

// "B" -> 1, "AA" -> 26 (0-based column index) from a cell ref like "AB12".
function colToIdx(ref) {
  const m = /^([A-Z]+)/i.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    let cm;
    let auto = 0;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const refM = /r="([A-Za-z]+\d+)"/.exec(attrs);
      const idx = refM ? colToIdx(refM[1]) : auto;
      auto = idx + 1;
      const typeM = /t="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : 'n';
      let val = '';
      if (type === 's') {
        const vM = /<v>([\s\S]*?)<\/v>/i.exec(body);
        val = vM ? (shared[Number(vM[1])] ?? '') : '';
      } else if (type === 'inlineStr' || type === 'str') {
        const tM = /<t\b[^>]*>([\s\S]*?)<\/t>/i.exec(body) || /<v>([\s\S]*?)<\/v>/i.exec(body);
        val = tM ? decodeEntities(tM[1]) : '';
      } else {
        const vM = /<v>([\s\S]*?)<\/v>/i.exec(body);
        val = vM ? decodeEntities(vM[1]) : '';
      }
      cells[idx] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// Public: xlsx Buffer -> array of rows (each row = array of cell strings).
export function parseXlsx(buffer) {
  const zip = readZip(buffer);
  const shared = parseSharedStrings(readEntry(zip, 'xl/sharedStrings.xml'));
  const sheetName = Object.keys(zip.entries)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort()[0];
  if (!sheetName) throw new Error('invalid xlsx (no worksheet)');
  const sheetXml = xmlText(readEntry(zip, sheetName));
  return parseSheet(sheetXml, shared);
}
