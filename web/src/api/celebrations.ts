/**
 * Birthdays, work anniversaries and new joiners.
 *
 * Two sources, deliberately, because the console can see further ahead than the bot:
 *
 *   **Today** comes from `/api/employees/celebrations`, which answers for today and
 *   only today. It is the sole source of birthdays — the directory does not carry a
 *   date of birth, and should not: this console runs the sentiment programme, it is
 *   not a personnel record browser.
 *
 *   **Coming up** is computed here from `dateOfJoining`, which the directory already
 *   returns. That covers anniversaries and joiners for as far ahead as anyone wants,
 *   with no endpoint at all.
 *
 * So the month ahead has two of the three kinds in it and the page says why. An
 * honestly incomplete list beats a complete-looking one that quietly omits birthdays.
 */

import { inScope, scopeOf } from './access'
import type { Employee } from './types'

/** One person with something to celebrate. Mirrors the bot's shape in teams/src/api.ts. */
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
   * Empty today — the endpoint does not return one. See docs/CELEBRATIONS_BACKEND.md.
   * Without it there is nobody to open a chat with, so the Wish action hides itself
   * rather than opening an empty one.
   */
  email: string
  /** Filled in from the directory, so the list can be scoped to an HRBP. */
  department?: string
}

export interface Celebrations {
  birthdays: Celebrant[]
  anniversaries: Celebrant[]
  newJoiners: Celebrant[]
}

export const EMPTY_CELEBRATIONS: Celebrations = {
  birthdays: [],
  anniversaries: [],
  newJoiners: [],
}

export type CelebrationKind = 'BIRTHDAY' | 'ANNIVERSARY' | 'JOINER'

export const KIND_LABEL: Record<CelebrationKind, string> = {
  BIRTHDAY: 'Birthday',
  ANNIVERSARY: 'Work anniversary',
  JOINER: 'New joiner',
}

/** How far ahead the page looks, and how far back a joiner still counts as new. */
export const LOOKAHEAD_DAYS = 30
export const NEW_JOINER_DAYS = 30

export interface UpcomingEntry {
  kind: CelebrationKind
  isoDate: string
  /** Days from today. 0 is today. */
  inDays: number
  person: Celebrant
}

const DAY = 86_400_000

function toDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toDate(toIso).getTime() - toDate(fromIso).getTime()) / DAY)
}

/**
 * The next time a joining date comes round, and which anniversary it will be.
 *
 * Returns null before the first one: somebody who joined last month has a "0th
 * anniversary" coming up, which is not a thing anybody celebrates — they are a new
 * joiner, which is a different row.
 *
 * A 29 February joiner is marked on 28 February in a common year. The alternative,
 * 1 March, moves the celebration into the wrong month; the alternative of skipping
 * three years in four is worse still.
 */
export function nextAnniversary(
  joinedIso: string,
  todayIso: string,
): { isoDate: string; years: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedIso)) return null

  const joinedYear = Number(joinedIso.slice(0, 4))
  const month = Number(joinedIso.slice(5, 7))
  const day = Number(joinedIso.slice(8, 10))
  const thisYear = Number(todayIso.slice(0, 4))

  const on = (year: number): string => {
    const last = new Date(year, month, 0).getDate()
    return `${year}-${`${month}`.padStart(2, '0')}-${`${Math.min(day, last)}`.padStart(2, '0')}`
  }

  // This year's if it has not gone by, otherwise next year's.
  const candidate = on(thisYear) >= todayIso ? on(thisYear) : on(thisYear + 1)
  const years = Number(candidate.slice(0, 4)) - joinedYear
  if (years < 1) return null
  return { isoDate: candidate, years }
}

export function isNewJoiner(joinedIso: string, todayIso: string, within = NEW_JOINER_DAYS): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedIso)) return false
  const ago = daysBetween(joinedIso, todayIso)
  return ago >= 0 && ago <= within
}

