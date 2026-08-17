/**
 * The Teams shell around [conversation].
 *
 * Everything Teams-specific lives here: turning an incoming activity into an [Input],
 * and a [Reply] back into an activity. The flow itself knows nothing about any of it.
 */

import {
  ActivityHandler,
  CardFactory,
  MessageFactory,
  TurnContext,
  type Activity,
  type InvokeResponse,
} from 'botbuilder'
import * as api from './api.js'
import type { References } from './notify.js'
import { completeTokenExchange } from './sso.js'
import { greet, handle, newState, type ConversationState, type Reply } from './conversation.js'
import type { CardAction } from './cards.js'
import type { Sso } from './sso.js'

export class HrGenieBot extends ActivityHandler {
  /**
   * One state per conversation, in memory.
   *
   * Fine for a proof of concept and wrong for production: a restart forgets every
   * half-finished draft, and a second instance would not share them. Bot Framework's
   * ConversationState with a real store is the replacement.
   */
  private readonly states = new Map<string, ConversationState>()

  /**
   * Left undefined when SSO is not configured, which is what keeps the Emulator and
   * `npm run try` working with no bot registration — the bot falls back to the one
   * account in `.env`. Every turn is then that employee, which is why the app stays
   * sideloaded to one person until this is set.
   */
  constructor(
    private readonly references?: References,
    private readonly sso?: Sso,
    private readonly ssoConnectionName?: string,
  ) {
    super()

    this.onMessage(async (context, next) => {
      /*
       * Say something immediately.
       *
       * Pressing a tile does nothing visible until the reply lands, and a reply that
       * waits on the HR service can take a second or two. Teams' own "Your response
       * was sent to the app" is a grey line most people never notice, so the card
       * looks unresponsive and gets pressed again.
       *
       * A typing indicator is ephemeral — it leaves nothing in the transcript — and
       * it is sent before any work starts, which is the whole point. Failing to send
       * it must never cost the turn.
       */
      await context.sendActivity({ type: 'typing' }).catch(() => undefined)

      await this.asCaller(context, async () => {
        await this.remember(context)
        const state = this.stateFor(context)
        const action = actionFrom(context.activity)
        const replies = await handle(state, {
          text: context.activity.text ?? undefined,
          action,
        })
        const sent = await this.send(context, replies)
        await this.retireCard(context, action, state)
        await this.supersedePrompt(context, action, sent)
      })
      await next()
    })

    // Teams sends this when the app is installed or the conversation starts.
    this.onMembersAdded(async (context, next) => {
      await this.asCaller(context, async () => {
        await this.remember(context)
        const botId = context.activity.recipient?.id
        const joined = (context.activity.membersAdded ?? []).filter(
          (member) => member.id !== botId,
        )
        if (joined.length > 0) await this.send(context, await greet())
      })
      await next()
    })
  }

  /**
   * Runs the turn as whoever sent it.
   *
   * With SSO configured, the Entra token is exchanged for an HR Genie session and
   * every API call inside `work` uses it. Without it, `work` runs unscoped and
   * `api.signIn()` has nothing to return, so the turn fails loudly rather than
   * quietly acting as somebody else.
   *
   * A failed exchange is not fatal here, but it does end the turn. There is no shared
   * account to fall through to any more — that was removed with SSO — and inventing
   * one would silently show a colleague's tickets.
   */
  private async asCaller(context: TurnContext, work: () => Promise<void>): Promise<void> {
    if (!this.sso) return work()

    let session: api.Session | null
    try {
      session = await this.sso.sessionFor(context)
    } catch (error) {
      // A 404 means Teams proved who you are and our own backend has not been taught
      // to accept it yet — a different problem from a failed sign-in, and worth saying
      // so plainly. Remove once /api/auth/teams ships; see docs/TEAMS_SSO_BACKEND.md.
      if (error instanceof api.ApiError && error.status === 404) {
        await context.sendActivity(
          'Teams confirmed who you are, but the HR service cannot accept that yet — ' +
            'the sign-in endpoint is still being built. Nothing was opened.',
        )
        return
      }
      const why = error instanceof Error ? error.message : String(error)
      await context.sendActivity(
        `I could not confirm who you are, so I have not opened anything. ${why}`,
      )
      return
    }

    // A sign-in was requested; the user will be back with a token in a moment. Not an
    // error, and not something to narrate — with SSO they see nothing at all.
    if (!session) return

    await api.asEmployee(session, work)
  }

