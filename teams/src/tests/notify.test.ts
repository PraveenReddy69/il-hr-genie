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
import { References, handleNotify, type TicketMoved } from '../notify.js'

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
  const sent: TicketMoved[] = []
  return {
    sent,
    send: async (_reference: unknown, one: TicketMoved) => {
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
    assert.equal(transport.sent[0].comment, 'Deduction reversed.')
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
    assert.equal(transport.sent[0].status, 'IN_PROGRESS')
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
