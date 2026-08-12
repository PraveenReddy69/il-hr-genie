/**
 * The HR Genie backend, from Node.
 *
 * The same service the Android app and the HRBP console talk to — a Teams bot is a
 * third client, not a second system. Nothing here is Teams-aware, so it can be driven
 * from a test script with no Microsoft account involved.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const BASE_URL = (
  process.env.HRGENIE_BASE_URL ?? 'https://hrgenie-api.devinfinitylearn.in'
).replace(/\/$/, '')

export interface TicketComment {
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  text: string
  authorId: string
  atMillis: number
}

export interface Ticket {
  id: string
  subject: string
  category: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  createdAtMillis: number
  /** What HR wrote when they moved it. Resolving requires one. */
  comments: TicketComment[]
}

export interface Celebrations {
  birthdays: string[]
  anniversaries: { name: string; years: number }[]
  newJoiners: string[]
}

/** The five the server accepts, worst to best is not the order they are offered in. */
export type Mood = 'GREAT' | 'GOOD' | 'OKAY' | 'STRESSED' | 'BURNT_OUT'

/** What the server will accept as a reason. Anything else is rejected. */
export const MOOD_REASONS = [
  'Workload',
  'Deadlines',
  'My manager',
  'My team',
  'Recognition',
  'Clarity on goals',
  'Work–life balance',
  'Something outside work',
] as const

export interface MoodCheckIn {
  mood: Mood
  reasons: string[]
  /** Private to the employee. HR never receives it — see the note on [saveMood]. */
  note: string | null
  dateIso: string
}

export interface KbAnswer {
  text: string
  source: string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

/** A signed-in employee. */
export interface Session {
  employeeId: string
  name: string
  token: string
}

/**
 * Whose data the current call is about.
 *
 * Every function below asks [signIn] for a bearer, and until SSO that answered with
 * one configured account for everybody. Now it answers with whoever this turn belongs
 * to — without threading a session parameter through every call site, and through
 * `conversation.ts`, which has no business knowing about identity at all.
 *
 * `AsyncLocalStorage` rather than a module-level "current user": two people's turns
 * interleave at every `await`, so a plain variable would hand one employee's bearer to
 * another employee's request. That is the exact bug this whole change exists to
 * prevent, and it would be invisible in testing with one user.
 */
const caller = new AsyncLocalStorage<Session>()

/** Runs `work` with `session` as the caller for every API call it makes. */
export function asEmployee<T>(session: Session, work: () => Promise<T>): Promise<T> {
  return caller.run(session, work)
}

/** The session in scope, if the caller is running inside [asEmployee]. */
export function currentSession(): Session | undefined {
  return caller.getStore()
}

/**
 * Trades a Teams SSO token for an HR Genie session.
 *
 * The bot receives an Entra token proving who the user is; the backend verifies it and
 * answers with its own bearer for that employee. No password is involved at any point.
 * See docs/TEAMS_SSO_BACKEND.md for what the server has to check.
 */
export async function exchangeTeamsToken(entraToken: string): Promise<Session> {
  const body = await request<{ token: string; employee: Record<string, unknown> }>(
    '/api/auth/teams',
    { method: 'POST', body: JSON.stringify({ token: entraToken }) },
  )

  const employee = body.employee ?? {}
  const employeeId = String(employee.employeeId ?? '')
  if (!employeeId || !body.token) {
    throw new ApiError('The server accepted the Teams token but returned no employee.')
  }
  return { employeeId, name: String(employee.name ?? employeeId), token: body.token }
}

/**
 * The shared account, for when there is no SSO session.
 *
 * **Proof of concept only**, and the reason the app must stay sideloaded to one
 * person: everyone who opens it reads this employee's records. Kept as a fallback so
 * the Emulator and `npm run try` still work without a bot registration.
 */
let cached: Session | null = null

export async function signIn(): Promise<Session> {
  const scoped = caller.getStore()
  if (scoped) return scoped
  if (cached) return cached

  const employeeId = process.env.HRGENIE_EMPLOYEE_ID
  const password = process.env.HRGENIE_PASSWORD
  if (!employeeId || !password) {
    throw new ApiError(
      'Set HRGENIE_EMPLOYEE_ID and HRGENIE_PASSWORD in teams/.env — see the README.',
    )
  }

  const body = await request<{ token: string; employee: Record<string, unknown> }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ employeeId, password }) },
  )

  const employee = body.employee ?? {}
  cached = {
    employeeId: String(employee.employeeId ?? employeeId),
    name: String(employee.name ?? employeeId),
    token: body.token,
  }
  return cached
}

/** Drops the shared-account cache. For tests, and for sign-out. */
export function forgetSharedSession(): void {
  cached = null
}

export async function askKnowledgeBase(question: string): Promise<KbAnswer> {
  const session = await signIn()
  const body = await request<{ answer?: string; text?: string; sources?: unknown }>(
    '/api/kb/query',
    { method: 'POST', body: JSON.stringify({ query: question }), token: session.token },
  )

  const text = String(body.answer ?? body.text ?? '').trim()
  if (!text) throw new ApiError('The knowledge base returned nothing usable.')
  return { text, source: firstSourceTitle(body.sources) }
}

