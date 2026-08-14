/**
 * The HR Genie mascot, for the corner of the welcome card.
 *
 * Drawn rather than sourced, for the same reason as the glyphs: there is no image
 * tooling here. A white robot face on a soft blue halo — round head, two eyes, a
 * smile, and the ear pieces that make it read as a headset rather than a ball.
 *
 * Transparent outside the halo so it sits on the header gradient without a seam.
 *
 *     node scripts/make-mascot.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { png, blend, disc, rect } from './png.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons')
const SIZE = 256

const HALO = [96, 165, 250, 70] // a lighter blue, mostly transparent
const RING = [147, 197, 253, 140]
const WHITE = [255, 255, 255, 255]
const FACE = [30, 58, 138, 255] // the dark navy of the eyes and mouth
const EAR = [191, 219, 254, 255]

mkdirSync(OUT, { recursive: true })

writeFileSync(
  join(OUT, 'mascot.png'),
  png(SIZE, (x, y, s) => {
    let pixel = [0, 0, 0, 0]

    // Two haloes, the outer one barely there, so it fades into the header rather
    // than ending on a hard edge.
    pixel = blend(pixel, HALO, disc(x, y, s / 2, s / 2, s * 0.48))
    pixel = blend(pixel, RING, ringOf(x, y, s / 2, s / 2, s * 0.42, s * 0.02))

    // The ear pieces, behind the head so they read as attached.
    pixel = blend(pixel, EAR, rect(x, y, s * 0.16, s * 0.4, s * 0.3, s * 0.62, s * 0.06))
    pixel = blend(pixel, EAR, rect(x, y, s * 0.7, s * 0.4, s * 0.84, s * 0.62, s * 0.06))

    // The head: a rounded square, not a circle. A circle plus two eyes is a smiley;
    // the flat sides are what make it a robot.
    pixel = blend(pixel, WHITE, rect(x, y, s * 0.22, s * 0.26, s * 0.78, s * 0.74, s * 0.2))

    // The visor the eyes sit in.
    pixel = blend(pixel, FACE, rect(x, y, s * 0.3, s * 0.36, s * 0.7, s * 0.64, s * 0.14))

    // Eyes and smile, back in white against the visor.
    pixel = blend(pixel, WHITE, disc(x, y, s * 0.42, s * 0.47, s * 0.045))
    pixel = blend(pixel, WHITE, disc(x, y, s * 0.58, s * 0.47, s * 0.045))
    pixel = blend(pixel, WHITE, smile(x, y, s))

    return pixel
  }),
)

console.log('wrote mascot.png')

/** The lower arc of a ring — a mouth. */
function smile(x, y, s) {
  if (y < s * 0.53) return 0
  return ringOf(x, y, s * 0.5, s * 0.5, s * 0.1, s * 0.022)
}

/** An outlined circle: the disc minus a smaller one. */
function ringOf(x, y, cx, cy, radius, thickness) {
  return Math.max(0, disc(x, y, cx, cy, radius) - disc(x, y, cx, cy, radius - thickness))
}
