/**
 * A flat white tile background.
 *
 * Adaptive Cards has no white container style — `default` inherits whatever the card
 * sits on, which in the Teams client is a light grey, not white. The only way to pin
 * a tile to true white is a background image, so this writes one.
 *
 * 8x8 and opaque. It is stretched across the tile, so a single flat colour needs no
 * more pixels than that.
 */

import { writeFileSync } from 'node:fs'
import { png } from './png.mjs'

const WHITE = [255, 255, 255, 255]

const out = new URL('../../web/public/icons/tile-white.png', import.meta.url)
writeFileSync(out, png(8, () => WHITE))
console.log('wrote', out.pathname)
