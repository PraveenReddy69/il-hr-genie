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
  holidaysCard,
  moodCard,
  moodDetailCard,
  moodDoneCard,
  nudgeCard,
  pulseCard,
  pulseDoneCard,
  receiptCard,
  subjectPromptCard,
  ticketsCard,
  updatesCard,
  welcomeCard,
  type AdaptiveCard,
} from '../cards.js'
import type { Ticket } from '../api.js'

// Set before any card is built: the icon host comes from the environment, the way it
// will in production. See iconBase in cards.ts.
process.env.PUBLIC_BASE_URL = 'https://hrgenie-bot.example.com'

const ticket = (status: Ticket['status'] = 'OPEN'): Ticket => ({
  id: 'HRG-0001',
  subject: 'My payslip is missing from the portal',
  category: 'Payroll',
  status,
  createdAtMillis: 1,
    updatedAtMillis: 2,
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
    celebrationsCard({
      birthdays: [{ name: 'A', employeeId: 'EMP1', designation: 'Engineer', email: 'A@example.com' }],
      anniversaries: [{ name: 'B', employeeId: 'EMP2', designation: 'Manager', years: 2, email: 'B@example.com' }],
      newJoiners: [],
    })!,
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
  'holidays',
  'team',
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
  // The nudge's own buttons. Same errands as checkIn and startPulse, but distinct so
  // the nudge can be retired on use without taking the welcome menu with it.
  'nudgeCheckIn',
  'nudgePulse',
  'describe',
  // The popular-question pills on the welcome card.
  'ask',
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

// ------------------------------------------------------- expanding in place

describe('the celebrations overflow', () => {
  const many = Array.from({ length: 10 }, (_, index) => ({
    name: `Person ${index + 1}`,
    employeeId: `EMP${100 + index}`,
    designation: 'Executive',
    email: `person${index + 1}@example.com`,
  }))

  it('hides the overflow and points the button at exactly those rows', () => {
    // A ToggleVisibility whose targets do not match any element id does nothing at
    // all, silently — the button is there, it just never opens. Only a check like
    // this catches that, because the card is still perfectly valid.
    const card = celebrationsCard({ birthdays: many, anniversaries: [], newJoiners: [] })!
    const ids = new Set(
      [...nodes(card)]
        .filter((node) => node.isVisible === false && typeof node.id === 'string')
        .map((node) => node.id as string),
    )
    const toggles = [...nodes(card)].filter(
      (node) => node.type === 'Action.ToggleVisibility',
    ) as { title?: string; targetElements?: string[] }[]

    // Two: "+7 more" showing, "Show less" hidden. Each flips the rows and both
    // buttons, so the label always matches what is on screen.
    assert.deepEqual(
      toggles.map((one) => one.title),
      ['+7 more', 'Show less'],
    )
    assert.equal(ids.size, 8, 'seven rows plus the hidden Show less')
    for (const toggle of toggles) {
      for (const target of toggle.targetElements ?? []) {
        assert.ok(
          ids.has(target) || target.endsWith('-more'),
          `nothing to toggle for "${target}"`,
        )
      }
      assert.ok(
        (toggle.targetElements ?? []).includes('bday-more'),
        'each button must flip the other, or the label goes stale',
      )
      assert.ok((toggle.targetElements ?? []).includes('bday-less'))
    }
  })

  it('shows no button when everyone fits', () => {
    const card = celebrationsCard({
      birthdays: many.slice(0, 2),
      anniversaries: [],
      newJoiners: [],
    })!
    const toggles = [...nodes(card)].filter((node) => node.type === 'Action.ToggleVisibility')
    assert.equal(toggles.length, 0)
  })
})

describe('the Wish button', () => {
  const withEmail = {
    name: 'Dheeraj Reddy',
    employeeId: 'EMP3805',
    designation: 'Senior Manager',
    email: 'dheeraj@infinitylearn.com',
  }

  function openUrls(card: unknown): { title?: string; url?: string }[] {
    return [...nodes(card)].filter((n) => n.type === 'Action.OpenUrl') as never
  }

  it('opens a Teams chat with that person, message already written', () => {
    const card = celebrationsCard({ birthdays: [withEmail], anniversaries: [], newJoiners: [] })!
    const [action] = openUrls(card)
    assert.ok(action, 'a Wish button')
    const url = new URL(action.url!)
    assert.equal(url.pathname, '/l/chat/0/0')
    assert.equal(url.searchParams.get('users'), 'dheeraj@infinitylearn.com')
    assert.match(url.searchParams.get('message')!, /Happy birthday, Dheeraj/)
  })

  it('greets each occasion in its own words', () => {
    const card = celebrationsCard({
      birthdays: [],
      anniversaries: [{ ...withEmail, years: 3 }],
      newJoiners: [{ ...withEmail, name: 'New Person' }],
    })!
    const messages = openUrls(card).map((a) => new URL(a.url!).searchParams.get('message'))
    assert.match(messages[0]!, /Congratulations on 3 years/)
    assert.match(messages[1]!, /Welcome to Infinity Learn, New/)
  })

  it('hides itself when the directory has no email, rather than opening an empty chat', () => {
    // The live payload has no email today — the button must simply not appear.
    const card = celebrationsCard({
      birthdays: [{ ...withEmail, email: '' }],
      anniversaries: [],
      newJoiners: [],
    })!
    assert.equal(openUrls(card).length, 0)
  })
})

describe('choosing a category', () => {
  it('keeps the category out of the header, because the dropdown can change it', () => {
    // The header named the category that was picked, and the dropdown below it could
    // then be changed — leaving a card that said Payroll over a field saying Leave. A
    // sent card renders once, so the header cannot follow the dropdown.
    const card = subjectPromptCard('Leave', ['Payroll', 'Leave'])
    const header = (card.body[0] as { items: { text: string }[] }).items.map((i) => i.text)

    assert.deepEqual(header.slice(0, 2), ['NEW TICKET', 'What is happening?'])
    assert.match(JSON.stringify(card), /Nothing goes to HR until you have seen it/)
  })

  it('uses one placeholder for every category', () => {
    // A sent card cannot react to its own dropdown — Adaptive Cards has no change
    // event — so a per-category example goes stale the moment somebody changes the
    // selection, showing a payroll example under IT & access.
    const payroll = JSON.stringify(subjectPromptCard('Payroll', ['Payroll', 'Leave']))
    const access = JSON.stringify(subjectPromptCard('IT & access', ['Payroll', 'Leave']))

    assert.match(payroll, /Please describe your concern here/)
    assert.match(access, /Please describe your concern here/)
    assert.doesNotMatch(access, /payslip/, 'nothing category-specific to go stale')
  })
})

describe("HR's reply in the ticket list", () => {
  const withReply = {
    id: 'HRG-0008',
    subject: 'Need to update my pay cycle',
    category: 'Payroll',
    status: 'RESOLVED' as const,
    createdAtMillis: 1,
    updatedAtMillis: 2,
    comments: [
      { status: 'RESOLVED' as const, text: 'Updated from the September run.', authorId: 'HR000', atMillis: 2 },
    ],
  }
  const untouched = { ...withReply, id: 'HRG-0009', status: 'OPEN' as const, comments: [] }

  it('folds the journey away behind a toggle that can actually open it', () => {
    const card = ticketsCard([withReply])
    const hidden = [...nodes(card)].filter((n) => n.isVisible === false).map((n) => n.id)
    const toggle = [...nodes(card)].find((n) => n.type === 'Action.ToggleVisibility') as {
      title?: string
      targetElements?: string[]
    }
    assert.ok(toggle, 'a toggle')
    assert.match(toggle.title!, /Track this ticket/)
    for (const target of toggle.targetElements ?? []) assert.ok(hidden.includes(target))
    assert.match(JSON.stringify(card), /Updated from the September run/)
  })

  it('offers nothing on a ticket nobody has replied to', () => {
    // A button promising HR's reply where there is none is a lie the card tells.
    const card = ticketsCard([untouched])
    assert.equal([...nodes(card)].filter((n) => n.type === 'Action.ToggleVisibility').length, 0)
  })
})

describe('the ticket timeline', () => {
  const t0 = Date.UTC(2025, 4, 12, 3, 45)
  const inProgress = {
    id: 'HRG-1',
    subject: 'S',
    category: 'Payroll',
    status: 'IN_PROGRESS' as const,
    createdAtMillis: t0,
    updatedAtMillis: 2,
    comments: [
      { status: 'IN_PROGRESS' as const, text: 'Looking into it.', authorId: 'HR000', atMillis: t0 + 1800000 },
    ],
  }

  it('marks what has happened and leaves what has not', () => {
    // A resolved-looking marker on an unresolved ticket is the one thing this must
    // never do — the whole point is showing where the ticket actually is.
    const card = ticketsCard([inProgress])
    const marks = [...nodes(card)]
      .filter((n) => n.text === '◉' || n.text === '○')
      .map((n) => n.text)
    assert.deepEqual(marks, ['◉', '◉', '○'], 'raised and picked up, not resolved')
    assert.match(JSON.stringify(card), /Not yet/, 'the unreached stop has no invented time')
  })
})

describe('a stop with no comment', () => {
  it('says so, rather than "Not yet" under a filled marker', () => {
    // HR can resolve a ticket without commenting at the in-progress stage. The stop
    // was still passed through, so claiming it has not happened is simply wrong.
    const card = ticketsCard([
      {
        id: 'HRG-1',
        subject: 'S',
        category: 'Payroll',
        status: 'RESOLVED' as const,
        createdAtMillis: Date.UTC(2026, 7, 13, 5, 37),
        updatedAtMillis: Date.UTC(2026, 7, 13, 5, 40),
        comments: [
          { status: 'RESOLVED' as const, text: 'Done.', authorId: 'HR000', atMillis: Date.UTC(2026, 7, 12, 18, 24) },
        ],
      },
    ])
    const text = JSON.stringify(card)
    assert.match(text, /No comment recorded/)
    assert.doesNotMatch(text, /Not yet/, 'every stop was reached on a resolved ticket')
  })
})

/**
 * Which card an action belongs to.
 *
 * The nudge and the welcome menu offer the same two errands. They must not submit the
 * same action kind: the nudge is a prompt and is removed once answered, while the menu
 * is meant to survive being used — someone scrolling back should still be able to
 * check in from it tomorrow. One shared kind means either the prompt lingers as a
 * decoy or the menu disappears under them.
 */
describe('the nudge and the menu are told apart', () => {
  const kindsIn = (card: AdaptiveCard): string[] =>
    [...JSON.stringify(card).matchAll(/"kind":"([a-zA-Z]+)"/g)].map((match) => match[1])

  it('the nudge submits only its own kinds', () => {
    const nudge = nudgeCard('Test', { mood: true, pulse: true })
    assert.ok(nudge, 'both outstanding, so there is a nudge')
    const kinds = kindsIn(nudge)

    assert.deepEqual(
      kinds.sort(),
      ['dismissNudge', 'nudgeCheckIn', 'nudgePulse'],
      'every button on the nudge is one the nudge owns',
    )
  })

  it('the menu keeps the plain kinds, so it is never retired', () => {
    const kinds = kindsIn(welcomeCard('Test'))

    // Both the once-a-day and the once-a-month errands are left to the nudge, which
    // asks for them only while they are actually open.
    assert.ok(!kinds.includes('checkIn'), 'the menu leaves the check-in to the nudge')
    assert.ok(!kinds.includes('startPulse'), 'and the pulse too')
    assert.ok(
      !kinds.some((kind) => kind.startsWith('nudge')),
      'nothing on the menu is a nudge action',
    )
  })

  it('the nudge drops the check-in button once today is answered', () => {
    const nudge = nudgeCard('Test', { mood: false, pulse: true })
    assert.ok(nudge)
    assert.ok(!kindsIn(nudge).includes('nudgeCheckIn'))
  })
})

/**
 * A tap has to leave a trace.
 *
 * A plain Action.Submit posts nothing visible, so someone tapping a tile — especially
 * one several messages up, which stays tappable forever — sees no evidence anything
 * happened and taps again, while the reply lands at the bottom of a chat they are not
 * looking at. `messageBack` posts the label as a message from them, which both confirms
 * the tap and scrolls the chat to where the answer is.
 */
describe('tiles report themselves in the conversation', () => {
  const tiles = (card: AdaptiveCard) =>
    [...nodes(card)]
      .filter((node) => node.type === 'Container' && node.selectAction)
      .map((node) => node.selectAction as { data?: Record<string, unknown> })

  for (const [name, card] of [
    ['welcome', welcomeCard('Test')],
    ['categories', categoryCard(['Payroll', 'Leave'])],
  ] as [string, AdaptiveCard][]) {
    it(`${name} tiles post a message back`, () => {
      const found = tiles(card)
      assert.ok(found.length > 0, 'no tappable tiles found')

      for (const action of found) {
        const teams = action.data?.msteams as Record<string, unknown> | undefined
        assert.equal(teams?.type, 'messageBack', 'a silent submit leaves the tap invisible')
        assert.ok(
          typeof teams?.displayText === 'string' && (teams.displayText as string).length > 0,
          'displayText is what the person sees themselves say',
        )

        // The payload has to survive both delivery shapes — see payloadOf in bot.ts.
        assert.ok(typeof action.data?.kind === 'string', 'the action must ride at the top level')
        const encoded = JSON.parse(String(teams?.value)) as { kind?: string }
        assert.equal(encoded.kind, action.data?.kind, 'and identically inside msteams.value')
      }
    })
  }

  it('labels the message with the tile that was tapped', () => {
    const labels = tiles(welcomeCard('Test')).map(
      (action) => (action.data?.msteams as { displayText?: string })?.displayText,
    )
    assert.ok(labels.includes('Raise a ticket'))
    assert.ok(labels.includes('My tickets'))
  })
})

describe('the category picker', () => {
  it('says what each category covers', () => {
    // "Payroll" and "Facilities" are clear to whoever wrote them, not to somebody
    // choosing under mild stress. A ticket in the right queue is one HR need not move.
    const card = JSON.stringify(
      categoryCard(['Payroll', 'Leave', 'IT & access', 'Insurance', 'Facilities', 'Something else']),
    )

    assert.match(card, /Salary, payslips/)
    assert.match(card, /Leave balance/)
    assert.match(card, /Laptop, software/)
    assert.match(card, /Health cover/)
    assert.match(card, /Office, seating/)
    assert.match(card, /does not fit the others/)
  })

  it('shows a category it has no line for rather than inventing one', () => {
    // The names come from the API, so one added server-side must still render.
    const card = JSON.stringify(categoryCard(['Relocation']))
    assert.match(card, /Relocation/)
  })
})

describe('the holidays card', () => {
  const holidays = [
    { isoDate: '2026-08-15', name: 'Independence Day', region: 'All India', kind: 'FIXED' as const },
    { isoDate: '2026-10-02', name: 'Gandhi Jayanti', region: 'All India', kind: 'FIXED' as const },
    { isoDate: '2026-12-25', name: 'Christmas Day', region: 'All India', kind: 'FIXED' as const },
  ]

  it('counts down to the next one, in the header and on the row', () => {
    // A date is a fact; "in 4 days" is what people actually want from this list.
    const card = JSON.stringify(holidaysCard(holidays, '2026-08-11'))
    assert.match(card, /next in 4 days/i, 'the header says how long')
    assert.match(card, /"In 4 days"/, 'and so does the row')
  })

  it('says today and tomorrow rather than counting them', () => {
    assert.match(JSON.stringify(holidaysCard(holidays, '2026-08-15')), /today/i)
    assert.match(JSON.stringify(holidaysCard(holidays, '2026-08-14')), /tomorrow/i)
  })

  it('highlights exactly one row', () => {
    // Two highlighted rows would be worse than none: the eye stops trusting it.
    const card = holidaysCard(holidays, '2026-08-11')
    // The header carries a background image too, so match the white tile fill only.
    const highlighted = [...nodes(card)].filter((node) =>
      String((node.backgroundImage as { url?: string } | undefined)?.url ?? '').includes(
        'tile-white',
      ),
    )
    assert.equal(highlighted.length, 1)
  })

  it('leaves the past behind', () => {
    const card = JSON.stringify(holidaysCard(holidays, '2026-10-03'))
    assert.doesNotMatch(card, /Independence Day/)
    assert.match(card, /Christmas Day/)
  })
})

describe('a ticket row, as the Android list has it', () => {
  const at = (id: string, status: Ticket['status']): Ticket => ({
    id,
    subject: 'My salary got deducted',
    category: 'Payroll',
    status,
    createdAtMillis: 1,
    updatedAtMillis: 2,
    comments: [],
  })

  it('marks the status twice — a glyph and the word', () => {
    // Nothing should depend on colour alone, and a glyph is what makes a stack of
    // tickets scannable. Same reasoning as item_my_ticket.xml.
    const card = JSON.stringify(ticketsCard([at('HRG-1', 'RESOLVED')]))
    assert.match(card, /"text":"✓"/, 'the glyph')
    assert.match(card, /"text":"Resolved"/, 'and the word')
  })

  it('gives each status its own glyph', () => {
    const card = JSON.stringify(
      ticketsCard([at('HRG-1', 'OPEN'), at('HRG-2', 'IN_PROGRESS'), at('HRG-3', 'RESOLVED')]),
    )
    assert.match(card, /"text":"!"/)
    assert.match(card, /"text":"⋯"/)
    assert.match(card, /"text":"✓"/)
  })

  it('monospaces the reference', () => {
    // HRG-0012 is read aloud and typed into a search box; proportional digits make
    // that harder than it needs to be.
    const card = JSON.stringify(ticketsCard([at('HRG-0012', 'OPEN')]))
    assert.match(card, /"text":"HRG-0012","size":"Small","fontType":"Monospace"/)
  })
})

describe('the three cards of a ticket read as one flow', () => {
  const filed: Ticket = {
    id: 'HRG-0042',
    subject: 'My payslip is missing the shift allowance',
    category: 'Payroll',
    status: 'OPEN',
    createdAtMillis: 1,
    updatedAtMillis: 2,
    comments: [],
  }

  it('says the same three facts the same way as the ticket list', () => {
    // Reference, category and status, in that order, monospaced reference included.
    const receipt = JSON.stringify(receiptCard(filed))
    assert.match(receipt, /"text":"HRG-0042","size":"Small","fontType":"Monospace"/)
    assert.match(receipt, /"text":"With HR"/)
    assert.match(receipt, /"text":"Payroll"/)
  })

  it('uses a meta line rather than a FactSet', () => {
    // A FactSet renders as a two-column table — a heavy way to say two short things,
    // and it repeated the category the header already carries.
    assert.doesNotMatch(JSON.stringify(draftCard('A subject', 'Payroll', 'Test')), /FactSet/)
    assert.doesNotMatch(JSON.stringify(receiptCard(filed)), /FactSet/)
  })

  it('shows what was filed on the same white panel the list uses', () => {
    assert.match(JSON.stringify(receiptCard(filed)), /tile-white/)
  })

  it('keeps the draft editable, with the subject already in the box', () => {
    // Whatever is in this box when Raise it is pressed is what gets filed.
    const draft = JSON.stringify(draftCard('My payslip is missing', 'Payroll', 'Test'))
    assert.match(draft, /"type":"Input.Text","id":"subject","value":"My payslip is missing"/)
  })
})
