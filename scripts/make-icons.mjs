/**
 * Generates the PNG app icons in ./public with no dependencies (pure Node: zlib + a tiny rasterizer).
 * Same artwork as public/icon.svg. Run: node scripts/make-icons.mjs
 *
 *  icon-192.png, icon-512.png   "any" purpose, rounded corners, transparent outside
 *  icon-maskable-512.png        full-bleed, content inside the 80% safe zone
 *  apple-touch-icon.png         180 px, full-bleed, opaque (iOS adds its own mask)
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [31, 111, 235];
const WHITE = [255, 255, 255];
const INK = [13, 17, 23];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
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

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
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

/**
 * Colour of a point in the 512x512 artwork space, or null (transparent).
 * `bleed` fills the whole square; `k` shrinks the content around the centre (maskable safe zone).
 */
function shade(x, y, { bleed, k }) {
  const inRounded = (px, py, x0, y0, x1, y1, r) => {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    const cx = Math.min(Math.max(px, x0 + r), x1 - r);
    const cy = Math.min(Math.max(py, y0 + r), y1 - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
  if (!bleed && !inRounded(x, y, 0, 0, 512, 512, 96)) return null;
  // Content coordinates (scaled around the centre).
  const u = 256 + (x - 256) / k;
  const v = 256 + (y - 256) / k;
  if (!inRounded(u, v, 116, 76, 396, 436, 16)) return BLUE;
  const dashed = (t) => (t % 30) < 18;
  if (Math.abs(u - 256) <= 4 && dashed(v - 76)) return BLUE;
  if (Math.abs(v - 256) <= 4 && dashed(u - 116)) return BLUE;
  const bar = (ox, oy) => {
    const widths = [8, 4, 10, 4, 8, 12];
    const offs = [0, 14, 24, 40, 50, 64];
    for (let i = 0; i < 6; i++) if (u >= ox + offs[i] && u < ox + offs[i] + widths[i] && v >= oy && v < oy + 60) return true;
    if (u >= ox && u < ox + 90 && v >= oy + 80 && v < oy + 90) return true;
    if (u >= ox && u < ox + 70 && v >= oy + 100 && v < oy + 110) return true;
    return false;
  };
  if (bar(140, 110) || bar(280, 290)) return INK;
  return WHITE;
}

function render(size, opts) {
  const ss = 4; // supersampling for anti-aliased edges
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade(((x + (sx + 0.5) / ss) * 512) / size, ((y + (sy + 0.5) / ss) * 512) / size, opts);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const o = (y * size + x) * 4;
      if (a) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePng(size, rgba);
}

const out = (name, png) => {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png);
  console.log(`public/${name}`);
};

out('icon-192.png', render(192, { bleed: false, k: 1 }));
out('icon-512.png', render(512, { bleed: false, k: 1 }));
out('icon-maskable-512.png', render(512, { bleed: true, k: 0.8 }));
out('apple-touch-icon.png', render(180, { bleed: true, k: 0.9 }));
