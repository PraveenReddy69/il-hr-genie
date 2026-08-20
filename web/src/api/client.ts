/**
 * The only place the console talks to a server.
 *
 * While `VITE_API_BASE_URL` is unset every call is served from src/api/mock.ts, so
 * the whole console runs with no backend. Set it in `web/.env.local` and the same
 * calls go over HTTP — no page or component changes, because nothing above this file
 * knows which one it got.
 *
 * The paths below are exactly those in docs/API_SCHEMA.md.
 */

import {
  employeeName as mockEmployeeName,
  EMPLOYEES,
  mockEmployees,
  mockEmployeeSummary,
  mockAttendanceWeek,
  mockChatAnalytics,
  mockEmployeeTickets,
  mockMoodDetail,
  mockMoodHistory,
  mockPulseBreakdown,
  mockPulseDetail,
  mockPulseHistory,
  mockStats,
  mockTicketAnalytics,
  mockTickets,
  mockUpdateTicket,
  mockAssignTicket,
  mockCelebrations,
  weekDates,
  weekStart,
} from './mock'
import { isConsoleRole, type Permission } from './access'
import type { Celebrant, Celebrations } from './celebrations'
import { MIN_COHORT, MOODS } from './types'
import { holidaysFor } from './holidays'
import type {
  Role,
  MoodKey,
  DepartmentMood,
  AttendanceDay,
  AttendanceStatus,
  ChatAnalytics,
  CycleSummary,
  EmployeeWeek,
  DayMood,
  Employee,
  EmployeeSummary,
  Holiday,
  HrStats,
  PersonEntry,
  QuestionBreakdown,
  Ticket,
  TicketAnalytics,
  TicketStatus,
} from './types'

/**
 * Run on the mock without deleting your API address.
 *
 * `.env.local` is loaded in every mode and outranks `.env.[mode]`, so no env file can
 * turn the backend off while it exists — the only way was to rename it and remember to
 * rename it back. This is the switch instead: `npm run dev:mock`.
 *
 * Dev only. A stray variable in a production build must not be able to blank the API
 * and quietly serve everybody invented numbers.
 */
const FORCED_MOCK = import.meta.env.DEV && import.meta.env.VITE_FORCE_MOCK === 'true'

const BASE_URL = FORCED_MOCK
  ? undefined
  : (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export const isLive = Boolean(BASE_URL)

/**
 * Endpoints the backend does not expose yet.
 *
 * The console was written against the proposed schema in docs/API_SCHEMA.md, which
 * included aggregate endpoints (`/hr/stats`, `/hr/analytics/*`, history) the server
 * never grew — it returns raw rows instead. Anything here is still served from the
 * mock even in live mode, and the page says so rather than pretending.
 */
export const MOCK_IN_LIVE = ['Chat analytics'] as const

/**
 * Employee id to name, filled from the live directory.
 *
 * Names are rendered synchronously all over the console (ticket rows, comment
 * authors), so they cannot each await a lookup. [ensureDirectory] fills this once and
 * [employeeName] reads it. Without it the console falls back to the mock directory,
 * which is how the HR account was showing the seed name rather than the one the
 * server returns.
 */
const directory = new Map<string, Employee>()

let directoryLoad: Promise<void> | null = null

/** Loads the directory once. Safe to call from every page that renders a name. */
export function ensureDirectory(): Promise<void> {
  if (!isLive) return Promise.resolve()
  directoryLoad ??= fetchEmployees()
    .then((employees) => {
      employees.forEach((one) => directory.set(one.employeeId, one))
    })
    .catch(() => {
      // A directory we could not load must not stop the page rendering; the ids
      // show through instead, which is honest.
      directoryLoad = null
    })
  return directoryLoad
}

const TOKEN_KEY = 'hr-genie-token'

/** The JWT from sign-in. Session storage, so closing the tab ends the session. */
function token(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  // The mock has no token to invalidate, so signing out has to drop its own record of
  // who signed in. Left behind, the next sign-in would start as the previous person.
  sessionStorage.removeItem(MOCK_SESSION_KEY)
  directory.clear()
  directoryLoad = null
  employeeLoad = null
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

/**
 * Whether the server rejected the token.
 *
 * Exposed as a check rather than by exporting the error class, so callers ask a
 * question instead of matching on message text — a body that merely contains "401"
 * would otherwise be mistaken for one.
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/** Exported so sibling modules (sales.ts) can reach the API without duplicating the
 *  auth header, ngrok header and error handling. */
export async function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' })
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const bearer = token()
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // The tunnel serves a browser interstitial without this, which would come back
      // as HTML where JSON was expected.
      'ngrok-skip-browser-warning': 'true',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    // Read the body for the server's own message before giving up on it.
    const detail = await response.text().catch(() => '')
    throw new ApiError(detail || `Request failed (${response.status})`, response.status)
  }
  return (await response.json()) as T
}

