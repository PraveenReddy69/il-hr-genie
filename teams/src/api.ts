/**
 * The HR Genie backend, from Node.
 *
 * The same service the Android app and the HRBP console talk to — a Teams bot is a
 * third client, not a second system. Nothing here is Teams-aware, so it can be driven
 * from a test script with no Microsoft account involved.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import type { Holiday } from './holidays.js'

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
  /**
   * When the status last changed.
   *
   * The only timestamp for a move HR made without commenting — which they can, for
   * every status except RESOLVED. It dates the ticket's *current* stop and nothing
   * earlier: a ticket that went open → in progress → resolved has one of these, not
   * three.
   */
  updatedAtMillis: number
  /** What HR wrote when they moved it. Resolving requires one. */
  comments: TicketComment[]
}

/** Someone worth mentioning today, with enough to tell two colleagues apart. */
export interface Celebrant {
  name: string
  employeeId: string
  /** Job title. Empty when the directory has none. */
  designation: string
  /** Only on a work anniversary. */
  years?: number
  /**
   * Work email, which is also the Teams sign-in.
   *
   * Empty today: `/api/employees/celebrations` does not return one, and the directory
   * that does is HR-only. Without it there is no way to open a chat with the person,
   * so the Wish button hides itself rather than opening an empty chat.
   */
  email: string
}

export interface Celebrations {
  birthdays: Celebrant[]
  anniversaries: Celebrant[]
  newJoiners: Celebrant[]
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
 * The session for the person this turn belongs to.
 *
 * There is no fallback, and that is the point. This used to log in with a shared
 * employee id and password from `.env`, which meant everyone who opened HR Genie read
 * and wrote that one person's records — the single reason the app could not be
 * published. Teams SSO replaced it on 13 August 2026, so identity now only ever
 * arrives from [asEmployee], scoped to one turn.
 *
 * Throwing here is the safe failure. Anything else would serve a colleague's HR
 * record to whoever happened to be asking.
 */
export async function signIn(): Promise<Session> {
  const scoped = caller.getStore()
  if (scoped) return scoped

  const dev = developerSession()
  if (dev) return dev

  throw new ApiError(
    'No signed-in employee on this turn. In Teams this means SSO is not configured — ' +
      'set SSO_CONNECTION_NAME. Outside Teams, see HRGENIE_DEV_TOKEN in .env.example.',
  )
}

/**
 * A session for the card preview and `npm run try`, which have no Teams to sign into.
 *
 * A bearer the developer already holds, pasted in — not a password, not an account the
 * product can fall back to. It expires on its own, it is absent in any real run, and
 * nothing reaches it unless [asEmployee] left no identity in scope.
 */
let developerCache: Session | null = null

function developerSession(): Session | null {
  if (developerCache) return developerCache

  const token = process.env.HRGENIE_DEV_TOKEN
  if (!token) return null

  // Best effort: the label is cosmetic, and a token that does not decode is still a
  // token the server will judge for itself.
  let employeeId = 'dev'
  let name = 'Developer'
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    employeeId = String(claims.employeeId ?? claims.sub ?? employeeId)
    name = String(claims.name ?? name)
  } catch {
    // Not a readable JWT. The server decides regardless.
  }

  developerCache = { employeeId, name, token }
  return developerCache
}

/** Drops the developer session. For tests. */
export function forgetSharedSession(): void {
  developerCache = null
}

