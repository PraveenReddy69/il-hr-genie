/**
 * Editing the holiday calendar.
 *
 * There is no write endpoint — see docs/HOLIDAYS_BACKEND.md. The calendar is hard-coded
 * in three places (this console, the Teams bot, the Android app), so a corrected date
 * currently means editing three codebases and shipping an Android release.
 *
 * Rather than wait, edits are kept in this browser and the page says so, the same way
 * the pulse question bank does. The shapes and the rules here are the ones the endpoint
 * will use, so landing it is a swap of `readLocal` for a fetch rather than a rewrite.
 *
 * **The rules in this file are convenience, not enforcement.** A locked past year is a
 * courtesy to whoever is editing; the server has to refuse the write itself, because
 * nothing here survives contact with a curl command.
 */

import { HOLIDAY_CALENDAR } from './holidays'
import type { Holiday, HolidayKind } from './types'

const STORAGE_KEY = 'hr-genie-holidays'
const SCHEMA = 1

/**
 * The regions a holiday can apply to.
 *
 * A fixed list rather than the free text the records carry today. Free text is why a
 * region filter could not be built from the data: one "Telangana " with a trailing
 * space and the filter grows a second, nearly identical option that matches nothing
 * anybody meant.
 *
 * "All India" first because it is the common case and the sensible default.
 */
export const REGIONS = [
  'All India',
  'Telangana',
  'Andhra Pradesh',
  'Karnataka',
  'Tamil Nadu',
  'Maharashtra',
  'Delhi NCR',
  'West Bengal',
] as const

export type Region = (typeof REGIONS)[number]

export const ANY_REGION = 'All regions'

/**
 * Whether a holiday is settled and may no longer be changed.
 *
 * Two rules, and the second is the one worth arguing about:
 *
 * - A **past year** is closed outright. It is a record of what happened.
 * - Inside the current year, a **date that has already passed** is closed too. People
 *   took that day off. Editing it afterwards rewrites a leave balance somebody has
 *   already spent, and there is no honest way to show that.
 *
 * A holiday later today is still editable — the day is not over, and a correction made
 * this morning to this evening's entry is exactly the case this has to allow.
 */
export function isSettled(isoDate: string, today: string): boolean {
  return isoDate < today
}

export function isClosedYear(year: number, today: string): boolean {
  return year < Number(today.slice(0, 4))
}

/** Why an edit is refused, as a sentence, or null when it is allowed. */
export function refusalFor(isoDate: string, today: string): string | null {
  if (isClosedYear(Number(isoDate.slice(0, 4)), today)) {
    return 'That year is closed. Past calendars are a record and cannot be changed.'
  }
  if (isSettled(isoDate, today)) {
    return 'That date has passed. People have already taken it.'
  }
  return null
}

export interface HolidayDraft {
  name: string
  isoDate: string
  kind: HolidayKind
  region: string
}

/** What is wrong with a draft, as a sentence, or null. */
export function validate(draft: HolidayDraft, existing: Holiday[], today: string): string | null {
  const name = draft.name.trim()
  if (!name) return 'Give the holiday a name.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.isoDate)) return 'Pick a date.'
  if (Number.isNaN(new Date(`${draft.isoDate}T00:00:00`).getTime())) return 'That is not a date.'

  const settled = refusalFor(draft.isoDate, today)
  if (settled) return settled

  if (!REGIONS.includes(draft.region as Region)) return 'Pick a region.'

  // Same day, same region, twice. Two regions sharing a date is normal — a state
  // holiday landing on a national one — so the clash is the pair, not the date.
  const clash = existing.some(
    (one) => one.isoDate === draft.isoDate && one.region === draft.region,
  )
  if (clash) return `${draft.region} already has a holiday on that date.`

  return null
}

interface Stored {
  schema: number
  savedAt: number
  holidays: Holiday[]
}

function readLocal(): Holiday[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (parsed.schema !== SCHEMA || !Array.isArray(parsed.holidays)) return null
    return parsed.holidays
  } catch {
    // A corrupt or half-written entry is not worth a crash on a page somebody opened to
    // read a date. Fall back to the published list.
    return null
  }
}

/** The calendar as it stands, and whether these are local edits the server has not seen. */
export function currentCalendar(): { holidays: Holiday[]; unsaved: boolean } {
  const local = readLocal()
  if (local) return { holidays: sortCalendar(local), unsaved: true }
  return { holidays: sortCalendar(HOLIDAY_CALENDAR), unsaved: false }
}

export function saveCalendar(holidays: Holiday[]): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), holidays: sortCalendar(holidays) }),
  )
}

/** Throws local edits away and goes back to the published calendar. */
export function discardLocal(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Date order, then region so a shared date is stable.
 *
 * Exported because the page needs the same order in memory that storage gets. It did
 * not, briefly: saveCalendar sorted on the way out while the component kept the raw
 * array, so a newly added holiday sat at the bottom of the list until the next reload.
 */
export function sortCalendar(holidays: Holiday[]): Holiday[] {
  return [...holidays].sort(
    (a, b) => a.isoDate.localeCompare(b.isoDate) || a.region.localeCompare(b.region),
  )
}

/** Every year the calendar covers, plus next year, so one can be started. */
export function yearsCovered(holidays: Holiday[], today: string): number[] {
  const years = new Set(holidays.map((one) => Number(one.isoDate.slice(0, 4))))
  const thisYear = Number(today.slice(0, 4))
  // Next year is offered whether or not anything is published in it. A calendar that
  // only lists years already filled in gives nobody a way to start the next one.
  years.add(thisYear)
  years.add(thisYear + 1)
  return [...years].sort((a, b) => a - b)
}

export function inYear(holidays: Holiday[], year: number): Holiday[] {
  return holidays.filter((one) => one.isoDate.startsWith(String(year)))
}

/**
 * Narrow to one region.
 *
 * "All India" days come back whatever region is selected — somebody filtering to
 * Telangana wants the days Telangana observes, which includes every national one, not
 * only the state-specific handful.
 */
export function inRegion(holidays: Holiday[], region: string): Holiday[] {
  if (region === ANY_REGION) return holidays
  return holidays.filter((one) => one.region === region || one.region === 'All India')
}