/** Keeps the mock path feeling like a network call rather than a synchronous read. */
function mocked<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 180))
}

// ----------------------------------------------------------------------- auth

export async function signIn(employeeId: string, password: string): Promise<Employee> {
  if (isLive) {
    const result = await request<{ employee: RawEmployee; token: string }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ employeeId, password }) },
    )
    // Stored before returning, because every later call needs it.
    sessionStorage.setItem(TOKEN_KEY, result.token)
    return toEmployee(result.employee)
  }

  const employee = EMPLOYEES.find(
    (candidate) => candidate.employeeId.toLowerCase() === employeeId.trim().toLowerCase(),
  )
  if (!employee) throw new ApiError('That employee ID is not in the directory.')
  sessionStorage.setItem(MOCK_SESSION_KEY, employee.employeeId)
  return mocked(employee)
}

/**
 * The server's employee record.
 *
 * Two shapes come back: most carry `designation`, the HR accounts carry `title`.
 * Reading both keeps HR's own name badge from rendering blank.
 */
interface RawEmployee {
  employeeId: string
  name: string
  designation?: string
  title?: string
  department: string
  subDepartment?: string
  officialEmail: string
  role: Role
  departments?: string[]
  permissions?: Permission[]
  dateOfJoining?: string
  reportees?: number
}

function toEmployee(raw: RawEmployee): Employee {
  return {
    employeeId: raw.employeeId,
    name: raw.name,
    title: raw.designation || raw.title || '',
    department: raw.subDepartment || raw.department,
    officialEmail: raw.officialEmail,
    role: raw.role,
    // Passed through rather than derived. The server resolves a bundle plus any
    // per-person grants into one list; recomputing it here would mean a front-end
    // release every time the backend changed what a role includes. Undefined on a
    // backend that predates access control, and permissionsOf falls back to the bundle.
    departments: raw.departments,
    permissions: raw.permissions,
    dateOfJoining: raw.dateOfJoining,
    reportees: raw.reportees,
  }
}

// ----------------------------------------------------------------- directory

/**
 * The signed-in employee, re-read from the server.
 *
 * Sign-in stores a snapshot of the record, which then never changes for as long as
 * the tab lives — so a rename or a role change on the server stayed invisible until
 * the next sign-out. This re-reads it.
 */
/**
 * Who the mock is signed in as.
 *
 * Sign-in on the mock path finds the account by id, but the re-read on load used to
 * return EMPLOYEES[0] regardless — an EMPLOYEE record. That was survivable while every
 * HR account was identical; with permissions on the session it silently demoted whoever
 * reloaded the tab. The id is kept here at sign-in so the re-read agrees with it.
 */
const MOCK_SESSION_KEY = 'hr-genie-mock-signed-in'

function signedInMock(): Employee {
  // In sessionStorage rather than a module variable: a reload resets the module and
  // the re-read would answer with whichever HR account happens to come first, quietly
  // demoting an Admin to an HRBP on refresh. The real path keeps a token in the same
  // place for the same reason.
  const id = sessionStorage.getItem(MOCK_SESSION_KEY)
  const found = EMPLOYEES.find((one) => one.employeeId === id)
  return found ?? EMPLOYEES.find((one) => isConsoleRole(one.role)) ?? EMPLOYEES[0]
}

export function fetchMe(): Promise<Employee> {
  if (!isLive) return mocked(signedInMock())
  return get<RawEmployee>('/api/employees/me').then(toEmployee)
}

/**
 * The whole workforce.
 *
 * Memoised for the session. Nearly two thousand records come back on every call, and
 * the dashboard, People, the drill-downs and the summaries all want the same list —
 * without this, one pass through the console pulled it seven times over the tunnel.
 * [clearToken] drops it on sign-out.
 */
