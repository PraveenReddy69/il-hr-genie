/**
 * What the bot says, and when.
 *
 * Deliberately free of Bot Framework types: this takes a message and some state and
 * returns replies. That is what makes the whole flow testable from a script with no
 * Teams, no Azure and no Microsoft account — the adapter in `bot.ts` is a thin shell
 * around it.
 */

import * as api from './api.js'
import type { Mood } from './api.js'
import {
  answerCard,
  categoryCard,
  celebrationsCard,
  draftCard,
  updatesCard,
  moodCard,
  nudgeCard,
  pulseCard,
  pulseDoneCard,
  moodDetailCard,
  moodDoneCard,
  receiptCard,
  ticketsCard,
  welcomeCard,
  type AdaptiveCard,
  type CardAction,
} from './cards.js'

/** Where a conversation is in the ticket flow. Nothing else needs remembering. */
export interface ConversationState {
  stage: 'idle' | 'awaitingCategory' | 'awaitingSubject' | 'awaitingConfirm' | 'awaitingMoodDetail'
  category?: string
  subject?: string
  /** The face picked, waiting on reasons and a note. */
  mood?: Mood
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

/**
 * Opens the conversation, leading with whatever is outstanding.
 *
 * The nudge comes first and the menu second: someone who has not checked in today
 * should meet the ask, not a list of things they could do. When nothing is
 * outstanding there is no nudge at all — the point is to ask once, not to greet
 * everyone with a chore.
 *
 * This runs when the conversation is opened. Sending it unprompted, the way an
 * always-on assistant would, needs proactive messaging — a stored conversation
 * reference and a real bot registration. See the README.
 */
export async function greet(): Promise<Reply[]> {
  const session = await api.signIn().catch(() => null)
  const firstName = session?.name?.split(' ')[0] ?? 'there'

  const [mood, pulse, unseen, party] = await Promise.all([
    api.todaysMood().catch(() => undefined),
    api.thisCyclesPulse().catch(() => undefined),
    api.unseenTickets().catch(() => []),
    api.celebrations().catch(() => null),
  ])

  const replies: Reply[] = []

  // What HR did comes first. It is the only thing here the employee is owed an
  // answer to, and it is answering a question they already asked.
  if (unseen.length > 0) {
    replies.push({ card: updatesCard(unseen) })
    // Only after it has been shown — see markTicketsSeen.
    await api.markTicketsSeen().catch(() => undefined)
  }

  // `undefined` means the question could not be asked. Nudging on a failed read
  // would tell people to do something they may already have done.
  const nudge = nudgeCard(firstName, { mood: mood === null, pulse: pulse === null })
  if (nudge) replies.push({ card: nudge })

  replies.push({ card: welcomeCard(firstName) })

  // Last, and only when there is something: it is the pleasant part, not the point.
  const celebrating = party ? celebrationsCard(party) : null
  if (celebrating) replies.push({ card: celebrating })

  return replies
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
    if (/\bcheck ?-?in\b/i.test(text) || /^mood$/i.test(text) || /how am i\b/i.test(text)) {
      return startCheckIn(state)
    }
    if (/\bpulse\b/i.test(text) || /\bsurvey\b/i.test(text)) {
      return startPulse()
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

    case 'awaitingMoodDetail':
      // Typing here is taken as the note, since that is the only free-text field on
      // the card they are looking at.
      return saveMood(state, [], text)

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

    case 'checkIn':
      return startCheckIn(state)

    case 'pickMood': {
      state.stage = 'awaitingMoodDetail'
      state.mood = action.mood
      return [{ card: moodDetailCard(action.mood) }]
    }

    case 'saveMood': {
      // A multi-select ChoiceSet arrives as one comma-separated string.
      const reasons = (action.reasons ?? '')
        .split(',')
        .map((reason) => reason.trim())
        .filter(Boolean)
      return saveMood(state, reasons, action.note?.trim() || null)
    }

    case 'skipMoodDetail':
      return saveMood(state, [], null)

    case 'startPulse':
      return startPulse()

    case 'savePulse':
      return savePulse(action)

    case 'dismissNudge':
      return [{ text: 'No problem. Say “check in” whenever you want to.' }]
  }
}

async function startPulse(): Promise<Reply[]> {
  try {
    return [{ card: pulseCard(await api.pulseQuestions()) }]
  } catch (error) {
    return [{ text: `I couldn’t load this month’s questions just then. (${message(error)})` }]
  }
}

/**
 * Sends whatever was answered.
 *
 * Everything on the card except `kind` is an answer, keyed by question id — which is
 * how the card is built, so a question added server-side needs no change here.
 */
async function savePulse(action: { kind: string; [id: string]: string }): Promise<Reply[]> {
  const answers: Record<string, string> = {}
  for (const [id, value] of Object.entries(action)) {
    if (id !== 'kind' && typeof value === 'string' && value.trim()) answers[id] = value
  }

  const total = Object.keys(action).length - 1
  if (Object.keys(answers).length === 0) {
    return [{ text: 'Nothing was answered, so nothing was sent. Pick at least one and send again.' }]
  }

  try {
    await api.savePulse(answers)
    return [{ card: pulseDoneCard(Object.keys(answers).length, Math.max(total, 1)) }]
  } catch (error) {
    return [{ text: `I couldn’t send that just then, so nothing was recorded. (${message(error)})` }]
  }
}

async function startCheckIn(state: ConversationState): Promise<Reply[]> {
  reset(state)
  try {
    return [{ card: moodCard(await api.todaysMood()) }]
  } catch (error) {
    // Not being able to read today's answer is no reason to block a new one.
    return [{ card: moodCard(null) }, { text: `(Couldn't check today's answer: ${message(error)})` }]
  }
}

async function saveMood(
  state: ConversationState,
  reasons: string[],
  note: string | null,
): Promise<Reply[]> {
  const mood = state.mood
  if (!mood) {
    return [{ text: 'Pick a face first — say "check in" and I will show them.' }]
  }

  try {
    await api.saveMood(mood, reasons, note)
    reset(state)
    return [{ card: moodDoneCard(mood, reasons, note) }]
  } catch (error) {
    // The face is kept, so Save can be pressed again without starting over.
    return [
      {
        text:
          'I could not save that just then, so nothing was recorded. Press Save again in a ' +
          `moment. (${message(error)})`,
      },
    ]
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
  state.mood = undefined
  state.raising = false
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
