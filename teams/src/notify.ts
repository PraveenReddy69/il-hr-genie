/**
 * Pushing a ticket update into someone's Teams chat, unprompted.
 *
 * The replacement for the FCM push in the Android app, and it hangs off the same
 * hook: when HR moves a ticket, the backend tells us, and we deliver it. Teams calls
 * this a proactive message, and it needs two things the request cannot supply — a
 * conversation we have spoken in before, and a registered bot to speak as.
 *
 * The transport lives in `index.ts`; everything here is decidable without a network,
 * which is what makes it testable.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConversationReference } from 'botbuilder'

/** What the backend sends when a ticket moves. */
export interface TicketMoved {
  employeeId: string
  ticketId: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  /** What HR wrote. Required by the server when resolving. */
  comment?: string
  subject?: string
  category?: string
}

export type NotifyResult =
  | { status: 200; body: { delivered: true } }
  | { status: 401 | 404 | 422 | 503; body: { error: string } }

/**
 * Where a person's chat lives, so we can speak into it later.
 *
 * Persisted, because a reference is only handed to us when someone talks to the bot.
 * Losing them on restart would mean nobody gets a notification until they happen to
 * open the chat — which is the exact thing this is here to avoid.
 */
export class References {
  private readonly byEmployee = new Map<string, Partial<ConversationReference>>()

  constructor(private readonly file?: string) {
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        Partial<ConversationReference>
      >
      for (const [id, reference] of Object.entries(raw)) this.byEmployee.set(id, reference)
    } catch {
      // No file yet, or it is unreadable. Starting empty is correct either way.
    }
  }

  get(employeeId: string): Partial<ConversationReference> | undefined {
    return this.byEmployee.get(employeeId)
  }

  known(): string[] {
    return [...this.byEmployee.keys()]
  }

  save(employeeId: string, reference: Partial<ConversationReference>): void {
    this.byEmployee.set(employeeId, reference)
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.byEmployee), null, 2))
    } catch (error) {
      // Losing the write costs one notification, not the conversation.
      console.warn('[HrGenieBot] could not persist conversation references', error)
    }
  }
}

export interface NotifyDeps {
  references: References
  /** Delivers the card. Rejects if the Bot Connector refuses it. */
  send: (reference: Partial<ConversationReference>, moved: TicketMoved) => Promise<void>
  /** The shared secret the backend must present. */
  secret?: string
}

/**
 * Handles one notification from the backend.
 *
 * Fails closed on the secret. An unauthenticated endpoint here would let anyone on
 * the internet push a message that appears to come from HR into any employee's
 * Teams — so a missing secret refuses everything rather than allowing everything,
 * which is the failure mode people forget to configure their way out of.
 */
export async function handleNotify(
  body: unknown,
  headerSecret: string | undefined,
  deps: NotifyDeps,
): Promise<NotifyResult> {
  if (!deps.secret) {
    return { status: 503, body: { error: 'NOTIFY_SECRET is not configured on the bot.' } }
  }
  if (headerSecret !== deps.secret) {
    return { status: 401, body: { error: 'Bad or missing x-notify-secret.' } }
  }

  const moved = asTicketMoved(body)
  if (!moved) {
    return { status: 422, body: { error: 'Need employeeId, ticketId and status.' } }
  }

  const reference = deps.references.get(moved.employeeId)
  if (!reference) {
    // Not an error the backend can fix: Teams will not let anyone be messaged before
    // they have installed the app and spoken to it once.
    return {
      status: 404,
      body: { error: `${moved.employeeId} has never opened HR Genie in Teams.` },
    }
  }

  try {
    await deps.send(reference, moved)
    return { status: 200, body: { delivered: true } }
  } catch (error) {
    return {
      status: 503,
      body: { error: error instanceof Error ? error.message : String(error) },
    }
  }
}

const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED'])

function asTicketMoved(body: unknown): TicketMoved | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  const employeeId = String(raw.employeeId ?? '').trim()
  const ticketId = String(raw.ticketId ?? '').trim()
  const status = String(raw.status ?? '').toUpperCase()
  if (!employeeId || !ticketId || !STATUSES.has(status)) return null

  return {
    employeeId,
    ticketId,
    status: status as TicketMoved['status'],
    comment: raw.comment ? String(raw.comment) : undefined,
    subject: raw.subject ? String(raw.subject) : undefined,
    category: raw.category ? String(raw.category) : undefined,
  }
}