export function fetchEmployees(): Promise<Employee[]> {
  if (!isLive) return mocked(mockEmployees())
  employeeLoad ??= get<RawEmployee[]>('/api/employees')
    .then((raw) => raw.map(toEmployee))
    .catch((error) => {
      // Not cached as a failure: a dropped tunnel must not poison the rest of the
      // session with an empty directory.
      employeeLoad = null
      throw error
    })
  return employeeLoad
}

let employeeLoad: Promise<Employee[]> | null = null

/**
 * One person's programme activity.
 *
 * There is no `/employees/{id}/summary` on the server, so this is assembled from the
 * three list endpoints. HR may read another employee's mood and pulse lists — and
 * notably the mood rows come back without the private note, so the privacy rule holds
 * here without this file having to strip anything.
 */
export async function fetchEmployeeSummary(employeeId: string): Promise<EmployeeSummary> {
  if (!isLive) {
    const summary = mockEmployeeSummary(employeeId)
    if (!summary) throw new ApiError(`No employee ${employeeId}`)
    return mocked(summary)
  }

  await ensureDirectory()
  const [moods, pulses, tickets] = await Promise.all([
    get<{ items: RawMood[] }>(`/api/mood/list?employeeId=${employeeId}&page=1&limit=200`),
    get<{ items: RawPulse[] }>(`/api/pulse/list?employeeId=${employeeId}&page=1&limit=200`),
    fetchEmployeeTickets(employeeId),
  ])

  const employee = directoryRecord(employeeId)
  const today = todayIso()
  const since = daysAgoIso(TREND_DAYS)

  return {
    employee,
    moodToday: moods.items.find((row) => row.dateIso === today)?.mood ?? null,
    pulseCompleted: pulses.items.some((row) => row.cycle === currentCycle()),
    ticketsOpen: tickets.filter((ticket) => ticket.status !== 'RESOLVED').length,
    ticketsTotal: tickets.length,
    // Distinct days, so two saves on one date still count once.
    checkInDays: new Set(
      moods.items.filter((row) => row.dateIso >= since).map((row) => row.dateIso),
    ).size,
    trendDays: TREND_DAYS,
  }
}

/** The window the "days checked in" figure is measured over. */
const TREND_DAYS = 14

function daysAgoIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function currentCycle(): string {
  return todayIso().slice(0, 7)
}

export function fetchEmployeeTickets(employeeId: string): Promise<Ticket[]> {
  return isLive
    ? get<Ticket[]>(`/api/tickets?employeeId=${employeeId}`)
    : mocked(mockEmployeeTickets(employeeId))
}

// ----------------------------------------------------------------- analytics

/**
 * Ticket volumes and how long they take.
 *
 * Worked out from the queue itself — there is no analytics endpoint, but a ticket
 * carries its own history: when it was raised, and the comment HR left when they
 * resolved it. That comment's timestamp is the close time; `updatedAtMillis` would
 * also move on a reopen, which would understate the age.
 */
export async function fetchTicketAnalytics(): Promise<TicketAnalytics> {
  if (!isLive) return mocked(mockTicketAnalytics())

  const tickets = await fetchTickets()
  const resolved = tickets.filter((ticket) => ticket.status === 'RESOLVED')

  const categories = [...new Set(tickets.map((ticket) => ticket.category))]
  const byCategory = categories.map((category) => {
    const inCategory = tickets.filter((ticket) => ticket.category === category)
    return {
      category,
      raised: inCategory.length,
      open: inCategory.filter((ticket) => ticket.status !== 'RESOLVED').length,
      medianResolutionMillis: median(inCategory.map(resolutionMillis)),
    }
  }).sort((a, b) => b.raised - a.raised)

  return {
    raised: tickets.length,
    resolved: resolved.length,
    medianResolutionMillis: median(tickets.map(resolutionMillis)),
    byCategory,
    volume: lastWeeks(WEEKS_OF_VOLUME).map((weekStartIso) => {
      const end = weekStartIso + 'T23:59:59'
      const weekEnd = new Date(end)
      weekEnd.setDate(weekEnd.getDate() + 6)
      const within = (millis: number) => {
        const at = new Date(millis)
        return at >= new Date(`${weekStartIso}T00:00:00`) && at <= weekEnd
      }
      return {
        weekStartIso,
        raised: tickets.filter((ticket) => within(ticket.createdAtMillis)).length,
        resolved: resolved.filter((ticket) => {
          const closed = closedAt(ticket)
          return closed !== null && within(closed)
        }).length,
      }
    }),
  }
}

