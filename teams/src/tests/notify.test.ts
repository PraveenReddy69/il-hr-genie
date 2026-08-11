/**
 * The notification endpoint, without a bot registration.
 *
 * Everything worth getting right here is decidable offline: whether the secret is
 * enforced, whether a body is well-formed, whether an unknown employee is refused
 * cleanly, and whether a delivery failure is reported rather than swallowed. What
 * cannot be tested until there is a real bot is the Bot Connector call itself.
 */

import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { References, handleNotify, type Notification } from '../notify.js'

const SECRET = 'shared-secret'
const REFERENCE = { conversation: { id: 'conv-1' } } as never

const moved = {
  employeeId: 'EMP1',
  ticketId: 'HRG-0001',
  status: 'RESOLVED',
  comment: 'Deduction reversed.',
}

function withReference(): References {
  const references = new References()
  references.save('EMP1', REFERENCE)
  return references
}

/** Records what was asked of the transport. */
function spy() {
  const sent: Notification[] = []
  return {
    sent,
    send: async (_reference: unknown, one: Notification) => {
      sent.push(one)
    },
  }
}

describe('the notify endpoint', () => {
  it('delivers to someone who has used the bot', async () => {
    const transport = spy()
    const result = await handleNotify(moved, SECRET, {
      references: withReference(),
      send: transport.send,
      secret: SECRET,
    })
    assert.equal(result.status, 200)
    assert.equal(transport.sent.length, 1)
    assert.equal((transport.sent[0] as { comment?: string }).comment, 'Deduction reversed.')
  })

  it('refuses a bad secret', async () => {
    const transport = spy()
    const result = await handleNotify(moved, 'wrong', {
      references: withReference(),
      send: transport.send,
      secret: SECRET,
    })
    assert.equal(result.status, 401)
    assert.equal(transport.sent.length, 0)
  })

  it('refuses when no secret is configured, rather than allowing everything', async () => {
    // The failure people forget to configure their way out of: an open endpoint here
    // lets anyone push a message that looks like it came from HR.
    const transport = spy()
    const result = await handleNotify(moved, undefined, {
      references: withReference(),
      send: transport.send,
    })
    assert.equal(result.status, 503)
    assert.equal(transport.sent.length, 0)
  })

  it('says plainly when the employee has never opened the bot', async () => {
    const result = await handleNotify({ ...moved, employeeId: 'EMP-NOBODY' }, SECRET, {
      references: withReference(),
      send: spy().send,
      secret: SECRET,
    })
    assert.equal(result.status, 404)
    assert.match(JSON.stringify(result.body), /never opened/i)
  })

  it('rejects a body it cannot act on', async () => {
    const bad = [
      {},
      { employeeId: 'EMP1' },
      { employeeId: 'EMP1', ticketId: 'HRG-1' },
      { employeeId: 'EMP1', ticketId: 'HRG-1', status: 'PENDING' },
    ]
    for (const body of bad) {
      const result = await handleNotify(body, SECRET, {
        references: withReference(),
        send: spy().send,
        secret: SECRET,
      })
      assert.equal(result.status, 422, `should reject ${JSON.stringify(body)}`)
    }
  })

  it('reports a delivery failure instead of claiming success', async () => {
    const result = await handleNotify(moved, SECRET, {
      references: withReference(),
      secret: SECRET,
      send: async () => {
        throw new Error('Bot Connector said no')
      },
    })
    assert.equal(result.status, 503)
    assert.match(JSON.stringify(result.body), /Bot Connector said no/)
  })

  it('accepts a lower-case status from the backend', async () => {
    const transport = spy()
    const result = await handleNotify({ ...moved, status: 'in_progress' }, SECRET, {
      references: withReference(),
      send: transport.send,
      secret: SECRET,
    })
    assert.equal(result.status, 200)
    assert.equal((transport.sent[0] as { status?: string }).status, 'IN_PROGRESS')
  })
})

describe('the daily check-in reminder', () => {
  const reminder = { type: 'checkInReminder', employeeId: 'EMP1', firstName: 'Test' }

  it('delivers to someone who has used the bot', async () => {
    const transport = spy()
    const result = await handleNotify(reminder, SECRET, {
      references: withReference(),
      send: transport.send,
      secret: SECRET,
      today: () => '2026-08-12',
    })
    assert.equal(result.status, 200)
    assert.equal(transport.sent[0].type, 'checkInReminder')
  })

  it('sends once a day, however often the cron runs', async () => {
    // A cron misconfigured to run hourly would otherwise ask someone about their
    // wellbeing twelve times, which is how an app gets muted.
    const transport = spy()
    const references = withReference()
    const deps = { references, send: transport.send, secret: SECRET, today: () => '2026-08-12' }

    const first = await handleNotify(reminder, SECRET, deps)
    const second = await handleNotify(reminder, SECRET, deps)
    const third = await handleNotify(reminder, SECRET, deps)

    assert.equal(first.status, 200)
    assert.deepEqual(first.body, { delivered: true })
    assert.deepEqual(second.body, { delivered: false, reason: 'already reminded today' })
    assert.equal(third.status, 200, 'a repeat is not the caller doing anything wrong')
    assert.equal(transport.sent.length, 1)
  })

  it('sends again the next day', async () => {
    const transport = spy()
    const references = withReference()
    let day = '2026-08-12'
    const deps = { references, send: transport.send, secret: SECRET, today: () => day }

    await handleNotify(reminder, SECRET, deps)
    day = '2026-08-13'
    await handleNotify(reminder, SECRET, deps)
    assert.equal(transport.sent.length, 2)
  })

  it('does not count as reminded when delivery failed', async () => {
    const references = withReference()
    const failing = {
      references,
      secret: SECRET,
      today: () => '2026-08-12',
      send: async () => {
        throw new Error('Bot Connector said no')
      },
    }
    const failed = await handleNotify(reminder, SECRET, failing)
    assert.equal(failed.status, 503)

    // The retry must get through, not be swallowed by the once-a-day rule.
    const transport = spy()
    const retry = await handleNotify(reminder, SECRET, {
      references,
      send: transport.send,
      secret: SECRET,
      today: () => '2026-08-12',
    })
    assert.deepEqual(retry.body, { delivered: true })
    assert.equal(transport.sent.length, 1)
  })

  it('still refuses someone who has never opened the bot', async () => {
    const result = await handleNotify({ ...reminder, employeeId: 'EMP-NOBODY' }, SECRET, {
      references: withReference(),
      send: spy().send,
      secret: SECRET,
    })
    assert.equal(result.status, 404)
  })
})

describe('the conversation store', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hrgenie-refs-'))
  const file = join(directory, 'references.json')

  after(() => rmSync(directory, { recursive: true, force: true }))

  it('survives a restart', () => {
    const first = new References(file)
    first.save('EMP1', REFERENCE)

    // A new process, reading the same file.
    const second = new References(file)
    assert.deepEqual(second.get('EMP1'), REFERENCE)
    assert.deepEqual(second.known(), ['EMP1'])
  })

  it('starts empty when there is no file yet', () => {
    const fresh = new References(join(directory, 'not-written-yet.json'))
    assert.deepEqual(fresh.known(), [])
  })

  it('keeps the newest reference for an employee', () => {
    const references = new References()
    references.save('EMP1', { conversation: { id: 'old' } } as never)
    references.save('EMP1', { conversation: { id: 'new' } } as never)
    assert.equal(references.known().length, 1)
    assert.match(JSON.stringify(references.get('EMP1')), /new/)
  })
})
