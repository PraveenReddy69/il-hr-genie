/**
 * Who is talking to the bot.
 *
 * Teams knows: the user is already signed in to it against Entra ID. This turns that
 * into an HR Genie session, so the bot acts as the person in front of it rather than
 * as the one shared account in `.env`.
 *
 * Two hops, and it is worth keeping them apart:
 *
 *   1. Teams → an Entra access token for this user (the Bot Framework token service)
 *   2. That token → an HR Genie bearer (our backend verifies it and maps the email)
 *
 * Hop 2 is ours and is tested below. Hop 1 is Microsoft's and cannot be exercised
 * without a real bot registration, which is why it sits behind [TokenSource] — the
 * rest of this file is decidable offline.
 */

import type { TurnContext } from 'botbuilder'
import { CloudAdapterBase } from 'botbuilder'
import type { UserTokenClient } from 'botframework-connector'
import * as api from './api.js'

/**
 * The Entra half, narrowed to what we use.
 *
 * `null` from [entraToken] means "not signed in yet" — a normal first-run state, not
 * a failure.
 */
export interface TokenSource {
  entraToken(context: TurnContext): Promise<string | null>
  /** Asks Teams to sign the user in. Silent when SSO is configured. */
  promptSignIn(context: TurnContext): Promise<void>
}

/**
 * How long an exchanged session is reused before going back to the backend.
 *
 * Short enough that a revoked account stops working the same morning, long enough
 * that a burst of card presses is not a burst of logins. The backend's own expiry
 * still applies underneath — see [Sso.forget].
 */
const SESSION_TTL_MILLIS = 30 * 60_000

interface Cached {
  session: api.Session
  atMillis: number
}

export class Sso {
  private readonly byUser = new Map<string, Cached>()

  constructor(
    private readonly tokens: TokenSource,
    private readonly exchange: (token: string) => Promise<api.Session> = (token) =>
      api.gateway.exchangeTeamsToken(token),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The session for whoever sent this activity.
   *
   * `null` means a sign-in has been requested and this turn is over — the user will
   * be back in a moment with a token. It is not an error and must not be reported as
   * one; with SSO configured they will not even see a prompt.
   */
  async sessionFor(context: TurnContext): Promise<api.Session | null> {
    const userId = context.activity.from?.id
    if (!userId) throw new Error('This message carries no sender, so I cannot identify you.')

    const cached = this.byUser.get(userId)
    if (cached && this.now() - cached.atMillis < SESSION_TTL_MILLIS) return cached.session

    const entra = await this.tokens.entraToken(context)
    if (!entra) {
      await this.tokens.promptSignIn(context)
      return null
    }

    const session = await this.exchange(entra)
    this.byUser.set(userId, { session, atMillis: this.now() })
    return session
  }

  /** Drops a cached session — after a 401, or on sign-out. */
  forget(userId: string): void {
    this.byUser.delete(userId)
  }
}

/**
 * The real Entra half, over the Bot Framework token service.
 *
 * Untested, and untestable until there is a bot registration: every call here goes to
 * Microsoft. Everything decidable was kept out of it deliberately.
 */
export class BotFrameworkTokens implements TokenSource {
  constructor(private readonly connectionName: string) {}

  async entraToken(context: TurnContext): Promise<string | null> {
    const client = this.client(context)
    const response = await client.getUserToken(
      context.activity.from?.id ?? '',
      this.connectionName,
      context.activity.channelId ?? '',
      // No magic code: Teams SSO never shows one. It is a six-digit code for channels
      // that cannot complete the flow in-place, which Teams can.
      '',
    )
    return response?.token ? response.token : null
  }

  async promptSignIn(context: TurnContext): Promise<void> {
    const client = this.client(context)
    const resource = await client.getSignInResource(
      this.connectionName,
      context.activity as never,
      '',
    )

    await context.sendActivity({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.oauth',
          content: {
            connectionName: this.connectionName,
            // Teams reads this and completes the exchange without showing anything.
            // Its absence is what turns SSO into a visible "Sign in" button.
            tokenExchangeResource: resource.tokenExchangeResource,
            tokenPostResource: resource.tokenPostResource,
            buttons: [
              {
                type: 'signin',
                title: 'Sign in',
                value: resource.signInLink,
              },
            ],
          },
        },
      ],
    })
  }

  /**
   * The token client the adapter put in turn state.
   *
   * Absent when the bot is running unauthenticated — the Emulator without an app id —
   * in which case SSO cannot work at all and saying so beats a null dereference.
   */
  private client(context: TurnContext): UserTokenClient {
    const adapter = context.adapter as unknown as CloudAdapterBase
    const client = context.turnState.get<UserTokenClient>(adapter.UserTokenClientKey)
    if (!client) {
      throw new Error(
        'No token service on this turn — the bot is running without an app registration.',
      )
    }
    return client
  }
}

/**
 * Completes the silent exchange Teams starts.
 *
 * Teams answers an OAuth card by invoking `signin/tokenExchange` with a token; handing
 * it to the token service is what puts it where [BotFrameworkTokens.entraToken] can
 * find it on the next turn.
 */
export async function completeTokenExchange(
  context: TurnContext,
  connectionName: string,
): Promise<boolean> {
  // `value.id` is the exchange's correlation id, echoed in a failure response. The
  // request itself carries only the token — see TokenExchangeRequest.
  const value = context.activity.value as { token?: string } | undefined
  if (!value?.token) return false

  const adapter = context.adapter as unknown as CloudAdapterBase
  const client = context.turnState.get<UserTokenClient>(adapter.UserTokenClientKey)
  if (!client) return false

  await client.exchangeToken(
    context.activity.from?.id ?? '',
    connectionName,
    context.activity.channelId ?? '',
    { token: value.token },
  )
  return true
}