/** When HR closed it, from the resolving comment. Null while it is still open. */
function closedAt(ticket: Ticket): number | null {
  if (ticket.status !== 'RESOLVED') return null
  const closing = [...ticket.comments].reverse().find((one) => one.status === 'RESOLVED')
  return closing?.atMillis ?? ticket.updatedAtMillis
}

/** How long a ticket took, or null while it is still open. */
function resolutionMillis(ticket: Ticket): number | null {
  const closed = closedAt(ticket)
  return closed === null ? null : closed - ticket.createdAtMillis
}

/** Median of the values that exist. Null when none do — never a misleading zero. */
function median(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b)
  if (known.length === 0) return null
  const middle = Math.floor(known.length / 2)
  return known.length % 2 === 0 ? (known[middle - 1] + known[middle]) / 2 : known[middle]
}

const WEEKS_OF_VOLUME = 6

/** The Monday of each of the last [count] weeks, oldest first. */
function lastWeeks(count: number): string[] {
  const monday = new Date(`${weekStart(0)}T00:00:00`)
  return Array.from({ length: count }, (_, index) => {
    const week = new Date(monday)
    week.setDate(monday.getDate() - (count - 1 - index) * 7)
    const month = `${week.getMonth() + 1}`.padStart(2, '0')
    const day = `${week.getDate()}`.padStart(2, '0')
    return `${week.getFullYear()}-${month}-${day}`
  })
}

/**
 * What employees ask HR Genie — **not recorded anywhere yet**.
 *
 * There is no endpoint for this because there is no data: the knowledge base answers
 * a question and forgets it. Rather than serve the illustrative mock while the rest
 * of the console is live, this returns zeroes so the page can say plainly that the
 * log does not exist. Inventing deflection rates on a screen HR would use to judge
 * the policy library is the one thing this must not do.
 *
 * The backend needs to log each query and whether it ended in a ticket.
 */
export function fetchChatAnalytics(): Promise<ChatAnalytics> {
  if (isLive) {
    return Promise.resolve({
      questionsAsked: 0,
      answeredByKb: 0,
      escalatedToTickets: 0,
      topQuestions: [],
    })
  }
  return mocked(mockChatAnalytics())
}

// ---------------------------------------------------------------- attendance

/**
 * One row per person for the week.
 *
 * The server returns a flat list — one row per employee per day — so the grouping
 * into weeks happens here. Days with no row at all are filled in as PENDING for a
 * future date and ABSENT for a past one, because a missing row means "nothing
 * recorded", which the grid still has to show.
 */
export async function fetchAttendanceWeek(mondayIso: string): Promise<EmployeeWeek[]> {
  if (!isLive) return mocked(mockAttendanceWeek(mondayIso))

  const days = weekDates(mondayIso)
  const response = await get<{ records: RawAttendance[] }>(
    `/api/hr/attendance?from=${mondayIso}&to=${days[days.length - 1]}`,
  )

  const byEmployee = new Map<string, { name: string; rows: Map<string, RawAttendance> }>()
  response.records.forEach((row) => {
    const entry = byEmployee.get(row.employeeId) ?? {
      name: row.name ?? row.employeeId,
      rows: new Map<string, RawAttendance>(),
    }
    entry.rows.set(row.dateIso, row)
    byEmployee.set(row.employeeId, entry)
  })

  const today = todayIso()
  return [...byEmployee.entries()].map(([employeeId, entry]) => {
    const grid: AttendanceDay[] = days.map((dateIso) => {
      const row = entry.rows.get(dateIso)
      if (row) {
        return {
          dateIso,
          status: row.status,
          checkInMillis: row.checkInMillis,
          checkOutMillis: row.checkOutMillis,
          workedMillis: row.workedMillis ?? 0,
        }
      }
      return {
        dateIso,
        status: dateIso > today ? 'PENDING' : 'ABSENT',
        checkInMillis: null,
        checkOutMillis: null,
        workedMillis: 0,
      }
    })
    return {
      employeeId,
      name: entry.name,
      department: '',
      days: grid,
      totalMillis: grid.reduce((sum, day) => sum + day.workedMillis, 0),
    }
  })
}