/**
 * Today's check-in, or null if there is not one yet.
 *
 * The endpoint answers 404 when none exists, which is a normal state rather than a
 * failure — most of the day, for most people, there is nothing there.
 */
export async function todaysMood(): Promise<MoodCheckIn | null> {
  const session = await signIn()
  try {
    const raw = await request<Record<string, unknown>>(
      `/api/mood?employeeId=${encodeURIComponent(session.employeeId)}&date=${today()}`,
      { token: session.token },
    )
    return {
      mood: String(raw.mood ?? 'OKAY') as Mood,
      reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String) : [],
      note: raw.note ? String(raw.note) : null,
      dateIso: String(raw.dateIso ?? today()),
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/**
 * Records how someone is doing today.
 *
 * An upsert, so checking in twice corrects the first answer rather than stacking a
 * second — which is what lets the bot offer to change it.
 *
 * The note is private. HR sees the check-in in aggregate and never the note, and the
 * card says so: a wellbeing prompt that quietly shows your words to your manager is
 * one people learn to lie to.
 */
export async function saveMood(
  mood: Mood,
  reasons: string[],
  note: string | null,
): Promise<void> {
  const session = await signIn()
  await request('/api/mood', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: session.employeeId,
      mood,
      ...(reasons.length > 0 ? { reasons } : {}),
      ...(note ? { note } : {}),
    }),
    token: session.token,
  })
}

/** The server defaults to its own today; this keeps the read on the same day. */
function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export interface PulseQuestion {
  id: string
  text: string
  hint: string
  options: string[]
}

/** The pulse for the current cycle, or null when it has not been answered. */
export async function thisCyclesPulse(): Promise<Record<string, string> | null> {
  const session = await signIn()
  try {
    const raw = await request<Record<string, unknown>>(
      `/api/pulse?employeeId=${encodeURIComponent(session.employeeId)}&cycle=${cycle()}`,
      { token: session.token },
    )
    return (raw.answers as Record<string, string>) ?? {}
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function pulseQuestions(): Promise<PulseQuestion[]> {
  const session = await signIn()
  const raw = await request<unknown>('/api/pulse/questions', { token: session.token })
  const rows = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])
  const mapped = rows.map((row) => {
    const q = row as Record<string, unknown>
    return {
      id: String(q.id ?? q.questionId ?? ''),
      text: String(q.text ?? q.question ?? ''),
      hint: String(q.hint ?? ''),
      options: Array.isArray(q.options) ? q.options.map(String) : [],
    }
  })
  const usable = mapped.filter((q) => q.id && q.text && q.options.length > 0)
  return usable.length > 0 ? usable : FALLBACK_PULSE
}

/**
 * The Android app's questions, for when the server has none.
 *
 * A pulse with no questions is worse than no pulse, and these are the same four the
 * mobile app has been asking — so an answer given here still lands in the same
 * question ids the analytics already group by.
 */
const FALLBACK_PULSE: PulseQuestion[] = [
  {
    id: 'experience',
    text: 'How has your work experience been this month?',
    hint: 'Gut feel is fine — no one is scoring you.',
    options: ['Genuinely good', 'Mostly fine', 'Up and down', 'Rough, honestly'],
  },
  {
    id: 'workload',
    text: 'Is your workload manageable right now?',
    hint: '',
    options: ['Comfortable', 'Busy but okay', 'Stretched', 'Not sustainable'],
  },
  {
    id: 'manager',
    text: 'Do you feel supported by your manager?',
    hint: 'Answers roll up to a department average only.',
    options: ['Always', 'Usually', 'Sometimes', 'Rarely'],
  },
  {
    id: 'attrition',
    text: 'Have you thought about looking elsewhere recently?',
    hint: 'Honest answers here are what make this useful.',
    options: ['Not at all', 'Passing thought', 'Somewhat', 'Actively looking'],
  },
]

export async function savePulse(answers: Record<string, string>): Promise<void> {
  const session = await signIn()
  await request('/api/pulse', {
    method: 'POST',
    body: JSON.stringify({ employeeId: session.employeeId, answers }),
    token: session.token,
  })
}

