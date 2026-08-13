/**
 * The conversation, with no network.
 *
 * Everything here runs against a fake gateway, so these tests need no backend, no
 * Azure and no Microsoft account — which is the point of keeping the flow free of
 * Bot Framework types in the first place.
 *
 * What is worth testing is not "does a card come back" but the decisions: that one
 * press files one ticket, that a failure keeps what the employee typed, and that
 * nothing is marked seen before it has been shown.
 */

import { strict as assert } from 'node:assert'
import { after, beforeEach, describe, it } from 'node:test'
import { gateway, liveGateway, type Ticket } from '../api.js'
import { greet, handle, newState, type Reply } from '../conversation.js'

// ------------------------------------------------------------------ the fake

interface Calls {
  raise: number
  saveMood: number
  savePulse: number
  markSeen: number
}

let calls: Calls

function ticket(id: string, status: Ticket['status'] = 'OPEN', comment?: string): Ticket {
  return {
    id,
    subject: `Subject for ${id}`,
    category: 'Payroll',
    status,
    createdAtMillis: 1,
    updatedAtMillis: 2,
    comments: comment ? [{ status, text: comment, authorId: 'HR000', atMillis: 2 }] : [],
  }
}

/** A gateway where everything succeeds and nothing is outstanding. */
function stubAll(overrides: Partial<typeof gateway> = {}): void {
  Object.assign(gateway, {
    signIn: async () => ({ employeeId: 'EMP1', name: 'Test Person', token: 't' }),
    askKnowledgeBase: async () => ({ text: 'Twelve days.', source: 'Leave Policy' }),
    raiseTicket: async () => {
      calls.raise += 1
      return ticket('HRG-0001')
    },
    myTickets: async () => [ticket('HRG-0001')],
    categories: async () => ['Payroll', 'Leave'],
    todaysMood: async () => ({ mood: 'GOOD' as const, reasons: [], note: null, dateIso: 'x' }),
    saveMood: async () => {
      calls.saveMood += 1
    },
    thisCyclesPulse: async () => ({}),
    pulseQuestions: async () => [
      { id: 'experience', text: 'How was it?', hint: '', options: ['Good', 'Bad'] },
    ],
    savePulse: async () => {
      calls.savePulse += 1
    },
    unseenTickets: async () => [],
    markTicketsSeen: async () => {
      calls.markSeen += 1
    },
    celebrations: async () => ({ birthdays: [], anniversaries: [], newJoiners: [] }),
    ...overrides,
  })
}

beforeEach(() => {
  calls = { raise: 0, saveMood: 0, savePulse: 0, markSeen: 0 }
  stubAll()
})

after(() => {
  Object.assign(gateway, liveGateway)
})

// --------------------------------------------------------------- assertions

const titleOf = (reply: Reply): string => {
  if ('text' in reply) return reply.text
  const header = (reply.card.body[0] as { items?: { text?: string }[] }).items ?? []
  return header[1]?.text ?? ''
}

const cards = (replies: Reply[]): string[] => replies.filter((r) => 'card' in r).map(titleOf)

// ------------------------------------------------------------------- greeting

describe('opening the conversation', () => {
  it('shows only the menu when nothing is outstanding', async () => {
    const replies = await greet()
    assert.equal(replies.length, 1)
    assert.match(titleOf(replies[0]), /Hi Test/)
  })

  it('nudges when today has no check-in', async () => {
    stubAll({ todaysMood: async () => null })
    const titles = cards(await greet())
    assert.match(titles[0], /how are you today/i)
  })

  it('does not nudge when the check-in cannot be read', async () => {
    // A failed read must not become "you have not checked in" — that tells people to
    // redo something they may already have done.
    stubAll({
      todaysMood: async () => {
        throw new Error('offline')
      },
    })
    const titles = cards(await greet())
    assert.equal(titles.length, 1, 'menu only')
  })

  it("leads with what HR did, and marks it seen only after showing it", async () => {
    stubAll({ unseenTickets: async () => [ticket('HRG-0007', 'RESOLVED', 'Fixed in August.')] })
    const replies = await greet()
    assert.match(titleOf(replies[0]), /HR moved/)
    assert.equal(calls.markSeen, 1)
  })

  it('marks nothing seen when there is nothing to show', async () => {
    await greet()
    assert.equal(calls.markSeen, 0, 'marking seen with no updates would hide the next one')
  })

  it('quotes what HR actually wrote', async () => {
    stubAll({ unseenTickets: async () => [ticket('HRG-0007', 'RESOLVED', 'Deduction reversed.')] })
    const [update] = await greet()
    assert.match(JSON.stringify(update), /Deduction reversed/)
  })
})