interface RawAttendance {
  employeeId: string
  name?: string
  dateIso: string
  status: AttendanceStatus
  checkInMillis: number | null
  checkOutMillis: number | null
  workedMillis: number
}

// ------------------------------------------------------------------ holidays

/**
 * The holiday calendar.
 *
 * Served from [holidaysFor] in both modes. There is no `/api/holidays` yet, and
 * unlike the other gaps this one costs nothing: the calendar is published content
 * that does not change between users, so holding it in the app is correct rather
 * than a stand-in. The endpoint is still tried first, so the day it exists it wins
 * without another change here.
 */
export async function fetchHolidays(year: number): Promise<Holiday[]> {
  const published = holidaysFor(year)
  if (!isLive) return mocked(published)

  return get<Holiday[]>(`/api/holidays?year=${year}`)
    .then((rows) => (rows.length > 0 ? rows : published))
    .catch(() => published)
}

// ---------------------------------------------------------------------- stats

/**
 * The dashboard figures.
 *
 * There is no `/hr/stats` on the server — it returns raw rows — so the totals are
 * worked out here from the directory, today's moods and the ticket queue. Same
 * arithmetic the Android app does in HrAnalytics, for the same reason.
 */
export async function fetchStats(): Promise<HrStats> {
  if (!isLive) return mocked(mockStats())

  const today = todayIso()
  const week = weekDates(weekStart(0))
  const [employees, moods, tickets, pulses, attendance] = await Promise.all([
    fetchEmployees(),
    get<RawMood[]>(`/api/hr/mood?date=${today}`),
    fetchTickets(),
    pagedItems<RawPulse>('/api/pulse/list'),
    get<{ records: RawAttendance[] }>(
      `/api/hr/attendance?from=${week[0]}&to=${week[week.length - 1]}`,
    ),
  ])

  // HR accounts are not subjects of the programme, so they are not in the denominator.
  // Every console role, not just HR: an Admin or a Head is no more their own subject
  // than an HRBP is, and counting them would put staff into their own sentiment figures.
  const workforce = employees.filter((one) => !isConsoleRole(one.role))

  const breakdown: Record<MoodKey, number> = {
    GREAT: 0, GOOD: 0, OKAY: 0, STRESSED: 0, BURNT_OUT: 0,
  }
  moods.forEach((row) => {
    if (row.mood in breakdown) breakdown[row.mood] += 1
  })

  const days = attendance.records
  const todayDays = days.filter((day) => day.dateIso === today)

  return {
    headcount: workforce.length,
    checkedInToday: todayDays.filter((day) => day.checkInMillis !== null).length,
    onTheClock: todayDays.filter(
      (day) => day.checkInMillis !== null && day.checkOutMillis === null,
    ).length,
    moodResponsesToday: moods.length,
    engagementScore: average(
      moods.map((row) => MOODS[row.mood]?.value).filter(isNumber),
    ),
    moodBreakdown: breakdown,
    pulseCompleted: pulses.filter((row) => row.cycle === currentCycle()).length,
    departments: departmentMood(workforce, moods),
    weekPresent: days.filter((day) => day.status === 'PRESENT').length,
    weekHalfDays: days.filter((day) => day.status === 'HALF_DAY').length,
    weekMisPunches: days.filter((day) => day.status === 'MIS_PUNCH').length,
    weekAbsences: days.filter((day) => day.status === 'ABSENT').length,
    weekHoursMillis: days.reduce((total, day) => total + (day.workedMillis ?? 0), 0),
    ticketsOpen: tickets.filter((ticket) => ticket.status === 'OPEN').length,
    ticketsInProgress: tickets.filter((ticket) => ticket.status === 'IN_PROGRESS').length,
    ticketsResolved: tickets.filter((ticket) => ticket.status === 'RESOLVED').length,
  }
}

/**
 * Mood per department.
 *
 * Only departments somebody answered from are returned. With fifty departments on the
 * roll, listing the silent ones would bury the signal in rows of dashes.
 *
 * A score is withheld below [MIN_COHORT] responses. The app promises employees their
 * mood reaches HR "as anonymised trends", and a department average built from one or
 * two people is not a trend — it names them. Suppressed here rather than in the page
 * so the figure never reaches the UI to be leaked by a tooltip or an export.
 */
