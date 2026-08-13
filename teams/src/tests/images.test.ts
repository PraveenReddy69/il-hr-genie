/**
 * Every image a card references actually loads.
 *
 * Separate from the other tests because it needs the network: run it with
 * `npm run test:images`. Worth having despite that — the artwork is served by the
 * console's Pages site, so a bad deploy, a renamed file or a broken path shows up
 * here as a red test rather than as a card with holes in it in front of an employee.
 *
 * A failure at 404 means the image is missing. A failure to connect usually means the
 * Pages deploy has not finished, not that anything is wrong with the cards.
 */

import { strict as assert } from 'node:assert'
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

describe('card artwork', () => {
  it('references at least the glyphs and the header', () => {
    assert.ok(referenced.length >= 8, `only ${referenced.length} images referenced`)
  })

  for (const url of referenced) {
    it(`${url.split('/').pop()} is reachable`, async () => {
      const response = await fetch(url, { method: 'GET' })
      assert.equal(response.status, 200, `${url} returned ${response.status}`)
      assert.match(
        response.headers.get('content-type') ?? '',
        /^image\//,
        'served as something other than an image',
      )
      const bytes = (await response.arrayBuffer()).byteLength
      assert.ok(bytes > 100, `${url} is ${bytes} bytes — probably not a real image`)
    })
  }
})
