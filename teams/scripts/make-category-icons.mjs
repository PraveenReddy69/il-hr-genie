/**
 * The category glyphs the Teams cards use.
 *
 * Adaptive Cards can only show an image from an https URL, so these are written into
 * `web/public/` and served by the console's GitHub Pages site — the one host we
 * already publish to.
 *
 * Drawn as coverage functions rather than traced from the Android vectors, because
 * rasterising SVG paths needs a library this environment does not have. Same shapes,
 * same palette, redrawn: a coloured glyph on its own tinted disc.
 *
 *     node scripts/make-category-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { png, blend, disc, rect } from './png.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'public', 'icons')
const SIZE = 64

/** The app's palette: [glyph, disc tint]. */
const GREEN = ['#42c07a', '#e3f6ec']
const BLUE = ['#2b8cff', '#e2eeff']
const PURPLE = ['#7a5af8', '#eae5fe']
const DEEP = ['#1a6fd6', '#e2eeff']
const ORANGE = ['#f08a5d', '#fdeade']
const SLATE = ['#5b6b8c', '#eaeef5']

const ICONS = {
  payroll: [GREEN, banknote],
  leave: [BLUE, calendar],
  'it-access': [PURPLE, laptop],
  insurance: [DEEP, shield],
  facilities: [ORANGE, building],
  'something-else': [SLATE, dots],
  ticket: [BLUE, ticket],
  list: [SLATE, list],
  mood: [GREEN, smile],
}

mkdirSync(OUT, { recursive: true })
for (const [name, [[ink, tint], glyph]] of Object.entries(ICONS)) {
  const inkRgb = hex(ink)
  const tintRgb = hex(tint)
  writeFileSync(
    join(OUT, `${name}.png`),
    png(SIZE, (x, y, size) => {
      let pixel = [0, 0, 0, 0]
      pixel = blend(pixel, tintRgb, disc(x, y, size / 2, size / 2, size / 2 - 0.5))
      return blend(pixel, inkRgb, glyph(x, y, size))
    }),
  )
  console.log(`wrote ${name}.png`)
}

// ------------------------------------------------------------------- the glyphs
// Each returns coverage in 0..1, in pixels, for an icon `s` across.

/** A banknote with a coin on it. */
function banknote(x, y, s) {
  const note = ring(x, y, s, (a, b) => rect(a, b, s * 0.18, s * 0.3, s * 0.82, s * 0.66, s * 0.05), s * 0.07)
  const coin = ringDisc(x, y, s / 2, s * 0.48, s * 0.1, s * 0.07)
  return Math.max(note, coin)
}

/** A calendar: body, two tabs, and a row of days. */
function calendar(x, y, s) {
  const body = ring(x, y, s, (a, b) => rect(a, b, s * 0.2, s * 0.26, s * 0.8, s * 0.78, s * 0.07), s * 0.07)
  const tabs = Math.max(
    rect(x, y, s * 0.31, s * 0.17, s * 0.38, s * 0.31, s * 0.03),
    rect(x, y, s * 0.62, s * 0.17, s * 0.69, s * 0.31, s * 0.03),
  )
  const rule = rect(x, y, s * 0.2, s * 0.4, s * 0.8, s * 0.45)
  let days = 0
  for (const cx of [0.33, 0.5, 0.67]) {
    days = Math.max(days, rect(x, y, s * (cx - 0.045), s * 0.55, s * (cx + 0.045), s * 0.64, s * 0.02))
  }
  return Math.max(body, tabs, rule, days)
}

/** A laptop: screen and base. */
function laptop(x, y, s) {
  const screen = ring(x, y, s, (a, b) => rect(a, b, s * 0.22, s * 0.24, s * 0.78, s * 0.6, s * 0.05), s * 0.07)
  const base = rect(x, y, s * 0.12, s * 0.64, s * 0.88, s * 0.72, s * 0.04)
  return Math.max(screen, base)
}

/** A shield with a cross in it. */
function shield(x, y, s) {
  const outline = shieldBody(x, y, s, 0) - shieldBody(x, y, s, s * 0.075)
  const cross = Math.max(
    rect(x, y, s * 0.45, s * 0.32, s * 0.55, s * 0.58, s * 0.02),
    rect(x, y, s * 0.37, s * 0.4, s * 0.63, s * 0.5, s * 0.02),
  )
  return Math.min(1, Math.max(Math.max(0, outline), cross))
}

