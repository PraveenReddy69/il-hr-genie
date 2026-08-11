/**
 * A minimal RGBA PNG writer.
 *
 * Here because there is no image tooling in this environment and the icons have to
 * come from somewhere. No filtering and a single IDAT — the images are tiny, so
 * anything cleverer would be effort spent on nothing.
 */

import { deflateSync } from 'node:zlib'

/**
 * @param size  square edge in pixels
 * @param pixel (x, y, size) => [r, g, b, a], sampled at pixel centres
 */
export function png(size, pixel) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size)
      const at = y * stride + 1 + x * 4
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
      raw[at + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Blends `over` onto `under` by alpha.
 *
 * Shapes are drawn as coverage in 0..1 rather than hard tests, which is the whole
 * reason these read as curves rather than staircases at 64px.
 */
export function blend(under, over, coverage) {
  if (coverage <= 0) return under
  const a = Math.min(1, coverage)
  return [
    Math.round(under[0] * (1 - a) + over[0] * a),
    Math.round(under[1] * (1 - a) + over[1] * a),
    Math.round(under[2] * (1 - a) + over[2] * a),
    Math.round(under[3] * (1 - a) + 255 * a),
  ]
}

/** Antialiased coverage for a disc: 1 inside, 0 outside, a soft pixel at the edge. */
export function disc(x, y, cx, cy, radius) {
  const distance = Math.hypot(x - cx, y - cy)
  return clamp(radius + 0.5 - distance)
}

/** Antialiased coverage for an axis-aligned rectangle with optional corner radius. */
export function rect(x, y, left, top, right, bottom, radius = 0) {
  if (radius <= 0) {
    return clamp(Math.min(x - left, right - x) + 0.5) * clamp(Math.min(y - top, bottom - y) + 0.5)
  }
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const distance = Math.hypot(x - cx, y - cy)
  const inside = clamp(Math.min(x - left, right - x) + 0.5) * clamp(Math.min(y - top, bottom - y) + 0.5)
  return Math.min(inside, clamp(radius + 0.5 - distance))
}

/** Antialiased coverage for a thick line segment, so glyphs can have strokes. */
export function segment(x, y, x1, y1, x2, y2, width) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / lengthSquared))
  const distance = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
  return clamp(width / 2 + 0.5 - distance)
}

function clamp(value) {
  return Math.min(1, Math.max(0, value))
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}
