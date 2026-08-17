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

/**
 * The headline of a card, wherever it sits.
 *
 * Walks rather than indexing: the welcome card's header nests its text in a ColumnSet
 * so the mascot can sit beside it, and a fixed path broke the moment it did. The
 * headline is the first Large-or-bigger TextBlock, which is what a header is.
 */
const titleOf = (reply: Reply): string => {
  if ('text' in reply) return reply.text

  const found: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const item = node as Record<string, unknown>
    if (
      item.type === 'TextBlock' &&
      typeof item.text === 'string' &&
      (item.size === 'Large' || item.size === 'ExtraLarge')
    ) {
      found.push(item.text)
    }
    Object.values(item).forEach(walk)
  }
  walk(reply.card.body[0])
  return found[0] ?? ''
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

  it('offers the check-in once, from the nudge, never twice', async () => {
    // The menu tile could only ever be live when today was unanswered — which is
    // exactly when the nudge is already asking. Two buttons for one errand, and the
    // second did nothing because the first had opened the card.
    stubAll({ todaysMood: async () => null })
    const replies = JSON.stringify(await greet())

    assert.match(replies, /nudgeCheckIn/, 'the nudge asks')
    assert.doesNotMatch(replies, /"kind":"checkIn"/, 'the menu does not ask as well')
    assert.match(replies, /Raise a ticket/, 'the rest of the menu is untouched')
  })

  it('leaves no check-in button at all once today is answered', async () => {
    const replies = JSON.stringify(await greet())
    assert.doesNotMatch(replies, /checkIn/i, 'nothing offers something already done')
  })

  it('shows one set of faces however many times Check in is pressed', async () => {
    // Check in is reachable from the menu, the nudge, and every older copy of either
    // still sitting in the chat. Each press was answering with its own card.
    stubAll({ todaysMood: async () => null })
    const state = newState()

    const first = await handle(state, { action: { kind: 'checkIn' } })
    const second = await handle(state, { action: { kind: 'checkIn' } })
    const third = await handle(state, { action: { kind: 'checkIn' } })

    assert.equal(first.length, 1, 'the first press asks')
    // Not silence: Teams shows a typing indicator on every press, so nothing coming
    // back reads as a failure rather than as "already open".
    assert.match(titleOf(second[0]), /already open/i)
    assert.match(titleOf(third[0]), /already open/i)
    assert.equal(cards(second).length, 0, 'and no second set of faces')
  })

  it('asks again once the check-in has been finished', async () => {
    // The guard is about one card at a time, not about locking the flow shut: if the
    // save fails and the person starts over, the faces have to come back.
    stubAll({ todaysMood: async () => null })
    const state = newState()

    await handle(state, { action: { kind: 'checkIn' } })
    await handle(state, { action: { kind: 'pickMood', mood: 'GOOD' } })
    await handle(state, { action: { kind: 'saveMood' } })

    assert.equal(state.stage, 'idle')
    const again = await handle(state, { action: { kind: 'checkIn' } })
    assert.equal(again.length, 1)
  })

  it('shows what was already said, rather than asking again', async () => {
    stubAll({
      todaysMood: async () => ({
        mood: 'GOOD' as const,
        reasons: ['Workload'],
        note: null,
        dateIso: 'x',
      }),
    })
    const replies = JSON.stringify(await handle(newState(), { action: { kind: 'checkIn' } }))
    assert.match(replies, /Checked in/i, 'the answer already given')
    assert.doesNotMatch(replies, /How are you today/i, 'not the faces again')
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
    const short = await handle(state, { action: { kind: 'describe', subject: 'oops' } })
    assert.match(titleOf(short[0]), /little more/i)

    const draft = await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })
    // The card is headed by the category now; what was typed sits in its own panel.
    assert.match(cards(draft)[0], /Payroll/)
    assert.match(JSON.stringify(draft), /My payslip is missing from the portal/)

    const receipt = await handle(state, { action: { kind: 'raise' } })
    assert.equal(calls.raise, 1)
    assert.match(cards(receipt)[0], /HRG-0001/)
  })

  it('takes the subject from the box on the card', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'startTicket' } })
    const prompt = await handle(state, {
      action: { kind: 'pickCategory', category: 'Payroll' },
    })
    // The card asks for the subject and carries somewhere to put it.
    assert.match(JSON.stringify(prompt), /"type":"Input.Text","id":"subject"/)

    const draft = await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })
    assert.match(JSON.stringify(draft), /My payslip is missing from the portal/)

    const receipt = await handle(state, { action: { kind: 'raise' } })
    assert.equal(calls.raise, 1)
    assert.match(cards(receipt)[0], /HRG-0001/)
  })

  it('keeps asking when the box was sent empty', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })

    const empty = await handle(state, { action: { kind: 'describe', subject: '   ' } })
    assert.match(titleOf(empty[0]), /add a line/i)

    // Still waiting, so the card with the box must not be retired underneath them.
    assert.equal(state.stage, 'awaitingSubject')
  })

  it('files one ticket when Raise is pressed twice', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })

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
    await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })

    const failed = await handle(state, { action: { kind: 'raise' } })
    assert.match(titleOf(failed[0]), /still here/i)

    // And a retry works without starting over.
    stubAll()
    const receipt = await handle(state, { action: { kind: 'raise' } })
    assert.equal(calls.raise, 1)
    assert.match(cards(receipt)[0], /HRG-0001/)
  })

  it('does not take a typed sentence as the subject', async () => {
    // Both the subject card and the draft carry a text box, and that box is where a
    // subject comes from. Treating the chat as a second one meant a passing question
    // became a ticket: "help me" was long enough to qualify, so it filed itself.
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })

    const replies = await handle(state, { text: 'What is the leave policy?' })

    assert.equal(state.subject, undefined, 'nothing was filed')
    assert.match(JSON.stringify(replies), /Twelve days/, 'it was answered as a question')
  })

  it('lets "genie" out of a half-finished ticket', async () => {
    // The words people reach for when lost were being swallowed by the flow.
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })

    const replies = await handle(state, { text: 'help' })

    assert.equal(state.stage, 'idle', 'the draft is abandoned')
    assert.match(JSON.stringify(replies), /Raise a ticket/, 'and the menu opens')
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
      // Nothing done yet today, so every flow is genuinely open.
      stubAll({ todaysMood: async () => null })
      const titles = cards(await handle(newState(), { text: typed }))
      assert.match(titles[0], expected)
    })
  }

  it('sends anything else to the knowledge base', async () => {
    const replies = await handle(newState(), { text: 'How many leaves do I have left?' })
    assert.match(JSON.stringify(replies), /Twelve days/)
  })

  for (const greeting of ['hello', 'Hi', 'hey!', 'good morning', 'ok', 'thanks', 'there']) {
    it(`"${greeting}" is answered here, not by the policy library`, async () => {
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
      assert.equal(asked, null, 'small talk must not reach the knowledge base')

      // A hello, not the menu: six tiles for every "ok" is noise, and it teaches
      // nobody the one word that does open the menu.
      assert.match(JSON.stringify(replies), /HR Genie/)
      assert.match(JSON.stringify(replies), /genie/i)
      assert.doesNotMatch(JSON.stringify(replies), /Monthly pulse/, 'not the full menu')
    })
  }

  for (const opener of ['genie', 'Genie', 'help', 'menu', 'HR Genie']) {
    it(`"${opener}" opens the menu`, async () => {
      const replies = await handle(newState(), { text: opener })
      assert.match(JSON.stringify(replies), /Raise a ticket/)
      assert.match(JSON.stringify(replies), /Around the team/)
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
    await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })
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
    await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })
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
    const replies = await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })

    assert.equal(replies.length, 1, 'one activity, not a line plus a card')
    assert.ok('card' in replies[0])
    assert.match(JSON.stringify(replies[0]), /nothing has gone to HR yet/i)
  })
})

