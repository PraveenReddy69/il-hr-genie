/**
 * Every card the bot can send, checked structurally.
 *
 * This layer exists because of two bugs that shipped past a human reading the code:
 * four glyphs that rendered empty, and a card whose action carried a `kind` the
 * adapter did not map. Neither is visible in a diff; both are trivially assertable.
 *
 * Nothing here touches the network — see `images.test.ts` for that.
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
  moodDoneCard,
  nudgeCard,
  pulseCard,
  pulseDoneCard,
  receiptCard,
  ticketsCard,
  updatesCard,
  welcomeCard,
  type AdaptiveCard,
} from '../cards.js'
import type { Ticket } from '../api.js'

const ticket = (status: Ticket['status'] = 'OPEN'): Ticket => ({
  id: 'HRG-0001',
  subject: 'My payslip is missing from the portal',
  category: 'Payroll',
  status,
  createdAtMillis: 1,
  comments: [{ status, text: 'Reversed in the August run.', authorId: 'HR000', atMillis: 2 }],
})

const questions = [
  { id: 'experience', text: 'How was the month?', hint: 'Gut feel.', options: ['Good', 'Bad'] },
]

/** Every card, named, so a failure says which one. */
const ALL: [string, AdaptiveCard][] = [
  ['welcome', welcomeCard('Test')],
  ['categories', categoryCard(['Payroll', 'Leave', 'IT & access', 'Something else'])],
  ['draft', draftCard('A subject', 'Payroll', 'Test · EMP1')],
  ['receipt', receiptCard(ticket())],
  ['tickets', ticketsCard([ticket(), ticket('RESOLVED')])],
  ['tickets (empty)', ticketsCard([])],
  ['updates', updatesCard([ticket('RESOLVED')])],
  ['answer', answerCard('Twelve days.', 'Leave Policy')],
  ['answer (no source)', answerCard('Twelve days.', null)],
  ['mood', moodCard(null)],
  ['mood (already)', moodCard({ mood: 'GOOD', reasons: [], note: null, dateIso: 'x' })],
  ['mood detail', moodDetailCard('STRESSED')],
  ['mood done', moodDoneCard('GOOD', ['Workload'], 'a note')],
  ['pulse', pulseCard(questions)],
  ['pulse done', pulseDoneCard(3, 4)],
  ['nudge', nudgeCard('Test', { mood: true, pulse: true })!],
  [
    'celebrations',
    celebrationsCard({ birthdays: ['A'], anniversaries: [{ name: 'B', years: 2 }], newJoiners: [] })!,
  ],
]

/** Walks every node of a card, whatever the nesting. */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (typeof node.type === 'string') yield node
  for (const child of Object.values(node)) yield* nodes(child)
}

/** The kinds `actionFrom` in bot.ts knows how to map. An unmapped one does nothing. */
const MAPPED_KINDS = new Set([
  'startTicket',
  'myTickets',
  'raise',
  'cancel',
  'pickCategory',
  'checkIn',
  'pickMood',
  'saveMood',
  'skipMoodDetail',
  'startPulse',
  'savePulse',
  'dismissNudge',
])

describe('every card', () => {
  for (const [name, card] of ALL) {
    it(`${name} is a well-formed Adaptive Card`, () => {
      assert.equal(card.type, 'AdaptiveCard')
      assert.equal(card.version, '1.5')
      assert.ok(card.$schema.startsWith('http'), 'needs a schema')
      assert.ok(Array.isArray(card.body) && card.body.length > 0, 'needs a body')
    })

    it(`${name} has no empty text`, () => {
      for (const node of nodes(card)) {
        if (node.type === 'TextBlock') {
          assert.ok(
            typeof node.text === 'string' && node.text.trim().length > 0,
            'a blank TextBlock renders as a mystery gap',
          )
        }
      }
    })

    it(`${name} only submits actions the adapter maps`, () => {
      for (const node of nodes(card)) {
        if (node.type !== 'Action.Submit') continue
        const data = node.data as Record<string, unknown> | undefined
        assert.ok(data, 'a submit with no data does nothing')
        assert.ok(
          typeof data.kind === 'string' && MAPPED_KINDS.has(data.kind),
          `unmapped action kind: ${String(data?.kind)}`,
        )
      }
    })

    it(`${name} loads its images over https`, () => {
      for (const node of nodes(card)) {
        const url =
          node.type === 'Image'
            ? node.url
            : ((node.backgroundImage as { url?: string } | undefined)?.url ?? null)
        if (!url) continue
        assert.ok(
          String(url).startsWith('https://'),
          'Adaptive Cards will not load an image over plain http',
        )
      }
    })

    it(`${name} gives every input an id`, () => {
      for (const node of nodes(card)) {
        if (!String(node.type).startsWith('Input.')) continue
        assert.ok(node.id, 'an input with no id is dropped from the submitted data')
      }
    })
  }
})

describe('cards that should not exist', () => {
  it('no nudge when nothing is outstanding', () => {
    assert.equal(nudgeCard('Test', { mood: false, pulse: false }), null)
  })

  it('no celebrations card on a day with none', () => {
    assert.equal(
      celebrationsCard({ birthdays: [], anniversaries: [], newJoiners: [] }),
      null,
      'an empty "nobody is celebrating" card is noise every ordinary day',
    )
  })
})

describe('the pulse card', () => {
  it('gives every question an input keyed by its own id', () => {
    const many = pulseCard([
      ...questions,
      { id: 'workload', text: 'Workload?', hint: '', options: ['Fine', 'Heavy'] },
    ])
    const ids = [...nodes(many)]
      .filter((node) => node.type === 'Input.ChoiceSet')
      .map((node) => node.id)
    assert.deepEqual(ids, ['experience', 'workload'], 'answers are keyed by question id')
  })
})
