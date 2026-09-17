// Generates the PWA icons in web/public/icons/ using only Node built-ins
// (zlib for PNG deflate). Re-run after changing the design:
//   node web/scripts/gen-icons.mjs
//
// The glyph matches the favicon in index.html: an accent rounded square with a
// rising polyline. "any" icons put the square on a transparent-free dark tile;
// maskable icons keep the glyph inside the 80% safe zone on a full-bleed tile.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [5, 8, 10]; // --c-bg (dark theme)
const ACCENT = [245, 166, 35]; // --c-amber (dark theme)
const INK = [5, 8, 10];

// --- PNG encoding -----------------------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- shapes (unit square coordinates) ----------------------------------------
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * @param size  output px
 * @param inset glyph square as a fraction of the tile (smaller for maskable)
 * @param tileRadius corner radius of the background tile (0 = full bleed)
 */
function render(size, { inset, tileRadius }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling per axis
  const g0 = (1 - inset) / 2;
  const g1 = 1 - g0;
  const gs = g1 - g0;
  // Favicon polyline (16-unit grid): M3 11 l3-3 2 2 5-5
  const pts = [
    [3, 11],
    [6, 8],
    [8, 10],
    [13, 5],
  ].map(([x, y]) => [g0 + (x / 16) * gs, g0 + (y / 16) * gs]);
  const stroke = (1.9 / 16) * gs;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          let col = null;
          if (tileRadius === 0 || inRoundRect(x, y, 0, 0, 1, 1, tileRadius)) col = BG;
          if (inRoundRect(x, y, g0, g0, g1, g1, gs * (3 / 16))) col = ACCENT;
          let d = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            d = Math.min(d, distToSegment(x, y, ...pts[i], ...pts[i + 1]));
          }
          if (d <= stroke / 2) col = INK;
          if (col) {
            r += col[0];
            g += col[1];
            b += col[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      const cover = a / 255;
      buf[o] = cover ? Math.round(r / cover) : 0;
      buf[o + 1] = cover ? Math.round(g / cover) : 0;
      buf[o + 2] = cover ? Math.round(b / cover) : 0;
      buf[o + 3] = Math.round(a / n);
    }
  }
  return png(size, buf);
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192, { inset: 0.72, tileRadius: 0.2 }),
  'icon-512.png': render(512, { inset: 0.72, tileRadius: 0.2 }),
  'maskable-192.png': render(192, { inset: 0.56, tileRadius: 0 }),
  'maskable-512.png': render(512, { inset: 0.56, tileRadius: 0 }),
  // iOS ignores transparency and applies its own mask: full-bleed tile.
  'apple-touch-icon.png': render(180, { inset: 0.64, tileRadius: 0 }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`wrote ${name} (${data.length} bytes)`);
}
