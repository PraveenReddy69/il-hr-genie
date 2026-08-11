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
} from 'botbuilder'
import { greet, handle, newState, type ConversationState, type Reply } from './conversation.js'
import type { CardAction } from './cards.js'

export class HrGenieBot extends ActivityHandler {
  /**
   * One state per conversation, in memory.
   *
   * Fine for a proof of concept and wrong for production: a restart forgets every
   * half-finished draft, and a second instance would not share them. Bot Framework's
   * ConversationState with a real store is the replacement.
   */
  private readonly states = new Map<string, ConversationState>()

  constructor() {
    super()

    this.onMessage(async (context, next) => {
      const state = this.stateFor(context)
      const replies = await handle(state, {
        text: context.activity.text ?? undefined,
        action: actionFrom(context.activity),
      })
      await this.send(context, replies)
      await next()
    })

    // Teams sends this when the app is installed or the conversation starts.
    this.onMembersAdded(async (context, next) => {
      const botId = context.activity.recipient?.id
      const joined = (context.activity.membersAdded ?? []).filter((member) => member.id !== botId)
      if (joined.length > 0) await this.send(context, await greet())
      await next()
    })
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
      return { kind: value.kind } as CardAction
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