// --------------------------------------------------------------- ticket flow

describe('raising a ticket', () => {
  it('walks category, subject, draft, receipt', async () => {
    const state = newState()
    assert.match(cards(await handle(state, { action: { kind: 'startTicket' } }))[0], /about/i)

    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    const short = await handle(state, { text: 'oops' })
    assert.match(titleOf(short[0]), /little more/i)

    const draft = await handle(state, { text: 'My payslip is missing from the portal' })
    // The card is headed by the category now; what was typed sits in its own panel.
    assert.match(cards(draft)[0], /Payroll/)
    assert.match(JSON.stringify(draft), /My payslip is missing from the portal/)

    const receipt = await handle(state, { action: { kind: 'raise' } })
    assert.equal(calls.raise, 1)
    assert.match(cards(receipt)[0], /HRG-0001/)
  })

  it('files one ticket when Raise is pressed twice', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, { text: 'My payslip is missing from the portal' })

    // Both presses in flight at once, which is what a double click produces.
    const [first, second] = await Promise.all([
      handle(state, { action: { kind: 'raise' } }),
      handle(state, { action: { kind: 'raise' } }),
    ])

    assert.equal(calls.raise, 1, 'a second press must not file a second ticket')
    assert.equal(second.length, 0, 'the second press produces nothing')
    assert.match(cards(first)[0], /HRG-0001/)
  })

  it('keeps the draft when raising fails, so nothing is retyped', async () => {
    stubAll({
      raiseTicket: async () => {
        throw new Error('server down')
      },
    })
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, { text: 'My payslip is missing from the portal' })

    const failed = await handle(state, { action: { kind: 'raise' } })
    assert.match(titleOf(failed[0]), /still here/i)

    // And a retry works without starting over.
    stubAll()
    const receipt = await handle(state, { action: { kind: 'raise' } })
    assert.equal(calls.raise, 1)
    assert.match(cards(receipt)[0], /HRG-0001/)
  })

  it('treats typing at the draft as a corrected subject', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, { text: 'First attempt at the subject' })
    const again = await handle(state, { text: 'Second attempt at the subject' })
    assert.match(JSON.stringify(again), /Second attempt/)
    assert.equal(calls.raise, 0, 'typing must not file anything')
  })
})

// ----------------------------------------------------------------- check-in

describe('the mood check-in', () => {
  it('saves the face, the reasons and the note', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickMood', mood: 'STRESSED' } })
    const done = await handle(state, {
      action: { kind: 'saveMood', reasons: 'Workload, Deadlines', note: ' Release week. ' },
    })
    assert.equal(calls.saveMood, 1)
    assert.match(cards(done)[0], /Stressed/i)
  })

  it('saves the face alone when the detail is skipped', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickMood', mood: 'GREAT' } })
    await handle(state, { action: { kind: 'skipMoodDetail' } })
    assert.equal(calls.saveMood, 1)
  })

  it('will not save without a face', async () => {
    const replies = await handle(newState(), { action: { kind: 'skipMoodDetail' } })
    assert.equal(calls.saveMood, 0)
    assert.match(titleOf(replies[0]), /pick a face/i)
  })

  it('keeps the face when saving fails, so Save can be pressed again', async () => {
    stubAll({
      saveMood: async () => {
        throw new Error('server down')
      },
    })
    const state = newState()
    await handle(state, { action: { kind: 'pickMood', mood: 'OKAY' } })
    const failed = await handle(state, { action: { kind: 'skipMoodDetail' } })
    assert.match(titleOf(failed[0]), /nothing was recorded/i)

    stubAll()
    await handle(state, { action: { kind: 'skipMoodDetail' } })
    assert.equal(calls.saveMood, 1, 'the face survived the failure')
  })
})

// -------------------------------------------------------------------- pulse