  /**
   * Keeps the conversation so HR can be pushed into it later.
   *
   * Written on every turn rather than only on install: a reference goes stale when
   * Teams moves a conversation, and the cheapest way to hold a current one is to
   * refresh it whenever the person speaks.
   *
   * Runs inside [asCaller], so with SSO configured `signIn` returns the sender's own
   * session and the reference is stored under their employee id. Without it, every
   * conversation is stored under the one configured account.
   */
  private async remember(context: TurnContext): Promise<void> {
    if (!this.references) return

    // No fallback: a reference saved under a guessed employee id would deliver one
    // person's ticket updates into another person's chat.
    const employeeId = await api.gateway
      .signIn()
      .then((session) => session.employeeId)
      .catch(() => undefined)

    if (!employeeId) return
    this.references.save(employeeId, TurnContext.getConversationReference(context.activity))
  }

  /**
   * Teams completing the silent sign-in.
   *
   * It answers the OAuth card by invoking `signin/tokenExchange` with a token. Handing
   * that to the token service is what makes it available on the next turn — and the
   * user sees none of it.
   *
   * A `200` with an empty body is the documented acknowledgement. Anything else is
   * passed to the base handler.
   */
  protected async onInvokeActivity(context: TurnContext): Promise<InvokeResponse> {
    if (context.activity.name === 'signin/tokenExchange' && this.ssoConnectionName) {
      const done = await completeTokenExchange(context, this.ssoConnectionName)
      if (done) return { status: 200 }
    }
    return super.onInvokeActivity(context)
  }

  /**
   * Cards whose form is spent once it has been submitted.
   *
   * A check-in that has been saved still shows its checkboxes and its Save button,
   * which read as live and are not — pressing Save again re-submits an answer that
   * has already been recorded. The confirmation card below it is the record now, so
   * the form is removed rather than left as a decoy.
   *
   * Only forms. The menus and pickers are worth keeping: someone scrolling back
   * should still be able to raise a second ticket from the welcome card.
   */
  private static readonly SPENT: ReadonlySet<string> = new Set([
    'saveMood',
    'skipMoodDetail',
    'savePulse',
    // Raise and Cancel finish the draft they sit on. Leaving that card behind is
    // worse than untidy: pressing Cancel on an already-filed ticket answered
    // "Nothing was sent to HR", which is simply untrue. Retired only once the draft
    // is actually gone — see [retireCard] — so a failed raise keeps the card and the
    // subject that was typed into it.
    'raise',
    'cancel',
    // The picker cannot show which of six tiles was chosen — a card is fixed once
    // sent. It is replaced by one naming the category instead.
    'pickCategory',
    // Same for the five faces: the detail card below names the mood that was picked,
    // so the row of faces is spent the moment one is chosen.
    'pickMood',
    // The subject box. Once it has been accepted the draft below holds the words and
    // is the thing to edit; leaving the empty box above it invites a second attempt
    // at describing a ticket that already exists. Kept when the text was rejected —
    // see [retireCard].
    'describe',
    // Change replaces this card with the picker, and the subject travels with it. The
    // box left behind would hold a copy of words that now live in state — edit that
    // one and the edit is lost, because the card that comes back is the one that
    // counts.
    'changeCategory',
    // The nudge is a prompt, and a prompt that has been answered is a decoy: its
    // buttons stay pressable, so the same nudge could be acted on again tomorrow from
    // a scroll-back. Retired whichever of the three is pressed. The welcome menu is
    // deliberately not in here — it fires the plain `checkIn` and `startPulse`, and
    // it is meant to survive being used.
    'nudgeCheckIn',
    'nudgePulse',
    'dismissNudge',
  ])

  /**
   * Removes the card an action came from.
   *
   * Deliberately after the replies are sent, so a turn that throws leaves the form —
   * and whatever was typed into it — where the person can try again. Failing to
   * delete is not worth reporting: the card is stale, not broken, and an error about
   * housekeeping helps nobody mid-conversation.
   */
  private async retireCard(
    context: TurnContext,
    action: CardAction | undefined,
    state: ConversationState,
  ): Promise<void> {
    const source = context.activity.replyToId
    if (!action || !source || !HrGenieBot.SPENT.has(action.kind)) return

    // A raise that failed leaves the draft in state on purpose, so the subject does
    // not have to be retyped. The card it was typed into has to survive with it.
    if ((action.kind === 'raise' || action.kind === 'cancel') && state.subject) return

    // Too short, or empty: the answer was not accepted, so the box has to stay. The
    // stage only moves on once there is a subject worth showing back.
    if (action.kind === 'describe' && state.stage === 'awaitingSubject') return

    try {
      await context.deleteActivity(source)
    } catch {
      // Teams refuses after its edit window, and some channels never allow it.
    }
  }

  private stateFor(context: TurnContext): ConversationState {
    const id = context.activity.conversation?.id ?? 'unknown'
    const existing = this.states.get(id)
    if (existing) return existing
    const created = newState()
    this.states.set(id, created)
    return created
  }