function shieldBody(x, y, s, inset) {
  const top = s * 0.18 + inset
  const bottom = s * 0.84 - inset
  const halfWidth = s * 0.3 - inset
  if (y < top || y > bottom) return 0
  // Straight sides down to two thirds, then tapering to a point.
  const shoulder = s * 0.58
  const width = y <= shoulder ? halfWidth : halfWidth * (1 - (y - shoulder) / (bottom - shoulder))
  return clamp(width - Math.abs(x - s / 2) + 0.5)
}

/** An office block with windows. */
function building(x, y, s) {
  const tower = ring(x, y, s, (a, b) => rect(a, b, s * 0.22, s * 0.2, s * 0.55, s * 0.8, s * 0.03), s * 0.065)
  const annexe = ring(x, y, s, (a, b) => rect(a, b, s * 0.55, s * 0.44, s * 0.79, s * 0.8, s * 0.03), s * 0.065)
  let windows = 0
  for (const wy of [0.31, 0.45, 0.59]) {
    for (const wx of [0.3, 0.42]) {
      windows = Math.max(windows, rect(x, y, s * wx, s * wy, s * (wx + 0.06), s * (wy + 0.07), s * 0.01))
    }
  }
  return Math.max(tower, annexe, windows)
}

/** Three dots in a ring — the catch-all. */
function dots(x, y, s) {
  const outline = ringDisc(x, y, s / 2, s / 2, s * 0.32, s * 0.07)
  let marks = 0
  for (const cx of [0.34, 0.5, 0.66]) {
    marks = Math.max(marks, disc(x, y, s * cx, s / 2, s * 0.055))
  }
  return Math.max(outline, marks)
}

/** A ticket stub with a perforation. */
function ticket(x, y, s) {
  const body = ring(x, y, s, (a, b) => rect(a, b, s * 0.14, s * 0.3, s * 0.86, s * 0.7, s * 0.06), s * 0.07)
  // The notches that make it read as a ticket rather than a card.
  const notch = Math.max(disc(x, y, s * 0.14, s / 2, s * 0.08), disc(x, y, s * 0.86, s / 2, s * 0.08))
  let perforation = 0
  for (const py of [0.38, 0.48, 0.58]) {
    perforation = Math.max(perforation, rect(x, y, s * 0.48, s * py, s * 0.52, s * (py + 0.05), s * 0.01))
  }
  return Math.max(Math.max(0, body - notch), perforation)
}

/** A face, for the daily check-in. */
function smile(x, y, s) {
  const face = ringDisc(x, y, s / 2, s / 2, s * 0.32, s * 0.07)
  const eyes = Math.max(
    disc(x, y, s * 0.4, s * 0.44, s * 0.045),
    disc(x, y, s * 0.6, s * 0.44, s * 0.045),
  )
  // The smile: the lower half of a ring, clipped above the mouth line.
  const arc = y > s * 0.55 ? ringDisc(x, y, s / 2, s * 0.5, s * 0.16, s * 0.055) : 0
  return Math.max(face, eyes, arc)
}

/** Lines with bullets — a list. */
function list(x, y, s) {
  let out = 0
  for (const ly of [0.3, 0.47, 0.64]) {
    out = Math.max(
      out,
      disc(x, y, s * 0.26, s * (ly + 0.03), s * 0.045),
      rect(x, y, s * 0.38, s * ly, s * 0.76, s * (ly + 0.06), s * 0.03),
    )
  }
  return out
}

// ---------------------------------------------------------------------- helpers

/**
 * Hollows a filled shape out into an outline of the given thickness.
 *
 * `shape` **must** use the coordinates it is handed, not the ones from the enclosing
 * scope — this samples it at offsets, and a closure that ignores its arguments erodes
 * nothing, leaving an outline that cancels itself to empty.
 */
function ring(x, y, s, shape, thickness) {
  const outer = shape(x, y, s)
  // Sampling the same shape shrunk by the thickness is close enough at this size and
  // avoids needing a signed distance field for every glyph.
  const inner = shrink(shape, x, y, s, thickness)
  return Math.max(0, outer - inner)
}

function shrink(shape, x, y, s, by) {
  // Approximates erosion by testing whether every neighbour at `by` is also inside.
  let min = 1
  for (const [dx, dy] of [
    [by, 0],
    [-by, 0],
    [0, by],
    [0, -by],
  ]) {
    min = Math.min(min, shape(x + dx, y + dy, s))
  }
  return min
}

function ringDisc(x, y, cx, cy, radius, thickness) {
  return Math.max(0, disc(x, y, cx, cy, radius) - disc(x, y, cx, cy, radius - thickness))
}

function clamp(value) {
  return Math.min(1, Math.max(0, value))
}

function hex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ]
}