function celebrantOf(employee: Employee, years?: number): Celebrant {
  return {
    name: employee.name,
    employeeId: employee.employeeId,
    designation: employee.title,
    email: employee.officialEmail,
    department: employee.department,
    ...(years === undefined ? {} : { years }),
  }
}

/**
 * Anniversaries and joiners in the window, soonest first.
 *
 * No birthdays: the directory has no date of birth. That is not an oversight to fix
 * here — see the note at the top of this file.
 */
export function upcoming(
  employees: Employee[],
  todayIso: string,
  withinDays = LOOKAHEAD_DAYS,
): UpcomingEntry[] {
  const entries: UpcomingEntry[] = []

  for (const employee of employees) {
    // HR accounts are not their own subject anywhere else in this console either.
    if (employee.role !== 'EMPLOYEE') continue
    const joined = employee.dateOfJoining
    if (!joined) continue

    if (isNewJoiner(joined, todayIso)) {
      entries.push({
        kind: 'JOINER',
        isoDate: joined,
        inDays: -daysBetween(joined, todayIso),
        person: celebrantOf(employee),
      })
    }

    const next = nextAnniversary(joined, todayIso)
    if (next) {
      const inDays = daysBetween(todayIso, next.isoDate)
      if (inDays >= 0 && inDays <= withinDays) {
        entries.push({
          kind: 'ANNIVERSARY',
          isoDate: next.isoDate,
          inDays,
          person: celebrantOf(employee, next.years),
        })
      }
    }
  }

  // Soonest first; a joiner who started last week sorts before today's anniversary
  // only if it actually happened first, so ties break on the date itself.
  return entries.sort((a, b) => a.inDays - b.inDays || a.isoDate.localeCompare(b.isoDate))
}

/**
 * Only this account's own people. Admin and above see everyone.
 *
 * Unlike the ticket queue, `/api/employees/celebrations` is **not** scoped server-side —
 * it returns the whole organisation to anybody who asks — so this narrowing is doing
 * real work rather than duplicating the API's.
 *
 * It reads the tag first and the department second, in that order, because that is the
 * order the API now scopes by. Scoping on department alone left an HRBP seeing nobody:
 * `departments` is empty on every HRBP account, and an empty scope means nothing by
 * design.
 *
 * A celebrant the directory does not know has neither field and stays hidden. That is
 * the safe direction: an unknown person shown to everybody is a leak, an unknown person
 * shown to nobody is a gap somebody will report.
 */
export function inViewerScope<T extends { department?: string; hrbpId?: string }>(
  rows: T[],
  viewer: Employee,
): T[] {
  if (scopeOf(viewer) === null) return rows
  return rows.filter(
    (row) => row.hrbpId === viewer.employeeId || inScope(viewer, row.department ?? ''),
  )
}

/**
 * Fills in the department the endpoint does not send, so the list can be scoped.
 *
 * A celebrant the directory does not know keeps an undefined department and is
 * therefore invisible to a scoped HRBP — the safe direction to fail. An unknown person
 * shown to everybody is the leak; an unknown person shown to nobody is a gap somebody
 * will report.
 */
export function withDepartments(people: Celebrant[], directory: Employee[]): Celebrant[] {
  const byId = new Map(directory.map((one) => [one.employeeId, one]))
  return people.map((one) => {
    const known = byId.get(one.employeeId)
    // The tag as well as the department: it is what the scope check reads first, and
    // the celebrations endpoint sends neither.
    return { ...one, department: known?.department, hrbpId: known?.hrbpId }
  })
}

export function totalToday(today: Celebrations): number {
  return today.birthdays.length + today.anniversaries.length + today.newJoiners.length
}

/** A "wish" opens a Teams chat with the person. No email, no button — see Celebrant. */
export function wishHref(person: Celebrant): string | null {
  if (!person.email) return null
  return `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(person.email)}`
}
