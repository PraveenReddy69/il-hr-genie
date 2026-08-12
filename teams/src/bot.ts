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
      await this.asCaller(context, async () => {
        await this.remember(context)
        const state = this.stateFor(context)
        const replies = await handle(state, {
          text: context.activity.text ?? undefined,
          action: actionFrom(context.activity),
        })
        await this.send(context, replies)
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
   * `api.signIn()` falls back to the shared account — which is what keeps the
   * Emulator and `npm run try` working with no bot registration.
   *
   * A failed exchange is not fatal here. Falling through to the shared account would
   * be far worse than an error: the person would silently be shown a colleague's
   * tickets. So a failure is reported and the turn is refused.
   */
  private async asCaller(context: TurnContext, work: () => Promise<void>): Promise<void> {
    if (!this.sso) return work()

    let session: api.Session | null
    try {
      session = await this.sso.sessionFor(context)
    } catch (error) {
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

    // Falls back to the configured account when the backend cannot be reached, so a
    // notification can still be delivered to whoever is testing.
    const employeeId = await api.gateway
      .signIn()
      .then((session) => session.employeeId)
      .catch(() => process.env.HRGENIE_EMPLOYEE_ID)

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

  private stateFor(context: TurnContext): ConversationState {
    const id = context.activity.conversation?.id ?? 'unknown'
    const existing = this.states.get(id)
    if (existing) return existing
    const created = newState()
    this.states.set(id, created)
    return created
  }

  private async send(context: TurnContext, replies: Reply[]): Promise<void> {
    for (const reply of replies) {
      if ('text' in reply) {
        await context.sendActivity(MessageFactory.text(reply.text))
      } else {
        await context.sendActivity(
          MessageFactory.attachment(CardFactory.adaptiveCard(reply.card)),
        )
      }
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
function actionFrom(activity: Partial<Activity>): CardAction | undefined {
  const value = activity.value as Record<string, unknown> | undefined
  if (!value || typeof value.kind !== 'string') return undefined

  switch (value.kind) {
    case 'startTicket':
    case 'myTickets':
    case 'raise':
    case 'cancel':
    case 'checkIn':
    case 'skipMoodDetail':
    case 'startPulse':
    case 'dismissNudge':
      return { kind: value.kind } as CardAction
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