  /** Sends the replies and hands back their activity ids, so one can be superseded. */
  private async send(context: TurnContext, replies: Reply[]): Promise<string[]> {
    const sent: string[] = []
    for (const reply of replies) {
      const activity =
        'text' in reply
          ? MessageFactory.text(reply.text)
          : MessageFactory.attachment(CardFactory.adaptiveCard(reply.card))
      const response = await context.sendActivity(activity)
      if (response?.id) sent.push(response.id)
    }
    return sent
  }

  /**
   * The category prompt, which only the newest of should exist.
   *
   * Choosing again — via Change category — otherwise leaves a card per attempt, each
   * still offering to change the category it names. Only the last one is true, so the
   * previous is removed as the new one arrives.
   *
   * Keyed by conversation and held here rather than in [ConversationState]: which
   * message is on screen is a Teams concern, and `conversation.ts` is deliberately
   * free of them.
   */
  private readonly lastPrompt = new Map<string, string>()

  private async supersedePrompt(
    context: TurnContext,
    action: CardAction | undefined,
    sent: string[],
  ): Promise<void> {
    if (!action) return
    const key = context.activity.conversation?.id ?? 'unknown'
    const spends = action.kind === 'raise' || action.kind === 'cancel'
    if (action.kind !== 'pickCategory' && !spends) return

    const previous = this.lastPrompt.get(key)
    if (previous) {
      this.lastPrompt.delete(key)
      try {
        await context.deleteActivity(previous)
      } catch {
        // Past Teams' edit window, or a channel that forbids it. Not worth reporting.
      }
    }
    // The prompt is whatever a category choice just produced; a raise leaves none.
    if (action.kind === 'pickCategory' && sent.length > 0) {
      this.lastPrompt.set(key, sent[sent.length - 1])
    }
  }
}

/**
 * The payload of an Adaptive Card button press.
 *
 * Ticket updates and celebrations need nothing here — they are produced by the
 * greeting rather than by anything anyone presses.
 *
 * Teams delivers it as `activity.value` on a message with no text. Anything without a
 * recognised `kind` is ignored rather than guessed at — a stray submit from an old
 * card should do nothing, not something surprising.
 */
/**
 * The action a card press carried, however Teams chose to deliver it.
 *
 * A `messageBack` submit — which is what makes a tap show up as a message from the
 * person, see `submit` in cards.ts — puts the payload in one of two places depending
 * on the client: as `activity.value` directly, or JSON-encoded inside
 * `msteams.value`. Reading both costs nothing and means a tile cannot silently do
 * nothing on one platform.
 */
function payloadOf(activity: Partial<Activity>): Record<string, unknown> | undefined {
  const value = activity.value as Record<string, unknown> | undefined
  if (!value) return undefined
  if (typeof value.kind === 'string') return value

  const nested = (value.msteams as { value?: unknown } | undefined)?.value
  if (typeof nested === 'string') {
    try {
      const parsed = JSON.parse(nested) as Record<string, unknown>
      return typeof parsed?.kind === 'string' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  if (nested && typeof (nested as Record<string, unknown>).kind === 'string') {
    return nested as Record<string, unknown>
  }
  return undefined
}

function actionFrom(activity: Partial<Activity>): CardAction | undefined {
  const value = payloadOf(activity)
  if (!value || typeof value.kind !== 'string') return undefined

  switch (value.kind) {
    case 'startTicket':
    case 'myTickets':
    case 'cancel':
    case 'checkIn':
    case 'skipMoodDetail':
    case 'startPulse':
    case 'holidays':
    case 'team':
    case 'dismissNudge':
    case 'nudgeCheckIn':
    case 'nudgePulse':
      return { kind: value.kind } as CardAction
    case 'raise':
      // The draft's text box rides along with the press. Whatever is in it wins.
      return { kind: 'raise', subject: value.subject === undefined ? undefined : String(value.subject) }
    case 'ask':
      return { kind: 'ask', question: String(value.question ?? '') }
    case 'describe':
      // Same for the subject card's box.
      return {
        kind: 'describe',
        subject: value.subject === undefined ? undefined : String(value.subject),
      }
    case 'changeCategory':
      // Change is a submit, so the subject box rides along with it. That is the whole
      // mechanism: without this line, reopening the picker throws away what was typed.
      return {
        kind: 'changeCategory',
        subject: value.subject === undefined ? undefined : String(value.subject),
      }
    case 'savePulse':
      // Every other key is a question id — see savePulse in conversation.ts.
      return value as unknown as CardAction
    case 'pickCategory':
      return { kind: 'pickCategory', category: String(value.category ?? '') }
    case 'pickMood':
      return { kind: 'pickMood', mood: String(value.mood ?? 'OKAY') as never }
    case 'saveMood':
      // Input values ride along with the action's own data on submit.
      return {
        kind: 'saveMood',
        reasons: value.reasons === undefined ? undefined : String(value.reasons),
        note: value.note === undefined ? undefined : String(value.note),
      }
    default:
      return undefined
  }
}