/** yyyy-MM, the cycle the server groups a pulse under. */
function cycle(): string {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`
}

export async function raiseTicket(subject: string, category: string): Promise<Ticket> {
  const session = await signIn()
  const raw = await request<Record<string, unknown>>('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ employeeId: session.employeeId, subject, category }),
    token: session.token,
  })
  return toTicket(raw)
}

export async function myTickets(): Promise<Ticket[]> {
  const session = await signIn()
  const raw = await request<unknown>(
    `/api/tickets?employeeId=${encodeURIComponent(session.employeeId)}`,
    { token: session.token },
  )
  const rows = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])
  return rows
    .map((row) => toTicket(row as Record<string, unknown>))
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis)
}

/**
 * Tickets HR has moved since this employee last looked.
 *
 * The other half of the ticket loop. Without it someone can raise a ticket and never
 * learn what happened to it — the bot cannot push a notification, so this is the only
 * way the answer gets back to them.
 */
export async function unseenTickets(): Promise<Ticket[]> {
  const session = await signIn()
  const raw = await request<unknown>(
    `/api/tickets/unseen?employeeId=${encodeURIComponent(session.employeeId)}`,
    { token: session.token },
  )
  const rows = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])
  return rows.map((row) => toTicket(row as Record<string, unknown>))
}

/**
 * Marks everything currently visible as seen.
 *
 * Called only after the update has actually been shown. Marking first would lose an
 * update for good if the send failed — an employee would never learn HR had replied.
 */
export async function markTicketsSeen(): Promise<void> {
  const session = await signIn()
  await request('/api/tickets/seen', {
    method: 'POST',
    body: JSON.stringify({ employeeId: session.employeeId }),
    token: session.token,
  })
}

/** Birthdays, work anniversaries and recent joiners. */
export async function celebrations(): Promise<Celebrations> {
  const session = await signIn()
  const raw = await request<Record<string, unknown>>('/api/employees/celebrations', {
    token: session.token,
  })
  const names = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((row) => (typeof row === 'string' ? row : String((row as { name?: string }).name ?? ''))).filter(Boolean)
      : []
  return {
    birthdays: names(raw.birthdays),
    anniversaries: Array.isArray(raw.anniversaries)
      ? raw.anniversaries.map((row) => {
          const a = row as Record<string, unknown>
          return { name: String(a.name ?? ''), years: Number(a.years ?? 0) }
        }).filter((a) => a.name)
      : [],
    newJoiners: names(raw.newJoiners ?? raw.joiners),
  }
}

export async function categories(): Promise<string[]> {
  const session = await signIn()
  const raw = await request<unknown>('/api/tickets/categories', { token: session.token })
  const rows = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])
  const names = rows
    .map((row) => (typeof row === 'string' ? row : String((row as { name?: string }).name ?? '')))
    .filter(Boolean)
  return names.length > 0 ? names : FALLBACK_CATEGORIES
}

/** What the Android app offers, for when the server has no list of its own. */
const FALLBACK_CATEGORIES = [
  'Payroll',
  'Leave',
  'IT & access',
  'Insurance',
  'Facilities',
  'Something else',
]

function toTicket(raw: Record<string, unknown>): Ticket {
  const created = raw.createdAt ?? raw.raisedAt ?? raw.created_at
  return {
    id: String(raw.ticketId ?? raw.id ?? ''),
    subject: String(raw.subject ?? raw.title ?? ''),
    category: String(raw.category ?? ''),
    status: (String(raw.status ?? 'OPEN').toUpperCase() as Ticket['status']) ?? 'OPEN',
    createdAtMillis: created ? Date.parse(String(created)) || Date.now() : Date.now(),
    comments: Array.isArray(raw.comments)
      ? raw.comments.map((row) => {
          const c = row as Record<string, unknown>
          return {
            status: String(c.status ?? 'OPEN').toUpperCase() as Ticket['status'],
            text: String(c.text ?? ''),
            authorId: String(c.authorId ?? ''),
            atMillis: Number(c.atMillis ?? 0),
          }
        })
      : [],
  }
}

function firstSourceTitle(sources: unknown): string | null {
  if (!Array.isArray(sources) || sources.length === 0) return null
  const first = sources[0]
  if (typeof first === 'string') return first
  const title = (first as { title?: string; documentTitle?: string })
  return title.title ?? title.documentTitle ?? null
}

async function request<T>(
  path: string,
  init: { method?: string; body?: string; token?: string } = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      // ngrok serves a browser interstitial without this, which arrives as HTML
      // where JSON was expected. Harmless on any other host.
      'ngrok-skip-browser-warning': 'true',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body,
  })

  const text = await response.text()
  if (!response.ok) {
    // The service reports errors as { message, error, statusCode }.
    let detail = text.slice(0, 200)
    try {
      detail = String(JSON.parse(text).message ?? detail)
    } catch {
      // Not JSON. The raw body is more useful than nothing.
    }
    throw new ApiError(detail, response.status)
  }

  return (text ? JSON.parse(text) : {}) as T
}

/**
 * Every call the conversation makes, in one swappable object.
 *
 * The same seam the Android app uses for its gateways, and for the same reason: the
 * flow logic is where the bugs live, and it should be testable without a network, a
 * backend or an account. Production never reassigns this — tests do.
 */
export const gateway = {
  signIn,
  exchangeTeamsToken,
  askKnowledgeBase,
  raiseTicket,
  myTickets,
  categories,
  todaysMood,
  saveMood,
  thisCyclesPulse,
  pulseQuestions,
  savePulse,
  unseenTickets,
  markTicketsSeen,
  celebrations,
}

/** Restores the real implementations. Call it after a test that swapped any. */
export const liveGateway = { ...gateway }
