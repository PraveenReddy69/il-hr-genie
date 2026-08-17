/**
 * What the bot says, and when.
 *
 * Deliberately free of Bot Framework types: this takes a message and some state and
 * returns replies. That is what makes the whole flow testable from a script with no
 * Teams, no Azure and no Microsoft account — the adapter in `bot.ts` is a thin shell
 * around it.
 */

import * as api from './api.js'
import { holidaysFor } from './holidays.js'
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
  oneTicketCard,
  holidaysCard,
  helloCard,
  subjectPromptCard,
  welcomeCard,
  type AdaptiveCard,
  type CardAction,
} from './cards.js'

/**
 * The word that opens the menu.
 *
 * One word, said the same way every time, is worth more than a dozen phrasings that
 * each work once: it is something a person can remember and reuse. `help` comes along
 * because it is what everybody tries first anyway.
 */
const OPENS_MENU = /^(genie|hr ?genie|help|menu|main ?menu)[!.?\s]*$/i

/**
 * A ticket reference, anywhere in what was typed.
 *
 * People paste "HRG-0024", and they also write "what is happening with HRG-24" — so
 * this looks anywhere in the message rather than anchoring, and pads a short number
 * to the four digits the service issues.
 */
const TICKET_REFERENCE = /\bHRG[-\s]?(\d{1,6})\b/i

/**
 * A reference-shaped thing with the wrong letters, and the word that gives it away.
 *
 * "I want to know about my ticket HRF-0024" is a question about a ticket however it
 * is spelled, and sending it to the policy library — which is what happened — answers
 * with every policy it has. Both halves are required: a bare code in a sentence about
 * leave is not a reference, and the word "ticket" alone is not one either.
 */
const REFERENCE_SHAPED = /\b([A-Za-z]{2,5})[-\s]?(\d{1,6})\b/
const ABOUT_A_TICKET = /\b(ticket|reference|status|complaint)\b/i

/** "HRG", "HRG-", "HRG 1" — enough to mean a ticket, not enough to find one. */
const MENTIONS_A_TICKET = /\bHRG\b/i

/**
 * Words people type without asking for anything.
 *
 * Greetings, acknowledgements, and the half-typed openers of a question that never
 * arrived. Kept here rather than looked up: none of them need the server, and a
 * failed lookup on "hi" is a bot that looks broken on the first message.
 *
 * Deliberately exact matches. "thanks" is small talk; "thanks, what is the leave
 * policy" is a question, and the difference is the whole point of anchoring.
 */
const SMALL_TALK: ReadonlySet<string> = new Set([
  'hi', 'hii', 'hiii', 'hey', 'heyy', 'hello', 'helo', 'hlo', 'yo', 'hai',
  'good morning', 'good afternoon', 'good evening', 'good night', 'gm', 'ge',
  'there', 'where', 'what', 'who', 'how', 'why', 'when',
  'ok', 'okay', 'okk', 'k', 'fine', 'sure', 'yes', 'yeah', 'yep', 'no', 'nope',
  'thanks', 'thank you', 'thankyou', 'ty', 'thx', 'cool', 'nice', 'great',
  'test', 'testing', 'hmm', 'hm', 'oh', 'bye', 'ok bye', 'good', 'welcome',
  'anyone', 'anybody', 'hello?', 'are you there', 'u there', 'you there',
])

