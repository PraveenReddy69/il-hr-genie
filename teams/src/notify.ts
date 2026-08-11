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

/**
 * What the backend can ask the bot to deliver.
 *
 * `type` is optional and defaults to a ticket update, so the contract the backend was
 * first given keeps working unchanged.
 */
export type Notification = TicketMoved | CheckInReminder

/** Nudges someone who has not checked in today. */
export interface CheckInReminder {
  type: 'checkInReminder'
  employeeId: string
  /** For the greeting on the card. Falls back to a neutral one. */
  firstName?: string
}

/** What the backend sends when a ticket moves. */
export interface TicketMoved {
  type?: 'ticketMoved'
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
  | { status: 200; body: { delivered: false; reason: string } }
  | { status: 401 | 404 | 422 | 503; body: { error: string } }

/**
 * Where a person's chat lives, so we can speak into it later.
 *
 * Persisted, because a reference is only handed to us when someone talks to the bot.
 * Losing them on restart would mean nobody gets a notification until they happen to
 * open the chat — which is the exact thing this is here to avoid.
 */
interface Entry {
  reference: Partial<ConversationReference>
  /** yyyy-MM-dd of the last check-in reminder sent. See [remindedToday]. */
  remindedOn?: string
}

export class References {
  private readonly byEmployee = new Map<string, Entry>()

  constructor(private readonly file?: string) {
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      for (const [id, value] of Object.entries(raw)) {
        // Files written before reminders existed hold a bare reference.
        const entry = value as Entry
        this.byEmployee.set(
          id,
          entry?.reference ? entry : { reference: value as Partial<ConversationReference> },
        )
      }
    } catch {
      // No file yet, or it is unreadable. Starting empty is correct either way.
    }
  }

  get(employeeId: string): Partial<ConversationReference> | undefined {
    return this.byEmployee.get(employeeId)?.reference
  }

  known(): string[] {
    return [...this.byEmployee.keys()]
  }

  /**
   * Whether this person has already been reminded today.
   *
   * A misconfigured cron running hourly would otherwise nag someone twelve times
   * about their wellbeing, which is the fastest way to make people mute the app.
   */
  remindedToday(employeeId: string, today: string): boolean {
    return this.byEmployee.get(employeeId)?.remindedOn === today
  }

  markReminded(employeeId: string, today: string): void {
    const entry = this.byEmployee.get(employeeId)
    if (!entry) return
    entry.remindedOn = today
    this.persist()
  }

  save(employeeId: string, reference: Partial<ConversationReference>): void {
    const existing = this.byEmployee.get(employeeId)
    this.byEmployee.set(employeeId, { ...existing, reference })
    this.persist()
  }

  private persist(): void {
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
  send: (reference: Partial<ConversationReference>, what: Notification) => Promise<void>
  /** The shared secret the backend must present. */
  secret?: string
  /** Today, as yyyy-MM-dd. Injectable so the once-a-day rule is testable. */
  today?: () => string
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

  const what = asNotification(body)
  if (!what) {
    return {
      status: 422,
      body: { error: 'Need employeeId, and either ticketId + status, or type "checkInReminder".' },
    }
  }

  const reference = deps.references.get(what.employeeId)
  if (!reference) {
    // Not an error the backend can fix: Teams will not let anyone be messaged before
    // they have installed the app and spoken to it once.
    return {
      status: 404,
      body: { error: `${what.employeeId} has never opened HR Genie in Teams.` },
    }
  }

  const today = (deps.today ?? isoToday)()
  if (what.type === 'checkInReminder' && deps.references.remindedToday(what.employeeId, today)) {
    // 200, not an error: the cron did nothing wrong and there is nothing to retry.
    return { status: 200, body: { delivered: false, reason: 'already reminded today' } }
  }

  try {
    await deps.send(reference, what)
    if (what.type === 'checkInReminder') deps.references.markReminded(what.employeeId, today)
    return { status: 200, body: { delivered: true } }
  } catch (error) {
    return {
      status: 503,
      body: { error: error instanceof Error ? error.message : String(error) },
    }
  }
}

const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED'])

function asNotification(body: unknown): Notification | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  if (!String(raw.employeeId ?? '').trim()) return null

  if (String(raw.type ?? '') === 'checkInReminder') {
    return {
      type: 'checkInReminder',
      employeeId: String(raw.employeeId).trim(),
      firstName: raw.firstName ? String(raw.firstName) : undefined,
    }
  }
  return asTicketMoved(raw)
}

function asTicketMoved(raw: Record<string, unknown>): TicketMoved | null {
  const employeeId = String(raw.employeeId ?? '').trim()
  const ticketId = String(raw.ticketId ?? '').trim()
  const status = String(raw.status ?? '').toUpperCase()
  if (!employeeId || !ticketId || !STATUSES.has(status)) return null

  return {
    type: 'ticketMoved',
    employeeId,
    ticketId,
    status: status as TicketMoved['status'],
    comment: raw.comment ? String(raw.comment) : undefined,
    subject: raw.subject ? String(raw.subject) : undefined,
    category: raw.category ? String(raw.category) : undefined,
  }
}

/** The bot's local date, matching how the server groups a check-in. */
function isoToday(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
