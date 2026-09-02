/**
 * The mapping between the service's JSON and the shapes the cards draw.
 *
 * This file exists because of a bug it would have caught in a second. The holiday
 * calendar shipped with a date filter whose backslashes had been eaten in transit, so
 * it read /^d{4}-d{2}-d{2}$/ and matched the literal text "dddd-dd-dd". Every row the
 * server sent was silently discarded and the tab said "No dates published for 2026".
 *
 * Nothing caught it, because the conversation tests replace `gateway.holidays`
 * wholesale — they exercise what the bot does with a calendar, never how one is read.
 * So: stub `fetch`, run the real function, and assert on what comes out.
 */

import { strict as assert } from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { asEmployee, holidays, pulseQuestions } from '../api.js'

const SESSION = { employeeId: 'HYD606840', name: 'Test Person', token: 'bearer-token' }

const realFetch = globalThis.fetch

/** Answers every request with `body`, and records the URLs asked for. */
function serve(body: unknown, status = 200): { urls: string[] } {
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }
  }) as unknown as typeof fetch
  return { urls }
}

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Trimmed from the live response on 25 August 2026, ids and all. */
const LIVE = [
  {
    id: '6a7db125da40a6ad40dc11d4',
    name: 'New Year',
    isoDate: '2026-01-01',
    kind: 'FIXED',
    region: 'All India',
  },
  {
    id: '6a7db125da40a6ad40dc11de',
    name: 'Telangana Formation Day',
    isoDate: '2026-06-02',
    kind: 'OPTIONAL',
    region: 'Telangana',
  },
  {
    id: '6a8d7a6c9894174edbe2c1f8',
    name: 'Diwali',
    isoDate: '2026-11-09',
    kind: 'FIXED',
    region: 'All India',
  },
]

describe('reading the holiday calendar', () => {
  it('keeps every row the service actually sent', async () => {
    serve(LIVE)
    const calendar = await asEmployee(SESSION, () => holidays(2026))

    // The regression, stated as plainly as it can be: three in, three out.
    assert.equal(calendar.length, 3)
    assert.deepEqual(
      calendar.map((one) => one.name),
      ['New Year', 'Telangana Formation Day', 'Diwali'],
    )
  })

  it('carries the fields the card draws', async () => {
    serve(LIVE)
    const [, telangana] = await asEmployee(SESSION, () => holidays(2026))

    assert.equal(telangana.isoDate, '2026-06-02')
    assert.equal(telangana.kind, 'OPTIONAL')
    assert.equal(telangana.region, 'Telangana')
  })

  it('asks for the year it was given, as the employee', async () => {
    const { urls } = serve([])
    await asEmployee(SESSION, () => holidays(2027))

    assert.match(urls[0], /\/api\/holidays\?year=2027$/)
  })

  it('reads a wrapped list as well as a bare one', async () => {
    // The service sends a bare array today. This is the shape the console tolerates
    // too, so the two clients do not disagree if it ever changes.
    serve({ holidays: LIVE, years: [2026] })
    const calendar = await asEmployee(SESSION, () => holidays(2026))

    assert.equal(calendar.length, 3)
  })

  it('accepts a timestamp where a date was expected', async () => {
    serve([{ name: 'Diwali', date: '2026-11-09T00:00:00.000Z', type: 'fixed' }])
    const [only] = await asEmployee(SESSION, () => holidays(2026))

    assert.equal(only.isoDate, '2026-11-09')
    assert.equal(only.kind, 'FIXED')
  })

  it('drops a row that has no date rather than drawing a broken one', async () => {
    serve([{ name: 'Someday', isoDate: '' }, ...LIVE])
    const calendar = await asEmployee(SESSION, () => holidays(2026))

    assert.equal(calendar.length, 3)
    assert.ok(!calendar.some((one) => one.name === 'Someday'))
  })

  it('raises a failed call instead of answering with an empty calendar', async () => {
    // An empty list and an unreachable service look identical on the page unless this
    // throws — and only one of them should say "no dates published".
    serve({ message: 'Forbidden' }, 403)

    await assert.rejects(() => asEmployee(SESSION, () => holidays(2026)))
  })
})


/*
 * The pulse bank, and the second bug of exactly the same kind.
 *
 * `/api/pulse/questions` answers `{"questions": [...]}`. The reader looked for a bare
 * array or `{items: [...]}`, found neither, and fell through to four hard-coded
 * questions — so every pulse ever shown in Teams was the fallback, and nothing written
 * in the HR console had ever reached an employee. Silent, because falling back is the
 * correct behaviour when the server genuinely has nothing.
 */
describe('pulseQuestions', () => {
  /** Trimmed from the live response on 2 September 2026. */
  const LIVE = {
    questions: [
      {
        _id: '6a8d40ee67503adad4e126c3',
        id: 'workload',
        question: 'Is your workload manageable right now?',
        hint: '',
        options: ['Comfortable', 'Busy but okay', 'Stretched', 'Not sustainable'],
        tags: [],
        state: 'PUBLISHED',
        order: 2,
      },
      {
        _id: '6a8d40ee67503adad4e126c4',
        id: 'manager',
        question: 'Do you feel supported by your manager?',
        hint: 'Answers roll up to a department average only.',
        options: ['Always', 'Usually', 'Sometimes', 'Rarely'],
        tags: [],
        state: 'PUBLISHED',
        order: 3,
      },
    ],
  }

  it('reads the {questions: [...]} the server actually sends', async () => {
    serve(LIVE)
    const asked = await asEmployee(SESSION, () => pulseQuestions())
    assert.deepEqual(
      asked.map((one) => one.id),
      ['workload', 'manager'],
      'fell back to the hard-coded four instead of reading the response',
    )
    assert.equal(asked[0].text, 'Is your workload manageable right now?')
    assert.deepEqual(asked[0].options, [
      'Comfortable',
      'Busy but okay',
      'Stretched',
      'Not sustainable',
    ])
  })

  it('still reads a bare array', async () => {
    serve(LIVE.questions)
    const asked = await asEmployee(SESSION, () => pulseQuestions())
    assert.deepEqual(asked.map((one) => one.id), ['workload', 'manager'])
  })

  it('still reads {items: [...]}', async () => {
    serve({ items: LIVE.questions })
    const asked = await asEmployee(SESSION, () => pulseQuestions())
    assert.deepEqual(asked.map((one) => one.id), ['workload', 'manager'])
  })

  it('falls back when the server really has nothing', async () => {
    serve({ questions: [] })
    const asked = await asEmployee(SESSION, () => pulseQuestions())
    assert.equal(asked.length, 4, 'a pulse with no questions is worse than the fallback')
    assert.equal(asked[0].id, 'experience')
  })

  it('drops rows that could not be drawn, keeping the rest', async () => {
    serve({
      questions: [
        { id: 'workload', question: 'Is your workload manageable right now?', options: ['a', 'b'] },
        { id: 'broken', question: '', options: [] },
      ],
    })
    const asked = await asEmployee(SESSION, () => pulseQuestions())
    assert.deepEqual(asked.map((one) => one.id), ['workload'])
  })
})
