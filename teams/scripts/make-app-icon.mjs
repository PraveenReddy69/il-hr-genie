/**
 * The app icon Teams shows for HR Genie.
 *
 * Two files, both sizes fixed by Teams:
 *
 *   color.png    192x192, full bleed. The tile in the app list and the store card.
 *   outline.png  32x32, white on transparent. The app bar, where Teams tints it
 *                itself — so anything but a flat silhouette disappears.
 *
 * A person wearing a headset: the one image that reads as "someone from HR will
 * answer this" at 32 pixels. A speech bubble reads as chat, a building reads as
 * facilities, and a question mark reads as an FAQ nobody wants.
 *
 *     node scripts/make-app-icon.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { png, blend, disc, rect, segment } from './png.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'appPackage')

const TOP = [43, 140, 255, 255] // #2b8cff
const BOTTOM = [26, 111, 214, 255] // #1a6fd6
const WHITE = [255, 255, 255, 255]

/**
 * The figure, as coverage in 0..1.
 *
 * Everything is expressed against `s`, so the same drawing serves 192 and 32. The
 * proportions are deliberately heavy — thin strokes vanish at app-bar size, and the
 * app bar is where this icon is seen most.
 */
function agent(x, y, s) {
  const cx = s / 2

  // The head, and the shoulders it sits on.
  //
  // A dome cut flat, not a rounded rectangle: a rectangle with corners soft enough to
  // look like shoulders ends up looking like a bowl, which is what the first attempt
  // did. The gap under the chin is left by the geometry rather than notched out.
  const head = disc(x, y, cx, s * 0.4, s * 0.15)
  const shoulders = y <= s * 0.9 ? disc(x, y, cx, s * 0.9, s * 0.3) : 0

  // The headset band: the upper half of a ring, clipped level with the ears.
  const band =
    y < s * 0.41
      ? Math.max(0, disc(x, y, cx, s * 0.41, s * 0.25) - disc(x, y, cx, s * 0.41, s * 0.21))
      : 0

  // Ear pieces, one either side, sitting on the band.
  const ears = Math.max(
    rect(x, y, s * 0.195, s * 0.35, s * 0.275, s * 0.48, s * 0.038),
    rect(x, y, s * 0.725, s * 0.35, s * 0.805, s * 0.48, s * 0.038),
  )

  // The boom, curving down to the mouth, with the microphone on its end.
  const boom = Math.max(
    segment(x, y, s * 0.235, s * 0.48, s * 0.26, s * 0.55, s * 0.026),
    segment(x, y, s * 0.26, s * 0.55, s * 0.35, s * 0.575, s * 0.026),
  )
  const mic = disc(x, y, s * 0.365, s * 0.575, s * 0.042)

  return Math.min(1, Math.max(head, shoulders, band, ears, boom, mic))
}

mkdirSync(OUT, { recursive: true })

// The colour tile: a vertical wash, so it does not read as a flat swatch beside the
// other icons in the app list.
writeFileSync(
  join(OUT, 'color.png'),
  png(192, (x, y, s) => {
    const t = y / s
    const background = [
      Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
      Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
      Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
      255,
    ]
    return blend(background, WHITE, agent(x, y, s))
  }),
)

// The app bar icon: the same figure, white, on nothing at all.
writeFileSync(
  join(OUT, 'outline.png'),
  png(32, (x, y, s) => blend([0, 0, 0, 0], WHITE, agent(x, y, s))),
)

console.log('wrote appPackage/color.png (192x192) and appPackage/outline.png (32x32)')
