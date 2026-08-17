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

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'icons')
const WIDTH = 1200
const HEIGHT = 240

/**
 * Slate navy, barely graded.
 *
 * This was a deep blue into navy, which is a lot of colour for something sitting above
 * four white rows — the band won the card. A near-flat dark slate lets the greeting be
 * the loud thing instead, and white text has more contrast on it than it had on the
 * light end of the blue.
 *
 * Not flat, though: two shades a few points apart, so the band has some depth rather
 * than reading as a printed rectangle. The difference is small enough that a phone
 * scaling the image cannot band it.
 */
const FROM = [0x1b, 0x28, 0x3a]
const TO = [0x0e, 0x17, 0x25]

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

/**
 * The tile fill.
 *
 * Teams decides what `Container.style` looks like and will not take an override, so a
 * background image is the only way to colour a tile. A soft blue wash rather than the
 * host's flat grey, with a barely-there vertical gradient so a tile has some depth
 * instead of reading as a printed box.
 */
const TILE_TOP = [0xf7, 0xfa, 0xff]
const TILE_BOTTOM = [0xea, 0xf2, 0xff]

writeFileSync(
  join(OUT, 'tile.png'),
  pngRect(8, 96, (_x, y) => {
    const t = y / 96
    return [
      Math.round(TILE_TOP[0] + (TILE_BOTTOM[0] - TILE_TOP[0]) * t),
      Math.round(TILE_TOP[1] + (TILE_BOTTOM[1] - TILE_TOP[1]) * t),
      Math.round(TILE_TOP[2] + (TILE_BOTTOM[2] - TILE_TOP[2]) * t),
      255,
    ]
  }),
)
console.log('wrote tile.png (8x96)')
