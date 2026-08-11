/**
 * The gradient behind a card header.
 *
 * Adaptive Cards has no gradient of its own — `backgroundImage` on a container is the
 * only way to get one, and it must be an https URL, so this ships with the console on
 * GitHub Pages like the glyphs do.
 *
 * Wide and short, because Teams stretches it to the container: at 1200×240 it stays
 * smooth on a desktop card and costs a couple of kilobytes.
 *
 *     node scripts/make-header.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pngRect } from './png.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'public', 'icons')
const WIDTH = 1200
const HEIGHT = 240

/** The app's header gradient: brand blue into the deep navy the phone header uses. */
const FROM = [0x2b, 0x8c, 0xff]
const TO = [0x12, 0x30, 0x6e]

mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, 'header.png'),
  pngRect(WIDTH, HEIGHT, (x, y) => {
    // Diagonal, so the band has some direction rather than reading as a flat fill.
    const t = Math.min(1, Math.max(0, (x / WIDTH) * 0.85 + (y / HEIGHT) * 0.15))
    return [
      Math.round(FROM[0] + (TO[0] - FROM[0]) * t),
      Math.round(FROM[1] + (TO[1] - FROM[1]) * t),
      Math.round(FROM[2] + (TO[2] - FROM[2]) * t),
      255,
    ]
  }),
)
console.log(`wrote header.png (${WIDTH}x${HEIGHT})`)
