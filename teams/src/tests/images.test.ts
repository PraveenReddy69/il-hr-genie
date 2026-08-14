/**
 * Every image a card references is actually shipped.
 *
 * The artwork lives in `assets/icons` and is served by this service, so a renamed
 * file or a typo'd glyph name is a missing file rather than a 404 from someone else's
 * site — which means this needs no network at all.
 *
 * A failure here is a card that would render with a hole in it. The four glyphs that
 * once shipped empty are why this layer exists.
 */

import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  answerCard,
  categoryCard,
  celebrationsCard,
  draftCard,
  moodCard,
  moodDetailCard,
  pulseCard,
  receiptCard,
  ticketsCard,
  updatesCard,
  welcomeCard,
} from '../cards.js'
import type { Ticket } from '../api.js'

const ticket: Ticket = {
  id: 'HRG-0001',
  subject: 'A subject',
  category: 'Payroll',
  status: 'RESOLVED',
  createdAtMillis: 1,
    updatedAtMillis: 2,
  comments: [{ status: 'RESOLVED', text: 'Done.', authorId: 'HR000', atMillis: 2 }],
}

// A host, so the cards build absolute URLs the way they will in production. Set
// before any card is built — see iconBase in cards.ts.
process.env.PUBLIC_BASE_URL = 'https://hrgenie-bot.example.com'

/** Every category the picker can show, so no glyph goes unchecked. */
const CATEGORIES = ['Payroll', 'Leave', 'IT & access', 'Insurance', 'Facilities', 'Something else']

const CARDS = [
  welcomeCard('Test'),
  categoryCard(CATEGORIES),
  draftCard('A subject', 'Insurance', 'Test'),
  receiptCard(ticket),
  ticketsCard([ticket]),
  updatesCard([ticket]),
  answerCard('Text.', 'Leave Policy'),
  moodCard(null),
  moodDetailCard('GOOD'),
  pulseCard([{ id: 'q', text: 'Q?', hint: '', options: ['A'] }]),
  celebrationsCard({ birthdays: [{ name: 'A', employeeId: 'EMP1', designation: 'Engineer', email: 'A@example.com' }], anniversaries: [], newJoiners: [] })!,
]

function* urls(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) yield* urls(item)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (node.type === 'Image' && typeof node.url === 'string') yield node.url
  const background = (node.backgroundImage as { url?: string } | undefined)?.url
  if (background) yield background
  for (const child of Object.values(node)) yield* urls(child)
}

const referenced = [...new Set(CARDS.flatMap((card) => [...urls(card)]))].sort()

const ICONS = fileURLToPath(new URL('../assets/icons/', import.meta.url))

/** `https://host/icons/ticket.png?v=3` -> `ticket.png` */
const fileOf = (url: string): string => url.split('/').pop()!.split('?')[0]

describe('card artwork', () => {
  it('references at least the glyphs and the header', () => {
    assert.ok(referenced.length >= 8, `only ${referenced.length} images referenced`)
  })

  it('serves every one of them over https', () => {
    // Adaptive Cards silently refuses plain http, and a relative URL means
    // PUBLIC_BASE_URL was not set when the card was built.
    for (const url of referenced) {
      assert.ok(url.startsWith('https://'), `${url} is not an absolute https URL`)
    }
  })

  for (const url of referenced) {
    it(`${fileOf(url)} is shipped`, () => {
      const path = `${ICONS}${fileOf(url)}`
      assert.ok(existsSync(path), `${fileOf(url)} is referenced by a card but not in assets/icons`)
      // The signature, not a byte count: tile-white.png is a legitimate 72-byte flat
      // colour, and any threshold that accepts it would accept an empty file too.
      const magic = readFileSync(path).subarray(0, 8)
      assert.deepEqual(
        [...magic],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        `${fileOf(url)} is ${statSync(path).size} bytes and is not a PNG`,
      )
    })
  }
})
