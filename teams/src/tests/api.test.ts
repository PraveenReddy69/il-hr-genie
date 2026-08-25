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
import { asEmployee, holidays } from '../api.js'

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
