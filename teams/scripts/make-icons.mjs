/**
 * Writes the two icons a Teams app package must contain.
 *
 * Placeholders, drawn in code because there is no image tooling here and the manifest
 * will not validate without them: a 192×192 colour tile and a 32×32 transparent
 * outline. Both are geometry only — swap them for the real brand assets before this
 * goes anywhere near a person.
 *
 *     node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'appPackage')

/** Infinity Learn blue, the same one the apps use. */
const BRAND = [0x2b, 0x8c, 0xff]

/** A blue tile with a white speech bubble on it. */
function colourPixel(x, y, size) {
  const inBubble = bubble(x, y, size)
  if (inBubble) return [255, 255, 255, 255]
  return [...BRAND, 255]
}

/** The same bubble, white on nothing — Teams tints this itself. */
function outlinePixel(x, y, size) {
  return bubble(x, y, size) ? [255, 255, 255, 255] : [0, 0, 0, 0]
}

/**
 * A rounded rectangle with a tail at the bottom left.
 *
 * Everything is a fraction of the icon size so the same shape works at both, which is
 * the only reason one function can serve a 192px tile and a 32px glyph.
 */
function bubble(x, y, size) {
  const left = size * 0.2
  const right = size * 0.8
  const top = size * 0.22
  const bottom = size * 0.63
  const radius = size * 0.12

  if (roundedRect(x, y, left, top, right, bottom, radius)) return true

  // The tail: a wedge under the left of the body.
  const tailTop = bottom - size * 0.02
  const tailBottom = size * 0.8
  if (y < tailTop || y > tailBottom) return false
  const progress = (y - tailTop) / (tailBottom - tailTop)
  const tailLeft = size * 0.3
  const tailRight = tailLeft + size * 0.16 * (1 - progress)
  return x >= tailLeft && x <= tailRight
}

function roundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const nearLeft = x < left + radius
  const nearRight = x > right - radius
  const nearTop = y < top + radius
  const nearBottom = y > bottom - radius
  if (!((nearLeft || nearRight) && (nearTop || nearBottom))) return true

  const cx = nearLeft ? left + radius : right - radius
  const cy = nearTop ? top + radius : bottom - radius
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

/** A minimal RGBA PNG. No filtering, one IDAT — small images, no reason for more. */
function png(size, pixel) {
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

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'color.png'), png(192, colourPixel))
writeFileSync(join(OUT, 'outline.png'), png(32, outlinePixel))
console.log('wrote appPackage/color.png (192x192) and appPackage/outline.png (32x32)')
