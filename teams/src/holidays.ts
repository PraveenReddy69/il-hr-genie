/**
 * The published Infinity Learn holiday calendar.
 *
 * The same list the HRBP console and the Android app ship, copied rather than fetched
 * because no endpoint serves it — see the note in web/src/api/holidays.ts. If one is
 * ever added, this file is the only thing that changes.
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

export const HOLIDAY_CALENDAR: Holiday[] = [
  { name: 'New Year', isoDate: '2026-01-01', kind: 'FIXED', region: 'All India' },
  {
    name: 'Makara Sankranti / Pongal',
    isoDate: '2026-01-15',
    kind: 'FIXED',
    region: 'All India',
  },
  { name: 'Republic Day', isoDate: '2026-01-26', kind: 'FIXED', region: 'All India' },
  { name: 'Holi', isoDate: '2026-03-04', kind: 'OPTIONAL', region: 'All India' },
  { name: 'May Day', isoDate: '2026-05-01', kind: 'FIXED', region: 'All India' },
  {
    name: 'Telangana Formation Day',
    isoDate: '2026-06-02',
    kind: 'OPTIONAL',
    region: 'Telangana',
  },
  { name: 'Independence Day', isoDate: '2026-08-15', kind: 'FIXED', region: 'All India' },
  { name: 'Gandhi Jayanti', isoDate: '2026-10-02', kind: 'FIXED', region: 'All India' },
  { name: 'Vijaya Dashami', isoDate: '2026-10-21', kind: 'FIXED', region: 'All India' },
  { name: 'Christmas Day', isoDate: '2026-12-25', kind: 'FIXED', region: 'All India' },
]

/** The calendar for one year, in date order. */
export function holidaysFor(year: number): Holiday[] {
  return HOLIDAY_CALENDAR.filter((holiday) =>
    holiday.isoDate.startsWith(String(year)),
  ).sort((a, b) => a.isoDate.localeCompare(b.isoDate))
}

/** Years the calendar covers, so the page offers only years it can show. */
export function holidayYears(): number[] {
  return [...new Set(HOLIDAY_CALENDAR.map((holiday) => Number(holiday.isoDate.slice(0, 4))))]
    .sort()
}