describe('editing the draft before raising', () => {
  async function atDraft() {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing from the portal' },
    })
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
    assert.match(JSON.stringify(replies), /HR Genie/, 'a greeting is answered as one')
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

describe('changing the category without leaving the card', () => {
  it('offers the other categories as a dropdown on the same card', async () => {
    const state = newState()
    const replies = await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })
    const card = JSON.stringify(replies)

    assert.match(card, /"type":"Input.ChoiceSet","id":"category"/, 'a dropdown, not a second card')
    assert.match(card, /"value":"Payroll"/, 'opening on the one already chosen')
    assert.match(card, /"title":"Leave"/, 'and offering the others')
    assert.doesNotMatch(card, /Change category/, 'the escape hatch is gone')
  })

  it('takes the category from the dropdown when Continue is pressed', async () => {
    // The point of the dropdown: switching category costs nothing that was typed.
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })

    await handle(state, {
      action: { kind: 'describe', subject: 'My laptop will not start', category: 'Leave' },
    })

    assert.equal(state.category, 'Leave', 'the dropdown wins')
    assert.equal(state.subject, 'My laptop will not start', 'and nothing typed is lost')
  })

  it('keeps the chosen category when the dropdown is left alone', async () => {
    const state = newState()
    await handle(state, { action: { kind: 'pickCategory', category: 'Payroll' } })

    await handle(state, {
      action: { kind: 'describe', subject: 'My payslip is missing', category: 'Payroll' },
    })

    assert.equal(state.category, 'Payroll')
  })
})