describe('the monthly pulse', () => {
  it('sends only the questions that were answered', async () => {
    const sent: Record<string, string>[] = []
    stubAll({
      savePulse: async (answers) => {
        sent.push(answers)
        calls.savePulse += 1
      },
    })
    await handle(newState(), {
      action: { kind: 'savePulse', experience: 'Good', workload: '', manager: 'Usually' },
    })
    assert.equal(calls.savePulse, 1)
    assert.deepEqual(sent[0], { experience: 'Good', manager: 'Usually' })
  })

  it('sends nothing when nothing was answered', async () => {
    const replies = await handle(newState(), {
      action: { kind: 'savePulse', experience: '', workload: '' },
    })
    assert.equal(calls.savePulse, 0)
    assert.match(titleOf(replies[0]), /nothing was answered/i)
  })
})

// -------------------------------------------------------- typed shortcuts

describe('typing instead of pressing', () => {
  const shortcuts: [string, RegExp][] = [
    ['raise a ticket', /about/i],
    ['my tickets', /with HR|Nothing with HR/i],
    ['check in', /how are you today/i],
    ['pulse', /Four questions/i],
  ]

  for (const [typed, expected] of shortcuts) {
    it(`"${typed}" starts the right flow`, async () => {
      const titles = cards(await handle(newState(), { text: typed }))
      assert.match(titles[0], expected)
    })
  }

  it('sends anything else to the knowledge base', async () => {
    const replies = await handle(newState(), { text: 'How many leaves do I have left?' })
    assert.match(JSON.stringify(replies), /Twelve days/)
  })

  for (const greeting of ['hello', 'Hi', 'hey!', 'good morning', 'menu']) {
    it(`"${greeting}" opens the menu rather than asking the policy library`, async () => {
      // Everything unmatched falls through to the knowledge base, which is how
      // "hello" became a policy question and failed on the first message anyone
      // ever sent the bot.
      let asked: string | null = null
      stubAll({
        askKnowledgeBase: async (question: string) => {
          asked = question
          return { text: 'should not be reached', source: null }
        },
      })
      const replies = await handle(newState(), { text: greeting })
      assert.equal(asked, null, 'a greeting must not reach the knowledge base')
      assert.match(JSON.stringify(replies), /Raise a ticket/)
    })
  }

  it('still sends a question that merely starts like a greeting', async () => {
    // "hi" must not swallow "hire policy" — the shortcut is anchored for this.
    const replies = await handle(newState(), { text: 'hiring policy for interns?' })
    assert.match(JSON.stringify(replies), /Twelve days/, 'should have gone to the knowledge base')
  })

  it('never invents an answer when the knowledge base is unreachable', async () => {
    stubAll({
      askKnowledgeBase: async () => {
        throw new Error('offline')
      },
    })
    const replies = await handle(newState(), { text: "What is the notice period?" })
    const said = titleOf(replies[0])
    assert.match(said, /couldn|could not/i)
    assert.doesNotMatch(said, /\b(30|60|90) days\b/, 'must not guess at policy')
  })
})

describe('a spent ticket draft', () => {
  async function raised() {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, { text: 'My payslip is missing from the portal' })
    await handle(state, { action: { kind: 'raise' } })
    return state
  }

  it('says nothing when Raise is pressed again after filing', async () => {
    const state = await raised()
    assert.deepEqual(await handle(state, { action: { kind: 'raise' } }), [])
    assert.equal(calls.raise, 1, 'and files nothing more')
  })

  it('never claims nothing was sent once something was', async () => {
    // The bug this exists for: Cancel on an already-filed ticket answered "Nothing
    // was sent to HR", which is untrue and alarming right after raising something.
    const state = await raised()
    const replies = await handle(state, { action: { kind: 'cancel' } })
    assert.deepEqual(replies, [])
    assert.doesNotMatch(JSON.stringify(replies), /Nothing was sent/)
  })

  it('still confirms a real cancel, with a draft on screen', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, { text: 'My payslip is missing from the portal' })
    const replies = await handle(state, { action: { kind: 'cancel' } })
    assert.match(JSON.stringify(replies), /Nothing was sent to HR/)
  })
})

