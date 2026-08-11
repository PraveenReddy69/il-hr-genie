/**
 * The HR Genie backend, from Node.
 *
 * The same service the Android app and the HRBP console talk to — a Teams bot is a
 * third client, not a second system. Nothing here is Teams-aware, so it can be driven
 * from a test script with no Microsoft account involved.
 */

const BASE_URL = (
  process.env.HRGENIE_BASE_URL ?? 'https://b9e4-103-161-31-154.ngrok-free.app'
).replace(/\/$/, '')

export interface Ticket {
  id: string
  subject: string
  category: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  createdAtMillis: number
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

/**
 * A signed-in employee.
 *
 * **Proof of concept only.** Teams SSO replaces every part of this: the real app reads
 * the caller's identity from the Entra token and never sees a password. Until then a
 * single demo account is configured through the environment so the bot has a bearer to
 * call with — which is exactly why this file must not outlive the POC.
 */
export interface Session {
  employeeId: string
  name: string
  token: string
}

let cached: Session | null = null

export async function signIn(): Promise<Session> {
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