function departmentMood(workforce: Employee[], moods: RawMood[]): DepartmentMood[] {
  const headcount = new Map<string, number>()
  workforce.forEach((one) => {
    headcount.set(one.department, (headcount.get(one.department) ?? 0) + 1)
  })

  const department = new Map(workforce.map((one) => [one.employeeId, one.department]))
  const scores = new Map<string, number[]>()
  moods.forEach((row) => {
    const name = department.get(row.employeeId)
    const value = MOODS[row.mood]?.value
    if (!name || typeof value !== 'number') return
    scores.set(name, [...(scores.get(name) ?? []), value])
  })

  return [...scores.entries()]
    .map(([name, values]) => ({
      name,
      headcount: headcount.get(name) ?? values.length,
      responses: values.length,
      score: values.length >= MIN_COHORT ? average(values) : null,
    }))
    .sort((a, b) => b.responses - a.responses)
}

function isNumber(value: number | undefined): value is number {
  return typeof value === 'number'
}

/** Null for an empty set — an average of nothing is not zero. */
function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

interface RawMood {
  employeeId: string
  dateIso: string
  mood: MoodKey
  reasons: string[]
}

interface RawPulse {
  employeeId: string
  name?: string
  cycle: string
  answers: Record<string, string>
}

/**
 * Today where the user is, not in UTC.
 *
 * `toISOString()` would roll the date back an hour before midnight IST and ask the
 * server for yesterday's moods — which is exactly what it did.
 */
function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Response rate and average mood, day by day.
 *
 * No history endpoint exists, so the whole check-in list is pulled and bucketed by
 * date here. Every day in the window gets a row even when nobody answered — a gap in
 * the series would otherwise be drawn as a dip rather than as silence.
 */
export async function fetchMoodHistory(days = 14): Promise<DayMood[]> {
  if (!isLive) return mocked(mockMoodHistory())

  const rows = await pagedItems<RawMood>('/api/mood/list')
  const byDate = new Map<string, RawMood[]>()
  rows.forEach((row) => {
    byDate.set(row.dateIso, [...(byDate.get(row.dateIso) ?? []), row])
  })

  return lastDays(days).map((dateIso) => {
    const entries = byDate.get(dateIso) ?? []
    const scores = entries
      .map((entry) => MOODS[entry.mood]?.value)
      .filter((value): value is number => typeof value === 'number')
    return {
      dateIso,
      responses: entries.length,
      score: scores.length
        ? scores.reduce((total, value) => total + value, 0) / scores.length
        : null,
    }
  })
}

/** How many completed the pulse, cycle by cycle. Bucketed from the full list. */
export async function fetchPulseHistory(cycles = 6): Promise<CycleSummary[]> {
  if (!isLive) return mocked(mockPulseHistory())

  const [rows, employees] = await Promise.all([
    pagedItems<RawPulse>('/api/pulse/list'),
    fetchEmployees(),
  ])
  const counts = new Map<string, number>()
  rows.forEach((row) => counts.set(row.cycle, (counts.get(row.cycle) ?? 0) + 1))

  // Headcount is today's for every cycle: the server does not keep a historical
  // roster, and inventing one would make old completion rates look wrong.
  const headcount = employees.filter((one) => !isConsoleRole(one.role)).length
  return lastCycles(cycles).map((cycle) => ({
    cycle,
    completed: counts.get(cycle) ?? 0,
    headcount,
  }))
}

/**
 * How a cycle's answers split across the options.
 *
 * The question bank supplies the wording and, importantly, the option order — the
 * answers themselves are just strings, and a bar chart whose categories reshuffle
 * between cycles is unreadable.
 */
export async function fetchPulseBreakdown(cycle: string): Promise<QuestionBreakdown[]> {
  if (!isLive) return mocked(mockPulseBreakdown(cycle))

  const [rows, questions] = await Promise.all([
    get<RawPulse[]>(`/api/hr/pulse?cycle=${cycle}`),
    get<{ questions: RawQuestion[] }>('/api/pulse/questions'),
  ])

  return questions.questions.map((question) => {
    const chosen = new Map<string, number>()
    rows.forEach((row) => {
      const answer = row.answers?.[question.id]
      if (answer) chosen.set(answer, (chosen.get(answer) ?? 0) + 1)
    })
    return {
      questionId: question.id,
      question: question.question,
      answers: question.options.map((option) => ({
        option,
        count: chosen.get(option) ?? 0,
      })),
    }
  })
}