describe('the ticket draft', () => {
  it('is a single card, so nothing survives it being retired', async () => {
    // The line "Check it over and I'll raise it" used to be its own message. The card
    // is removed once the ticket is filed; the line was not, and ended up sitting
    // above a raised ticket telling the reader to check it over.
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    const replies = await handle(state, { text: 'My payslip is missing from the portal' })

    assert.equal(replies.length, 1, 'one activity, not a line plus a card')
    assert.ok('card' in replies[0])
    assert.match(JSON.stringify(replies[0]), /nothing has gone to HR yet/i)
  })
})

describe('editing the draft before raising', () => {
  async function atDraft() {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, { text: 'My payslip is missing from the portal' })
    return state
  }

  it('files what is in the box, not what was first typed', async () => {
    let filed = ''
    stubAll({
      raiseTicket: async (subject: string) => {
        filed = subject
        calls.raise += 1
        return ticket('HRG-0001')
      },
    })
    const state = await atDraft()
    await handle(state, { action: { kind: 'raise', subject: 'My July payslip is missing entirely' } })
    assert.equal(filed, 'My July payslip is missing entirely')
  })

  it('refuses an emptied box rather than filing a blank ticket', async () => {
    const state = await atDraft()
    const replies = await handle(state, { action: { kind: 'raise', subject: '   ' } })
    assert.match(JSON.stringify(replies), /little more to go on/)
    assert.equal(calls.raise, 0, 'nothing filed')
    // And the draft survives, so the original words are not lost.
    assert.equal(state.subject, 'My payslip is missing from the portal')
  })

  it('still works when the card sends no subject at all', async () => {
    const state = await atDraft()
    await handle(state, { action: { kind: 'raise' } })
    assert.equal(calls.raise, 1)
  })
})

describe('the monthly pulse, once answered', () => {
  it('says it is done rather than asking again', async () => {
    // Once a month by design. Re-presenting the form invites second-guessing, and an
    // answer changed on a whim is worse data than the first honest one.
    stubAll({ thisCyclesPulse: async () => ({ experience: 'Good' }) })
    const replies = await handle(newState(), { action: { kind: 'startPulse' } })
    const text = JSON.stringify(replies)
    assert.doesNotMatch(text, /Input\.ChoiceSet/, 'no form')
    assert.match(text, /pulse|done|thank/i)
  })

  it('still asks when this cycle has no answers', async () => {
    stubAll({ thisCyclesPulse: async () => ({}) })
    const replies = await handle(newState(), { action: { kind: 'startPulse' } })
    assert.match(JSON.stringify(replies), /How was it\?/)
  })

  it('asks rather than refuses when the answers cannot be read', async () => {
    // Offering the form to someone who has answered is a smaller harm than refusing
    // someone who has not.
    stubAll({
      thisCyclesPulse: async () => {
        throw new Error('offline')
      },
    })
    const replies = await handle(newState(), { action: { kind: 'startPulse' } })
    assert.match(JSON.stringify(replies), /How was it\?/)
  })
})

describe('leaving a half-finished ticket', () => {
  it('does not treat the next thing typed as a category', async () => {
    // The bug: Raise a ticket → Holidays → "Hi" filed "Hi" as the category. The
    // picker was still waiting three cards up, long after the person moved on.
    const state = newState()
    await handle(state, { action: { kind: 'startTicket' } })
    await handle(state, { action: { kind: 'holidays' } })
    assert.equal(state.stage, 'idle', 'holidays abandons the draft')

    const replies = await handle(state, { text: 'Hi' })
    assert.equal(state.category, undefined, '"Hi" must not become a category')
    assert.match(JSON.stringify(replies), /Raise a ticket/, 'a greeting opens the menu')
  })

  for (const kind of ['team', 'myTickets', 'checkIn', 'startPulse'] as const) {
    it(`"${kind}" also abandons the draft`, async () => {
      const state = newState()
      await handle(state, { action: { kind: 'startTicket' } })
      await handle(state, { action: { kind } })
      assert.notEqual(state.stage, 'awaitingCategory')
    })
  }

  it('refuses a category that does not exist instead of asking the server', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'startTicket' } })
    const replies = await handle(state, { text: 'Nonsense' })
    assert.match(JSON.stringify(replies), /do not have a category/)
    assert.equal(state.category, undefined)
  })

  it('still accepts a real category typed in any case', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'startTicket' } })
    await handle(state, { text: 'payroll' })
    assert.equal(state.category, 'Payroll')
    assert.equal(state.stage, 'awaitingSubject')
  })
})
