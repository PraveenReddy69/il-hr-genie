/**
 * The holiday rules.
 *
 * Mostly about refusing things. The interesting cases are the boundaries — the day
 * itself, the turn of the year, a state holiday landing on a national one — and every
 * one of them is a date comparison somebody will get wrong by one.
 *
 * `today` is passed in everywhere rather than read from the clock, so a test that
 * passes in December still passes in January.
 */

import { describe, expect, it } from 'vitest'
import {
  ANY_REGION,
  REGIONS,
  inRegion,
  inYear,
  isClosedYear,
  isSettled,
  refusalFor,
  validate,
  yearsCovered,
  type HolidayDraft,
} from './holidayStore'
import type { Holiday } from './types'

const TODAY = '2026-08-18'

const holiday = (isoDate: string, region = 'All India', name = 'A day'): Holiday => ({
  name,
  isoDate,
  kind: 'FIXED',
  region,
})

const draft = (over: Partial<HolidayDraft> = {}): HolidayDraft => ({
  name: 'Diwali',
  isoDate: '2026-11-08',
  kind: 'FIXED',
  region: 'All India',
  ...over,
})

describe('what is settled', () => {
  it('closes a date that has passed', () => {
    expect(isSettled('2026-08-17', TODAY)).toBe(true)
  })

  it('leaves today open', () => {
    // The day is not over. A correction made this morning to this evening's entry is
    // the case this has to allow, and the obvious `<=` would refuse it.
    expect(isSettled(TODAY, TODAY)).toBe(false)
  })

  it('leaves the rest of the year open', () => {
    expect(isSettled('2026-12-25', TODAY)).toBe(false)
  })

  it('closes a past year outright', () => {
    expect(isClosedYear(2025, TODAY)).toBe(true)
    expect(isClosedYear(2026, TODAY)).toBe(false)
    expect(isClosedYear(2027, TODAY)).toBe(false)
  })
})

describe('refusals say why', () => {
  it('names the closed year for last year', () => {
    expect(refusalFor('2025-12-25', TODAY)).toMatch(/year is closed/i)
  })

  it('names the passed date inside this year', () => {
    // A different sentence from the closed-year one on purpose: "that year is closed"
    // is nonsense said about a date three days ago.
    expect(refusalFor('2026-08-15', TODAY)).toMatch(/has passed/i)
  })

  it('allows anything still ahead', () => {
    expect(refusalFor('2026-10-02', TODAY)).toBeNull()
    expect(refusalFor('2027-01-01', TODAY)).toBeNull()
  })
})

describe('validating a new holiday', () => {
  const existing = [holiday('2026-10-02'), holiday('2026-06-02', 'Telangana')]

  it('accepts an ordinary one', () => {
    expect(validate(draft(), existing, TODAY)).toBeNull()
  })

  it('wants a name', () => {
    expect(validate(draft({ name: '   ' }), existing, TODAY)).toMatch(/name/i)
  })

  it('wants a real date', () => {
    expect(validate(draft({ isoDate: '' }), existing, TODAY)).toMatch(/date/i)
    expect(validate(draft({ isoDate: '08-11-2026' }), existing, TODAY)).toMatch(/date/i)
  })

  it('refuses a date in the past, with the reason', () => {
    expect(validate(draft({ isoDate: '2026-01-01' }), existing, TODAY)).toMatch(/has passed/i)
  })

  it('refuses a region that is not on the list', () => {
    expect(validate(draft({ region: 'Atlantis' }), existing, TODAY)).toMatch(/region/i)
  })

  it('refuses the same date twice in one region', () => {
    const clash = draft({ isoDate: '2026-10-02', region: 'All India' })
    expect(validate(clash, existing, TODAY)).toMatch(/already has a holiday/i)
  })

  it('allows two regions to share a date', () => {
    // Normal, not a clash: a state holiday landing on a national one. Keying the check
    // on the date alone would refuse every state calendar.
    const alongside = draft({ isoDate: '2026-10-02', region: 'Karnataka' })
    expect(validate(alongside, existing, TODAY)).toBeNull()
  })
})

describe('filtering', () => {
  const calendar = [
    holiday('2026-01-01', 'All India', 'New Year'),
    holiday('2026-06-02', 'Telangana', 'Telangana Formation Day'),
    holiday('2026-11-01', 'Karnataka', 'Kannada Rajyotsava'),
    holiday('2027-01-01', 'All India', 'New Year'),
  ]

  it('narrows to a year', () => {
    expect(inYear(calendar, 2026)).toHaveLength(3)
    expect(inYear(calendar, 2027)).toHaveLength(1)
    expect(inYear(calendar, 2024)).toHaveLength(0)
  })

  it('keeps national days in every region', () => {
    // Somebody filtering to Telangana wants the days Telangana observes, which is the
    // national list plus the state one — not the state-specific handful on its own.
    const telangana = inRegion(calendar, 'Telangana')
    expect(telangana.map((one) => one.name)).toEqual([
      'New Year',
      'Telangana Formation Day',
      'New Year',
    ])
  })

  it('leaves out other states', () => {
    expect(inRegion(calendar, 'Telangana').some((one) => one.region === 'Karnataka')).toBe(false)
  })

  it('returns everything for the any-region option', () => {
    expect(inRegion(calendar, ANY_REGION)).toHaveLength(calendar.length)
  })

  it('combines with the year filter the way the page does', () => {
    const shown = inRegion(inYear(calendar, 2026), 'Karnataka')
    expect(shown.map((one) => one.name)).toEqual(['New Year', 'Kannada Rajyotsava'])
  })
})

describe('the year picker', () => {
  it('offers this year and next even with nothing published in them', () => {
    // A picker listing only years already filled in gives nobody a way to start the
    // next one, which is the single thing an Admin opens this page in December to do.
    expect(yearsCovered([], TODAY)).toEqual([2026, 2027])
  })

  it('keeps past years so the record stays reachable', () => {
    const years = yearsCovered([holiday('2024-01-01'), holiday('2026-01-01')], TODAY)
    expect(years).toEqual([2024, 2026, 2027])
  })

  it('does not repeat a year that is both published and current', () => {
    expect(yearsCovered([holiday('2026-05-01'), holiday('2026-08-15')], TODAY)).toEqual([
      2026, 2027,
    ])
  })
})

describe('the region list', () => {
  it('leads with the common case', () => {
    expect(REGIONS[0]).toBe('All India')
  })

  it('has no duplicates or stray whitespace', () => {
    // The reason regions are a fixed list rather than free text: one "Telangana " with
    // a trailing space becomes a second option in the filter that matches nothing.
    expect(new Set(REGIONS).size).toBe(REGIONS.length)
    for (const region of REGIONS) expect(region).toBe(region.trim())
  })
})
