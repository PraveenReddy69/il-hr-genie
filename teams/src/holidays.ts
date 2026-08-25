/**
 * The published Infinity Learn holiday calendar.
 *
 * This file used to *be* the calendar — ten dates, hard-coded, copied from the console
 * because no endpoint served them. `GET /api/holidays` exists now and HR edits it from
 * the console, so the list lives there and this file only says what one looks like.
 *
 * There is deliberately no built-in copy left to fall back on. A stale calendar is
 * worse than a missing one: a holiday HR withdrew would keep being shown here, and
 * somebody would not come to work on a day the company expected them. When the service
 * cannot be reached, the bot says so.
 *
 * Fixed days are paid holidays everyone gets. Optional days are chosen by the
 * employee from a published list, and some are state-specific.
 */

export interface Holiday {
  name: string
  isoDate: string
  kind: 'FIXED' | 'OPTIONAL'
  region: string
}

/** In date order. The server's order is not guaranteed and the card reads top-down. */
export function inDateOrder(holidays: Holiday[]): Holiday[] {
  return [...holidays].sort((a, b) => a.isoDate.localeCompare(b.isoDate))
}

/** Years a calendar covers, so the tab offers only years it can show. */
export function yearsIn(holidays: Holiday[]): number[] {
  return [...new Set(holidays.map((one) => Number(one.isoDate.slice(0, 4))))].sort()
}
