/**
 * The rules the holiday calendar is edited by.
 *
 * Pure: no storage, no network. The endpoints landed — `GET/POST/PATCH/DELETE
 * /api/holidays` plus `/api/holidays/regions` — so the page reads and writes through
 * client.ts and this file is only the arithmetic around it.
 *
 * **These rules are convenience, not enforcement.** A locked past year is a courtesy to
 * whoever is editing; the server refuses the write itself, because nothing here
 * survives contact with a curl command. See docs/HOLIDAYS_BACKEND.md §"What may not be
 * changed" — it answers 409, and the page shows that message rather than this one.
 */

import type { Holiday, HolidayKind } from './types'

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

/**
 * What is wrong with a draft, as a sentence, or null.
 *
 * `regions` is passed in rather than read from the constant: the server owns that list
 * now, and validating against a copy this console happens to ship would reject a region
 * somebody added server-side an hour ago.
 */
export function validate(
  draft: HolidayDraft,
  existing: Holiday[],
  today: string,
  regions: readonly string[] = REGIONS,
): string | null {
  const name = draft.name.trim()
  if (!name) return 'Give the holiday a name.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.isoDate)) return 'Pick a date.'
  if (Number.isNaN(new Date(`${draft.isoDate}T00:00:00`).getTime())) return 'That is not a date.'

  const settled = refusalFor(draft.isoDate, today)
  if (settled) return settled

  if (!regions.includes(draft.region)) return 'Pick a region.'

  // Same day, same region, twice. Two regions sharing a date is normal — a state
  // holiday landing on a national one — so the clash is the pair, not the date.
  const clash = existing.some(
    (one) => one.isoDate === draft.isoDate && one.region === draft.region,
  )
  if (clash) return `${draft.region} already has a holiday on that date.`

  return null
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