/**
 * The command list Teams shows under "View prompts".
 *
 * Picking one sends its title as an ordinary message, so every title in
 * appPackage/manifest.json has to be a phrase the flow already understands. A command
 * that lands in the knowledge base looks broken in a way nothing else does — the
 * person picked it from a menu we wrote.
 */
describe('the Teams command list', () => {
  const commands = ['Main Menu', 'Raise a ticket', 'My tickets', 'Check in', 'Holidays']

  for (const command of commands) {
    it(`"${command}" does what the menu says`, async () => {
      let askedTheLibrary = false
      stubAll({
        todaysMood: async () => null,
        askKnowledgeBase: async () => {
          askedTheLibrary = true
          return { text: 'should not be reached', source: null }
        },
      })

      const replies = await handle(newState(), { text: command })

      assert.equal(askedTheLibrary, false, `"${command}" fell through to the policy library`)
      assert.ok(replies.length > 0, `"${command}" produced nothing`)
    })
  }

  it('"Main Menu" opens the menu itself', async () => {
    const replies = JSON.stringify(await handle(newState(), { text: 'Main Menu' }))
    assert.match(replies, /Raise a ticket/)
    assert.match(replies, /Popular questions/)
    assert.doesNotMatch(replies, /Monthly pulse/, "the pulse belongs to the nudge")
  })
})

describe('looking a ticket up by its reference', () => {
  it('shows that ticket when the reference is complete', async () => {
    stubAll({ myTickets: async () => [ticket('HRG-0024', 'IN_PROGRESS', 'Chasing payroll.')] })
    const replies = JSON.stringify(await handle(newState(), { text: 'HRG-0024' }))

    assert.match(replies, /HRG-0024/)
    assert.match(replies, /Chasing payroll/, 'and what HR said about it')
  })

  it('finds it inside a sentence, and pads a short number', async () => {
    // People write "what is happening with HRG-24", not just the reference.
    stubAll({ myTickets: async () => [ticket('HRG-0024')] })
    const replies = JSON.stringify(
      await handle(newState(), { text: 'any update on HRG-24 please?' }),
    )
    assert.match(replies, /HRG-0024/)
  })

  it('asks for the whole reference when it is not one', async () => {
    const replies = await handle(newState(), { text: 'HRG-' })
    assert.match(titleOf(replies[0]), /whole reference/i)
    assert.match(titleOf(replies[0]), /HRG-0024/, 'showing the shape')
  })

  it('says plainly when it is not one of theirs', async () => {
    // Only ever the caller's own list: a reference is easy to guess, and HRG-0024 is
    // one away from HRG-0023.
    stubAll({ myTickets: async () => [ticket('HRG-0001')] })
    const replies = await handle(newState(), { text: 'HRG-0099' })

    assert.match(titleOf(replies[0]), /cannot find HRG-0099/i)
  })

  it('never asks the policy library about a reference', async () => {
    let asked = false
    stubAll({
      myTickets: async () => [ticket('HRG-0024')],
      askKnowledgeBase: async () => {
        asked = true
        return { text: 'nope', source: null }
      },
    })
    await handle(newState(), { text: 'HRG-0024' })
    assert.equal(asked, false)
  })
})