function isSmallTalk(text: string): boolean {
  // Trailing punctuation and emphasis are noise: "hi!!!" and "ok..." are the same
  // word. Anything left after that has to match a whole entry.
  const word = text
    .toLowerCase()
    .replace(/[!.?,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return SMALL_TALK.has(word)
}

/** Where a conversation is in the ticket flow. Nothing else needs remembering. */
export interface ConversationState {
  stage:
    | 'idle'
    | 'awaitingCategory'
    | 'awaitingSubject'
    | 'awaitingConfirm'
    /** The faces are on screen, waiting for one to be picked. */
    | 'awaitingMood'
    | 'awaitingMoodDetail'
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
  const session = await api.gateway.signIn().catch(() => null)
  const firstName = session?.name?.split(' ')[0] ?? 'there'

  const [mood, pulse, unseen] = await Promise.all([
    api.gateway.todaysMood().catch(() => undefined),
    api.gateway.thisCyclesPulse().catch(() => undefined),
    api.gateway.unseenTickets().catch(() => []),
  ])

  const replies: Reply[] = []

  // What HR did comes first. It is the only thing here the employee is owed an
  // answer to, and it is answering a question they already asked.
  if (unseen.length > 0) {
    replies.push({ card: updatesCard(unseen) })
    // Only after it has been shown — see markTicketsSeen.
    await api.gateway.markTicketsSeen().catch(() => undefined)
  }

  // `undefined` means the question could not be asked. Nudging on a failed read
  // would tell people to do something they may already have done.
  const nudge = nudgeCard(firstName, { mood: mood === null, pulse: pulse === null })
  if (nudge) replies.push({ card: nudge })

  replies.push({ card: welcomeCard(firstName) })

  /*
   * No celebrations here.
   *
   * They are a pleasant aside, not something the greeting owes anyone — and once
   * there is a tile on the menu and a tab of their own, leading with a list of ten
   * birthdays pushes the things someone actually came to do off the screen. Ask for
   * them and they are one tap away.
   */
  return replies
}

export async function handle(state: ConversationState, input: Input): Promise<Reply[]> {
  const action = input.action
  const text = (input.text ?? '').trim()

  if (action) return handleAction(state, action)
  if (!text) return []

  /*
   * Typed shortcuts, at any point in a flow.
   *
   * These used to run only when idle, which meant that mid-ticket the words people
   * reach for when they are lost — "genie", "help" — were swallowed by whatever the
   * flow was waiting for. Typing "help me" while a ticket was waiting for its subject
   * made "help me" the subject and produced a draft nobody asked for.
   *
   * An explicit intent outranks an unfinished flow. Someone typing "my tickets" wants
   * their tickets, not to have those words filed as a payroll complaint.
   */
  if (OPENS_MENU.test(text)) {
    reset(state)
    return greet()
  }

  /*
   * Small talk gets an answer, not a menu and not the policy library.
   *
   * Everything unmatched falls through to the knowledge base, so "hello" used to be
   * put to the policy library — which answers nothing useful, and in Teams failed
   * outright and made the bot look broken on the very first message.
   *
   * The flow is left alone: a stray "ok" should not throw away a half-written ticket.
   */
  if (isSmallTalk(text)) {
    return [{ card: helloCard() }]
  }

  if (/^(raise|new|open)\b.*\bticket\b/i.test(text) || /^raise a ticket$/i.test(text)) {
    return startTicket(state)
  }
  if (/^my tickets$/i.test(text) || /\bmy tickets\b/i.test(text)) {
    reset(state)
    return listTickets()
  }
  if (/\bcheck ?-?in\b/i.test(text) || /^mood$/i.test(text) || /how am i\b/i.test(text)) {
    return startCheckIn(state)
  }
  if (/\bpulse\b/i.test(text) || /\bsurvey\b/i.test(text)) {
    reset(state)
    return startPulse()
  }
  // On the command list, so it arrives as typed text when picked from Teams' menu.
  if (/^holidays?$/i.test(text) || /\bholiday list\b/i.test(text)) {
    reset(state)
    return showHolidays()
  }

  /*
   * A ticket reference is a question about that ticket.
   *
   * Someone who types HRG-0024 wants to know where it got to, and asking the policy
   * library about it — which is where it used to go — answers nothing at all.
   */
  const reference = text.match(TICKET_REFERENCE)
  if (reference) {
    reset(state)
    return showTicket(`HRG-${reference[1].padStart(4, '0')}`)
  }
  if (MENTIONS_A_TICKET.test(text)) {
    return [
      { text: 'Give me the whole reference and I will look it up — they read like HRG-0024.' },
    ]
  }

  if (ABOUT_A_TICKET.test(text)) {
    /*
     * A ticket question with the reference mistyped, or with only a number.
     *
     * "my ticket HRF-0024" went to the policy library and came back with every policy
     * we have — a long answer to a question nobody asked. A number on its own is
     * taken as a reference, because "ticket 24" means HRG-0024 and nothing else.
     */
    const shaped = text.match(REFERENCE_SHAPED)
    if (shaped) {
      return [
        {
          text: `${shaped[0]} does not look like one of ours — references start with HRG, like HRG-0024. Send me the whole one, or say "my tickets" to see them all.`,
        },
      ]
    }

    const bare = text.match(/\b(\d{1,6})\b/)
    if (bare) {
      reset(state)
      return showTicket(`HRG-${bare[1].padStart(4, '0')}`)
    }
  }

  switch (state.stage) {
    case 'awaitingCategory':
      // Typing the category name works as well as pressing it — but only a real one.
      // Anything else was being sent to the server as a category and rejected there,
      // which is a round trip to say something we already knew.
      return takeTypedCategory(state, text)

    case 'awaitingSubject':
    case 'awaitingConfirm':
      /*
       * The card has a box; the chat is not it.
       *
       * Both of these cards carry a text field, and that field is where a subject
       * comes from. Treating whatever is typed into the chat as the subject too meant
       * a passing question became a ticket — and there is no way to tell the two
       * apart, because both are just a sentence.
       *
       * So a sentence is a question. The draft is still on screen with its box, and
       * nothing about it is lost by answering something else first.
       */
      return askKnowledgeBase(text)

    case 'awaitingMood':
      // The faces are on screen and none has been picked. There is nothing sensible
      // to do with a sentence yet — a question is more likely than a mood, so it goes
      // where questions go, and the card stays where it is.
      return askKnowledgeBase(text)

    case 'awaitingMoodDetail':
      // Typing here is taken as the note, since that is the only free-text field on
      // the card they are looking at.
      return saveMood(state, [], text)

    case 'idle':
      return askKnowledgeBase(text)
  }
}

/**
 * Actions that take the employee somewhere else entirely.
 *
 * Anything here abandons a half-finished ticket, because it is a different errand.
 * Leaving the flow where it was is how "Hi" became a ticket category: the picker was
 * still waiting, three cards further up, long after the person had moved on.
 */
const LEAVES_TICKET_FLOW: ReadonlySet<string> = new Set([
  'holidays',
  'team',
  'myTickets',
  'checkIn',
  'startPulse',
  'nudgeCheckIn',
  'nudgePulse',
])

async function handleAction(state: ConversationState, action: CardAction): Promise<Reply[]> {
  /*
   * A repeat press of Check in, before the reset below can hide it.
   *
   * `checkIn` abandons a half-finished ticket, which is right — but the reset also
   * clears the stage that says a set of faces is already on screen, so the guard in
   * the case below never saw it and every press answered with another card. Asked
   * and answered here instead, ahead of the reset.
   */
  if (
    (action.kind === 'checkIn' || action.kind === 'nudgeCheckIn') &&
    (state.stage === 'awaitingMood' || state.stage === 'awaitingMoodDetail')
  ) {
    /*
     * A line, not silence.
     *
     * Returning nothing was correct — the card is already open — but Teams shows a
     * typing indicator the moment a button is pressed, so nothing arriving after it
     * reads as a failure rather than as "already done". Older nudges stay pressable
     * for as long as the chat is scrollable, so this is reachable indefinitely.
     */
    return [{ text: 'The check-in is already open just above — pick a face there.' }]
  }

  if (LEAVES_TICKET_FLOW.has(action.kind)) reset(state)

  switch (action.kind) {
    case 'startTicket':
      return startTicket(state)

    case 'myTickets':
      return listTickets()

    case 'holidays':
      return showHolidays()

    case 'team':
      return showTeam()

    case 'pickCategory': {
      state.stage = 'awaitingSubject'
      state.category = action.category
      // The full list rides along so the card can offer a dropdown. A failed read is
      // not worth blocking on: the card falls back to the one already chosen.
      const names = await api.gateway.categories().catch(() => [])
      // A card, not a line. The picker above is retired once a category is chosen —
      // a card cannot be restyled after submit, so six identical tiles are no record
      // of the decision. This names it instead.
      return [{ card: subjectPromptCard(action.category, names) }]
    }

    case 'cancel': {
      /*
       * With nothing to drop, say nothing.
       *
       * Pressing Cancel on a card left over from a ticket that had already been filed
       * answered "Nothing was sent to HR" — which was untrue, and about the most
       * alarming thing to read after raising something. The card is removed on raise
       * now, so this is the second line of defence rather than the first.
       */
      if (!state.subject) return []
      reset(state)
      return [{ text: 'No problem, I\'ve dropped it. Nothing was sent to HR.' }]
    }

    // The box on the subject card. Typing into the chat still works and lands in the
    // same place — see [takeSubject] — so nobody who ignores the field is stuck.
    case 'describe': {
      // The dropdown rides along with Continue, so a category changed on the card is
      // simply the category now — no second card, and nothing typed is lost.
      const chosen = (action.category ?? '').trim()
      if (chosen) state.category = chosen

      const typed = (action.subject ?? '').trim()
      if (!typed) {
        return [{ text: 'Add a line about what is happening and press Continue.' }]
      }
      return takeSubject(state, typed)
    }

    case 'raise':
      return raise(state, action.subject)

    // A pill on the welcome card. The words are ours rather than typed, so they go
    // straight to the knowledge base without the small-talk and shortcut checks a
    // typed message goes through.
    case 'ask':
      return askKnowledgeBase(action.question)

    case 'checkIn':
    case 'nudgeCheckIn':
      // A repeat press never reaches here — see the guard at the top of this function.
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

    case 'nudgePulse':
    case 'startPulse':
      return startPulse()

    case 'savePulse':
      return savePulse(action)

    case 'dismissNudge':
      return [{ text: 'No problem. Say “check in” whenever you want to.' }]
  }
}

/**
 * The monthly pulse, unless it is already done.
 *
 * Answered this cycle, it says so rather than presenting the form again. A pulse is
 * once a month by design — re-asking invites second-guessing, and an answer changed
 * on a whim is worse data than the first honest one. The Android app behaves the same.
 *
 * A failed read of this cycle's answers falls through to the questions: better to
 * offer the form to someone who has already answered than to refuse someone who has
 * not.
 */
async function startPulse(): Promise<Reply[]> {
  try {
    const [questions, answers] = await Promise.all([
      api.gateway.pulseQuestions(),
      api.gateway.thisCyclesPulse().catch(() => null),
    ])
    if (answers && Object.keys(answers).length >= questions.length && questions.length > 0) {
      return [{ card: pulseDoneCard(questions.length, questions.length) }]
    }
    return [{ card: pulseCard(questions) }]
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
    await api.gateway.savePulse(answers)
    return [{ card: pulseDoneCard(Object.keys(answers).length, Math.max(total, 1)) }]
  } catch (error) {
    return [{ text: `I couldn’t send that just then, so nothing was recorded. (${message(error)})` }]
  }
}

/**
 * One ticket, by reference.
 *
 * Only ever from the caller's own list. The service would happily return somebody
 * else's ticket if asked by id, and a reference is easy to guess — HRG-0024 is one
 * away from HRG-0023 — so the lookup happens here, against tickets already known to
 * belong to this person.
 */
async function showTicket(id: string): Promise<Reply[]> {
  try {
    const mine = await api.gateway.myTickets()
    const found = mine.find((ticket) => ticket.id.toUpperCase() === id.toUpperCase())
    if (!found) {
      return [
        {
          text: `I cannot find ${id} among your tickets. Check the reference, or say "my tickets" to see them all.`,
        },
      ]
    }
    return [{ card: oneTicketCard(found) }]
  } catch (error) {
    return [{ text: `I could not reach your tickets just then. (${message(error)})` }]
  }
}

async function startCheckIn(state: ConversationState): Promise<Reply[]> {
  reset(state)
  try {
    const today = await api.gateway.todaysMood()
    /*
     * Once a day, and the answer already given is the answer.
     *
     * The tile comes off the menu after a check-in, but the menu is not the only way
     * in — an older card is still pressable, and "check in" can be typed. Showing the
     * faces again offers something that cannot be done today, and worse, invites
     * someone to answer twice and wonder which one counted. Same shape as the pulse.
     */
    if (today) {
      return [{ card: moodDoneCard(today.mood, today.reasons ?? [], today.note ?? null) }]
    }
    state.stage = 'awaitingMood'
    return [{ card: moodCard(null) }]
  } catch (error) {
    // Not being able to read today's answer is no reason to block a new one.
    state.stage = 'awaitingMood'
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
    await api.gateway.saveMood(mood, reasons, note)
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

/**
 * The calendar, from chat.
 *
 * Local data, so this cannot fail — see holidays.ts for why it is not fetched.
 */
async function showHolidays(): Promise<Reply[]> {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  const todayIso = `${now.getFullYear()}-${month}-${day}`
  return [{ card: holidaysCard(holidaysFor(now.getFullYear()), todayIso) }]
}

/** Today's birthdays and anniversaries, from chat rather than only the tab. */
async function showTeam(): Promise<Reply[]> {
  const party = await api.gateway.celebrations().catch(() => null)
  const card = party ? celebrationsCard(party) : null
  if (!card) {
    return [{ text: 'Nothing to celebrate today. Worth another look tomorrow.' }]
  }
  return [{ card }]
}

/**
 * A typed category, matched against the real list.
 *
 * Case-insensitive, because nobody types "IT & access" exactly. No match re-shows the
 * picker rather than guessing — a wrong category is HR's problem to move later, and a
 * made-up one is a failed request.
 */
async function takeTypedCategory(state: ConversationState, text: string): Promise<Reply[]> {
  const names = await api.gateway.categories().catch(() => [] as string[])
  const match = names.find((name) => name.toLowerCase() === text.toLowerCase())
  if (match) return handleAction(state, { kind: 'pickCategory', category: match })

  return [
    { text: `I do not have a category called “${text}”. Pick one of these.` },
    { card: categoryCard(names.length ? names : ['Payroll', 'Leave', 'Something else']) },
  ]
}

async function startTicket(state: ConversationState): Promise<Reply[]> {
  reset(state)
  state.stage = 'awaitingCategory'
  const names = await api.gateway.categories().catch(() => [
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

  const session = await api.gateway.signIn().catch(() => null)
  state.subject = subject
  state.stage = 'awaitingConfirm'
  /*
   * One activity, not two.
   *
   * The line used to be a separate message above the card. When the card retires on
   * raise, the line stayed — leaving "Check it over and I'll raise it" sitting above
   * a ticket that had already been raised. A card can only be removed as a whole, so
   * anything that dies with it has to live inside it. The card carries the line now.
   */
  return [
    {
      card: draftCard(
        subject,
        state.category ?? 'Something else',
        session ? `${session.name} · ${session.employeeId}` : 'you',
      ),
    },
  ]
}

async function raise(state: ConversationState, edited?: string): Promise<Reply[]> {
  // Same reasoning as cancel: a second press on a spent card should do nothing at
  // all, not explain itself. The receipt above it already says what happened.
  if (!state.subject) return []

  /*
   * The draft's text box is editable, and what it holds at the moment of pressing is
   * what gets filed — otherwise the card could show one thing and send another.
   *
   * Emptied or trimmed to nothing, the card stays put rather than filing a blank
   * ticket or silently reverting to the original words.
   */
  if (edited !== undefined) {
    const trimmed = edited.trim()
    if (trimmed.length < MIN_SUBJECT) {
      return [{ text: 'Give me a little more to go on — a sentence is plenty. Nothing sent yet.' }]
    }
    state.subject = trimmed
  }

  // One ticket per press. The card stays on screen while the request is in flight, and
  // Teams will happily deliver a second press — which on the Android app filed a
  // duplicate before it was guarded the same way.
  if (state.raising) return []
  state.raising = true

  try {
    const ticket = await api.gateway.raiseTicket(state.subject, state.category ?? 'Something else')
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
    return [{ card: ticketsCard(await api.gateway.myTickets()) }]
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
    const answer = await api.gateway.askKnowledgeBase(question)
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
