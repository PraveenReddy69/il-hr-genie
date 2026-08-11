/**
 * What the bot says, and when.
 *
 * Deliberately free of Bot Framework types: this takes a message and some state and
 * returns replies. That is what makes the whole flow testable from a script with no
 * Teams, no Azure and no Microsoft account — the adapter in `bot.ts` is a thin shell
 * around it.
 */

import * as api from './api.js'
import {
  answerCard,
  categoryCard,
  draftCard,
  receiptCard,
  ticketsCard,
  welcomeCard,
  type AdaptiveCard,
  type CardAction,
} from './cards.js'

/** Where a conversation is in the ticket flow. Nothing else needs remembering. */
export interface ConversationState {
  stage: 'idle' | 'awaitingCategory' | 'awaitingSubject' | 'awaitingConfirm'
  category?: string
  subject?: string
  /** True while a raise is in flight. See the note in [handle]. */
  raising?: boolean
}

export function newState(): ConversationState {
  return { stage: 'idle' }
}

export type Reply = { text: string } | { card: AdaptiveCard }

export interface Input {
  /** Typed text, if the employee typed rather than pressed a button. */
  text?: string
  /** The `data` payload of an Adaptive Card action, if they pressed one. */
  action?: CardAction
}

export async function greet(): Promise<Reply[]> {
  const session = await api.signIn().catch(() => null)
  const firstName = session?.name?.split(' ')[0] ?? 'there'
  return [{ card: welcomeCard(firstName) }]
}

export async function handle(state: ConversationState, input: Input): Promise<Reply[]> {
  const action = input.action
  const text = (input.text ?? '').trim()

  if (action) return handleAction(state, action)
  if (!text) return []

  // Typed shortcuts, so the bot works for people who never press buttons.
  if (state.stage === 'idle') {
    if (/^(raise|new|open)\b.*\bticket\b/i.test(text) || /^raise a ticket$/i.test(text)) {
      return startTicket(state)
    }
    if (/^my tickets$/i.test(text) || /\bmy tickets\b/i.test(text)) {
      return listTickets()
    }
  }

  switch (state.stage) {
    case 'awaitingCategory':
      // Typing the category name works as well as pressing it.
      return handleAction(state, { kind: 'pickCategory', category: text })

    case 'awaitingSubject':
      return takeSubject(state, text)

    case 'awaitingConfirm':
      // Anything typed here is treated as a correction to the subject rather than an
      // answer to the buttons — retyping is the common case, and the alternative is
      // silently ignoring what they wrote.
      return takeSubject(state, text)

    case 'idle':
      return askKnowledgeBase(text)
  }
}

async function handleAction(state: ConversationState, action: CardAction): Promise<Reply[]> {
  switch (action.kind) {
    case 'startTicket':
      return startTicket(state)

    case 'myTickets':
      return listTickets()

    case 'pickCategory': {
      state.stage = 'awaitingSubject'
      state.category = action.category
      return [
        {
          text:
            'Got it. Tell me what\'s happening in a line or two — I\'ll put it in the ticket as ' +
            'you write it.',
        },
      ]
    }

    case 'cancel': {
      reset(state)
      return [{ text: 'No problem, I\'ve dropped it. Nothing was sent to HR.' }]
    }

    case 'raise':
      return raise(state)
  }
}

async function startTicket(state: ConversationState): Promise<Reply[]> {
  reset(state)
  state.stage = 'awaitingCategory'
  const names = await api.categories().catch(() => [
    'Payroll',
    'Leave',
    'IT & access',
    'Insurance',
    'Facilities',
    'Something else',
  ])
  return [{ card: categoryCard(names) }]
}

const MIN_SUBJECT = 6

async function takeSubject(state: ConversationState, subject: string): Promise<Reply[]> {
  if (subject.length < MIN_SUBJECT) {
    return [{ text: 'Give me a little more to go on — a sentence is plenty.' }]
  }

  const session = await api.signIn().catch(() => null)
  state.subject = subject
  state.stage = 'awaitingConfirm'
  return [
    { text: 'Here\'s what I\'ll send. Check it over and I\'ll raise it.' },
    {
      card: draftCard(
        subject,
        state.category ?? 'Something else',
        session ? `${session.name} · ${session.employeeId}` : 'you',
      ),
    },
  ]
}

async function raise(state: ConversationState): Promise<Reply[]> {
  if (!state.subject) {
    return [{ text: 'There\'s no draft to raise — say "raise a ticket" and we\'ll start one.' }]
  }

  // One ticket per press. The card stays on screen while the request is in flight, and
  // Teams will happily deliver a second press — which on the Android app filed a
  // duplicate before it was guarded the same way.
  if (state.raising) return []
  state.raising = true

  try {
    const ticket = await api.raiseTicket(state.subject, state.category ?? 'Something else')
    reset(state)
    return [{ card: receiptCard(ticket) }]
  } catch (error) {
    // The draft is deliberately kept so they can try again without retyping it.
    state.stage = 'awaitingConfirm'
    return [
      {
        text:
          'I couldn\'t reach HR just then, so nothing was raised. Your draft is still here — ' +
          `press Raise it to try again. (${message(error)})`,
      },
    ]
  } finally {
    state.raising = false
  }
}

async function listTickets(): Promise<Reply[]> {
  try {
    return [{ card: ticketsCard(await api.myTickets()) }]
  } catch (error) {
    return [{ text: `I couldn't fetch your tickets just then. (${message(error)})` }]
  }
}

/**
 * Answers from the policy knowledge base, or says it could not.
 *
 * No stand-in answer when the service is unreachable. Guessing at notice periods or
 * encashment caps would be inventing company policy, and an employee acting on a guess
 * could be materially out of pocket — the Android app makes the same call.
 */
async function askKnowledgeBase(question: string): Promise<Reply[]> {
  try {
    const answer = await api.askKnowledgeBase(question)
    return [{ card: answerCard(answer.text, answer.source) }]
  } catch (error) {
    return [
      {
        text:
          'I couldn\'t reach the policy library just then, so I don\'t want to guess. Try again ' +
          `in a moment, or say "raise a ticket" and I'll put it to HR. (${message(error)})`,
      },
    ]
  }
}

function reset(state: ConversationState): void {
  state.stage = 'idle'
  state.category = undefined
  state.subject = undefined
  state.raising = false
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