interface RawQuestion {
  id: string
  question: string
  options: string[]
}

/**
 * Walks a paged endpoint to the end.
 *
 * The server caps a page at 200, and a fortnight of check-ins across a workforce this
 * size runs well past that. Bounded so a runaway total cannot spin forever.
 */
async function pagedItems<T>(path: string): Promise<T[]> {
  const collected: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await get<{ items: T[]; total?: number }>(
      `${path}${separator}page=${page}&limit=${PAGE_LIMIT}`,
    )
    collected.push(...response.items)
    if (response.items.length < PAGE_LIMIT) break
  }
  return collected
}

const PAGE_LIMIT = 200
const MAX_PAGES = 10

/** The last [count] dates, oldest first, in local time. */
function lastDays(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (count - 1 - index))
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  })
}

/** The last [count] months as yyyy-MM, oldest first. */
function lastCycles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() - (count - 1 - index))
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`
  })
}

// ----------------------------------------------------------------- drill-downs

/**
 * Who shared a mood, and what they picked.
 *
 * The reason tags are shown; the free-text note is not — the server does not return
 * it at all, which is the privacy rule holding where it should, in the backend.
 */
export async function fetchMoodDetail(dateIso: string): Promise<PersonEntry[]> {
  if (!isLive) return mocked(mockMoodDetail(dateIso))

  const [rows, employees] = await Promise.all([
    get<RawMood[]>(`/api/hr/mood?date=${dateIso}`),
    fetchEmployees(),
  ])
  const directory = new Map(employees.map((one) => [one.employeeId, one]))

  return rows.map((row) => {
    const employee = directory.get(row.employeeId)
    const mood = MOODS[row.mood]
    return {
      employeeId: row.employeeId,
      name: employee?.name ?? row.employeeId,
      department: employee?.department ?? '',
      subtitle: row.reasons.length ? row.reasons.join(' · ') : 'No reasons given',
      value: `${mood?.emoji ?? ''} ${mood?.label ?? row.mood}`.trim(),
      tone:
        row.mood === 'GREAT' || row.mood === 'GOOD'
          ? 'POSITIVE'
          : row.mood === 'OKAY'
            ? 'NEUTRAL'
            : 'WARNING',
    }
  })
}

/**
 * Who is on the clock today.
 *
 * The "checked in" tile used to open the mood drawer, which meant a tile reading 1
 * opened a list of 0 — two unrelated figures wired to the same drill-down.
 */
export async function fetchAttendanceDetail(dateIso: string): Promise<PersonEntry[]> {
  if (!isLive) return mocked([])

  const [response, employees] = await Promise.all([
    get<{ records: RawAttendance[] }>(`/api/hr/attendance?from=${dateIso}&to=${dateIso}`),
    fetchEmployees(),
  ])
  const directory = new Map(employees.map((one) => [one.employeeId, one]))

  return response.records
    .filter((row) => row.checkInMillis !== null)
    .map((row) => {
      const employee = directory.get(row.employeeId)
      const open = row.checkOutMillis === null
      return {
        employeeId: row.employeeId,
        name: row.name ?? employee?.name ?? row.employeeId,
        department: employee?.department ?? '',
        subtitle: `In ${clockOf(row.checkInMillis!)}${
          open ? '' : ` · out ${clockOf(row.checkOutMillis!)}`
        }`,
        value: open ? 'On the clock' : hoursOf(row.workedMillis),
        tone: open ? 'POSITIVE' : 'NEUTRAL',
      }
    })
}

function clockOf(millis: number): string {
  return new Date(millis).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function hoursOf(millis: number): string {
  const minutes = Math.round(millis / 60000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export async function fetchPulseDetail(cycle: string): Promise<PersonEntry[]> {
  if (!isLive) return mocked(mockPulseDetail(cycle))

  const rows = await get<RawPulse[]>(`/api/hr/pulse?cycle=${cycle}`)
  return rows.map((row) => ({
    employeeId: row.employeeId,
    name: row.name ?? row.employeeId,
    department: '',
    subtitle: `${Object.keys(row.answers).length} answered`,
    value: 'Completed',
    tone: 'POSITIVE',
    breakdown: Object.entries(row.answers).map(([label, value]) => ({ label, value })),
  }))
}

// -------------------------------------------------------------------- tickets

export async function fetchTickets(): Promise<Ticket[]> {
  if (!isLive) return mocked(mockTickets())
  // `/tickets` needs an employeeId; `/tickets/list` is the HR-wide one.
  //
  // Every page, not just the first. The endpoint documents no ordering, so taking
  // page 1 alone was a bet that the newest ticket is on it — and once the queue
  // passes the page limit, a wrong bet hides new tickets entirely rather than
  // failing visibly.
  const tickets = await pagedItems<Ticket>('/api/tickets/list')
  // Newest first regardless of what order the server chose to return them in.
  return [...tickets].sort((a, b) => b.createdAtMillis - a.createdAtMillis)
}

/**
 * Hand a ticket to somebody, or take it back with `null`.
 *
 * Local on the mock path, like every other write here. The endpoint does not exist yet
 * — see docs/TICKET_ASSIGNMENT_BACKEND.md.
 */
/**
 * Today's birthdays, work anniversaries and joiners.
 *
 * The one endpoint on this page, and it answers for today only — everything further
 * ahead is computed from the directory. See src/api/celebrations.ts.
 *
 * A failure is an empty day rather than a broken page: the console still has the
 * directory, so the month ahead renders either way.
 */
export async function fetchCelebrations(): Promise<Celebrations> {
  if (!isLive) return mocked(mockCelebrations())

  const raw = await get<Record<string, unknown>>('/api/employees/celebrations')

  // Whole employee records come back; a bare string is tolerated in case a thinner
  // shape ever appears. Same reading as the bot's, in teams/src/api.ts.
  const people = (value: unknown): Celebrant[] =>
    Array.isArray(value)
      ? value
          .map((row): Celebrant => {
            if (typeof row === 'string') {
              return { name: row, employeeId: '', designation: '', email: '' }
            }
            const one = row as Record<string, unknown>
            return {
              name: String(one.name ?? ''),
              employeeId: String(one.employeeId ?? ''),
              designation: String(one.designation ?? one.title ?? ''),
              // Every spelling the service might use, and never a stand-in: a wish is
              // a deep link to a named person, so the wrong address messages the wrong
              // colleague. Absent, the action does not render.
              email: String(one.officialEmail ?? one.email ?? one.upn ?? ''),
              ...(one.years === undefined ? {} : { years: Number(one.years) }),
            }
          })
          .filter((one) => one.name)
      : []

  return {
    birthdays: people(raw.birthdays),
    anniversaries: people(raw.anniversaries),
    newJoiners: people(raw.newJoiners ?? raw.joiners),
  }
}

export async function assignTicket(id: string, assigneeId: string | null): Promise<Ticket> {
  if (isLive) {
    return request<Ticket>(`/api/tickets/${id}/assignee`, {
      method: 'PATCH',
      body: JSON.stringify({ assigneeId }),
    })
  }

  const updated = mockAssignTicket(id, assigneeId)
  if (!updated) throw new ApiError(`No ticket ${id}`)
  return mocked(updated)
}

export async function updateTicketStatus(
  id: string,
  status: TicketStatus,
  comment: string,
  authorId: string,
): Promise<Ticket> {
  // Closing a request is the one move the employee cannot ask about afterwards, so
  // it has to say what was done. The server enforces this too; this is the fast fail.
  if (status === 'RESOLVED' && comment.trim().length === 0) {
    throw new ApiError('Add a note before resolving — the employee only sees this.')
  }

  if (isLive) {
    return request<Ticket>(`/api/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, comment: comment.trim(), authorId }),
    })
  }

  const updated = mockUpdateTicket(id, status, comment, authorId)
  if (!updated) throw new ApiError(`No ticket ${id}`)
  return mocked(updated)
}

/**
 * A person's name for display.
 *
 * Live directory first, then the mock, then the raw id — so a name is shown when we
 * have one and the id is shown when we do not, rather than a wrong name from the
 * seed data.
 */
export function employeeName(employeeId: string): string {
  return directory.get(employeeId)?.name ?? mockEmployeeName(employeeId)
}

/** The directory record, or a placeholder built from the id when it is not loaded. */
function directoryRecord(employeeId: string): Employee {
  return (
    directory.get(employeeId) ?? {
      employeeId,
      name: mockEmployeeName(employeeId),
      title: '',
      department: '',
      officialEmail: '',
      role: 'EMPLOYEE',
    }
  )
}
