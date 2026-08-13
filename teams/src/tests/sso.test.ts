/**
 * Identity: whose data a call is about.
 *
 * The bug this file exists to prevent is the worst one in the project — serving one
 * employee's HR records to another. It cannot be caught by trying the bot with a
 * single user, which is exactly how it would reach production.
 *
 * The Entra half (Teams → a token) is Microsoft's and needs a real registration, so it
 * is faked here. Everything else — scoping, caching, expiry, the fallback — is ours.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  asEmployee,
  currentSession,
  forgetSharedSession,
  gateway,
  type Session,
} from '../api.js'
import { Sso, type TokenSource } from '../sso.js'

const ALICE: Session = { employeeId: 'EMP1', name: 'Alice', token: 'token-alice' }
const BOB: Session = { employeeId: 'EMP2', name: 'Bob', token: 'token-bob' }

/** A turn from one person. Only the fields [Sso] reads. */
function turn(userId: string): never {
  return { activity: { from: { id: userId }, channelId: 'msteams' } } as never
}

function tokens(entra: string | null): TokenSource & { prompted: number } {
  return {
    prompted: 0,
    async entraToken() {
      return entra
    },
    async promptSignIn() {
      this.prompted += 1
    },
  }
}

describe('the identity in scope', () => {
  it('is the one the work was run as', async () => {
    await asEmployee(ALICE, async () => {
      assert.equal(currentSession()?.employeeId, 'EMP1')
    })
  })

  it('does not leak outside the work', async () => {
    await asEmployee(ALICE, async () => undefined)
    assert.equal(currentSession(), undefined)
  })

  it('does not leak between two people whose turns interleave', async () => {
    // The failure this guards: a plain module-level "current user" is correct until
    // two turns overlap at an await, and then it silently hands Alice's bearer to
    // Bob's request. Nothing about it looks wrong in a one-user test.
    const seen: string[] = []

    const slow = asEmployee(ALICE, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      seen.push(`alice saw ${currentSession()?.employeeId}`)
    })
    const fast = asEmployee(BOB, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      seen.push(`bob saw ${currentSession()?.employeeId}`)
    })

    await Promise.all([slow, fast])
    assert.deepEqual(seen, ['bob saw EMP2', 'alice saw EMP1'])
  })

  it('gives the scoped session to signIn, without any password', async () => {
    await asEmployee(ALICE, async () => {
      const session = await gateway.signIn()
      assert.equal(session.token, 'token-alice')
    })
  })

  it('refuses to sign in at all when no identity is in scope', async () => {
    // The security property the shared account used to break. Outside asEmployee
    // there is nobody to act as, and inventing one would serve a colleague's HR
    // record to whoever happened to be asking. Failing is the correct outcome.
    delete process.env.HRGENIE_DEV_TOKEN
    forgetSharedSession()

    await assert.rejects(
      () => gateway.signIn(),
      (error: Error) => /no signed-in employee/i.test(error.message),
    )
  })
})

describe('exchanging a Teams token', () => {
  it('trades it for the employee whose token it is', async () => {
    const source = tokens('entra-alice')
    const sso = new Sso(source, async (token) => {
      assert.equal(token, 'entra-alice')
      return ALICE
    })

    assert.deepEqual(await sso.sessionFor(turn('teams-alice')), ALICE)
    assert.equal(source.prompted, 0, 'a token was available; nobody should be prompted')
  })

  it('asks for sign-in when there is no token yet, and returns nothing', async () => {
    const source = tokens(null)
    const sso = new Sso(source, async () => ALICE)

    // null, not an error: the turn simply ends and the user comes back with a token.
    assert.equal(await sso.sessionFor(turn('teams-alice')), null)
    assert.equal(source.prompted, 1)
  })

  it('keeps two people apart', async () => {
    const byToken: Record<string, Session> = { 'entra-alice': ALICE, 'entra-bob': BOB }
    let whose = 'entra-alice'
    const sso = new Sso(
      { async entraToken() { return whose }, async promptSignIn() {} },
      async (token) => byToken[token],
    )

    const alice = await sso.sessionFor(turn('teams-alice'))
    whose = 'entra-bob'
    const bob = await sso.sessionFor(turn('teams-bob'))

    assert.equal(alice?.employeeId, 'EMP1')
    assert.equal(bob?.employeeId, 'EMP2', 'the cache is keyed by user, not shared')
  })

  it('reuses a session rather than logging in on every card press', async () => {
    let exchanges = 0
    const sso = new Sso(tokens('entra-alice'), async () => {
      exchanges += 1
      return ALICE
    })

    await sso.sessionFor(turn('teams-alice'))
    await sso.sessionFor(turn('teams-alice'))
    await sso.sessionFor(turn('teams-alice'))
    assert.equal(exchanges, 1)
  })

  it('exchanges again once the cached session is old', async () => {
    let exchanges = 0
    let clock = 0
    const sso = new Sso(
      tokens('entra-alice'),
      async () => {
        exchanges += 1
        return ALICE
      },
      () => clock,
    )

    await sso.sessionFor(turn('teams-alice'))
    clock = 29 * 60_000
    await sso.sessionFor(turn('teams-alice'))
    assert.equal(exchanges, 1, 'still fresh')

    clock = 31 * 60_000
    await sso.sessionFor(turn('teams-alice'))
    assert.equal(exchanges, 2, 'past the TTL, so re-checked with the backend')
  })

  it('forgets a session on request', async () => {
    let exchanges = 0
    const sso = new Sso(tokens('entra-alice'), async () => {
      exchanges += 1
      return ALICE
    })

    await sso.sessionFor(turn('teams-alice'))
    sso.forget('teams-alice')
    await sso.sessionFor(turn('teams-alice'))
    assert.equal(exchanges, 2)
  })

  it('refuses an activity with no sender rather than guessing', async () => {
    const sso = new Sso(tokens('entra-alice'), async () => ALICE)
    await assert.rejects(
      () => sso.sessionFor({ activity: { channelId: 'msteams' } } as never),
      /cannot identify you/i,
    )
  })

  it('surfaces a rejected token instead of falling back to the shared account', async () => {
    // Falling through would show this person someone else's tickets, which is far
    // worse than an error message.
    const sso = new Sso(tokens('entra-alice'), async () => {
      throw new Error('No employee record for alice@infinitylearn.com')
    })
    await assert.rejects(() => sso.sessionFor(turn('teams-alice')), /No employee record/)
  })
})