export async function askKnowledgeBase(question: string): Promise<KbAnswer> {
  const session = await signIn()
  const body = await request<{ answer?: string; text?: string; sources?: unknown }>(
    '/api/kb/query',
    // `question`, not `query` — QueryDto in the deployed spec, and the server rejects
    // an unknown property outright rather than ignoring it.
    { method: 'POST', body: JSON.stringify({ question }), token: session.token },
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

/**
 * The questions to ask, from the server.
 *
 * The unwrapping matters more than it looks. `/api/pulse/questions` answers
 * `{"questions": [...]}`, and this read only ever looked for a bare array or `items` —
 * so `rows` was always empty, `usable` was always empty, and every pulse anybody has
 * ever seen in Teams came from FALLBACK_PULSE below. The bot has never once shown a
 * question written in the HR console, and it failed silently because falling back is
 * exactly what it is meant to do when the server has nothing.
 *
 * All three shapes are accepted now rather than just the right one: the endpoint has
 * already been seen to answer differently in different places, and a pulse that
 * quietly reverts to four hard-coded questions is not a failure anyone will notice.
 */
export async function pulseQuestions(): Promise<PulseQuestion[]> {
  const session = await signIn()
  const raw = await request<unknown>('/api/pulse/questions', { token: session.token })
  const rows = Array.isArray(raw)
    ? raw
    : ((raw as { questions?: unknown[] }).questions ??
      (raw as { items?: unknown[] }).items ??
      [])
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
  /*
   * Newest activity first, not newest ticket.
   *
   * A ticket HR just replied to is the one you came to look at, even if it was
   * raised weeks ago — sorting by creation buries it under things nothing has
   * happened to.
   *
   * It also survives a bad `createdAtMillis`: when every ticket claims the same
   * creation time the comment timestamps still order them sensibly.
   */
  const lastActivity = (ticket: Ticket): number =>
    Math.max(ticket.createdAtMillis, ...ticket.comments.map((one) => one.atMillis), 0)

  return rows
    .map((row) => toTicket(row as Record<string, unknown>))
    .sort((a, b) => lastActivity(b) - lastActivity(a))
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
  /**
   * The server sends whole employee records; a bare string is tolerated in case a
   * thinner shape ever comes back.
   */
  const people = (value: unknown): Celebrant[] =>
    Array.isArray(value)
      ? value
          .map((row) => {
            if (typeof row === 'string') {
              return { name: row, employeeId: '', designation: '', email: '' }
            }
            const one = row as Record<string, unknown>
            return {
              name: String(one.name ?? ''),
              employeeId: String(one.employeeId ?? ''),
              designation: String(one.designation ?? one.title ?? ''),
              // Every spelling the service might use. See docs/CELEBRATIONS_BACKEND.md.
              // Only the real address, never a stand-in: a Wish button is a deep link
              // to a named person, and pointing one at anybody but the celebrant sends
              // a birthday message to the wrong colleague. Absent, the button simply
              // does not render — see [wish] in cards.ts.
              email: String(one.officialEmail ?? one.email ?? one.upn ?? ''),
              ...(one.years === undefined ? {} : { years: Number(one.years) }),
            }
          })
          .filter((one) => one.name)
      : []

  return {
    birthdays: people(raw.birthdays),
    // `workAnniversaries` is what the service actually returns. It was being read as
    // `anniversaries`, so this section had silently never appeared.
    anniversaries: people(raw.workAnniversaries ?? raw.anniversaries),
    newJoiners: people(raw.newJoiners ?? raw.joiners),
  }
}

/**
 * The published calendar for one year.
 *
 * Read-only here. HR maintains it in the console, and this is the same
 * `GET /api/holidays` the console reads back — one calendar, not a copy per client,
 * which is the entire reason a holiday added in the console now appears in chat.
 *
 * Field names are taken defensively. The service answers with the console's shape
 * today; `date`/`type` are tolerated because this list is one of the oldest things in
 * the product and has been spelled more than one way.
 */
export async function holidays(year: number): Promise<Holiday[]> {
  const session = await signIn()
  const raw = await request<unknown>(`/api/holidays?year=${year}`, {
    token: session.token,
  })
  const rows = Array.isArray(raw) ? raw : ((raw as { holidays?: unknown[] }).holidays ?? [])

  return rows
    .map((row) => {
      const one = row as Record<string, unknown>
      const kind = String(one.kind ?? one.type ?? 'FIXED').toUpperCase()
      return {
        name: String(one.name ?? ''),
        isoDate: String(one.isoDate ?? one.date ?? '').slice(0, 10),
        kind: kind === 'OPTIONAL' ? 'OPTIONAL' : 'FIXED',
        region: String(one.region ?? 'All India'),
      } as Holiday
    })
    // A row without a name or a date cannot be drawn and cannot be reasoned about.
    .filter((one) => one.name && /^\d{4}-\d{2}-\d{2}$/.test(one.isoDate))
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
  /*
   * `createdAtMillis` first — it is what the service actually sends.
   *
   * This read `createdAt`, `raisedAt` and `created_at`, none of which exist in the
   * response, so every ticket fell through to `Date.now()` and claimed to have been
   * raised the instant it was displayed. The list looked plausible, which is why it
   * survived: only a timeline putting "Raised" after "Resolved" gave it away.
   *
   * The string forms are kept as a fallback in case an older shape resurfaces.
   */
  const millis = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const parsed = value ? Date.parse(String(value)) : NaN
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const createdAtMillis = millis(
    raw.createdAtMillis ?? raw.createdAt ?? raw.raisedAt ?? raw.created_at,
    Date.now(),
  )

  return {
    id: String(raw.ticketId ?? raw.id ?? ''),
    subject: String(raw.subject ?? raw.title ?? ''),
    category: String(raw.category ?? ''),
    status: (String(raw.status ?? 'OPEN').toUpperCase() as Ticket['status']) ?? 'OPEN',
    createdAtMillis,
    updatedAtMillis: millis(raw.updatedAtMillis ?? raw.updatedAt, createdAtMillis),
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
  holidays,
}

/** Restores the real implementations. Call it after a test that swapped any. */
export const liveGateway = { ...gateway }
