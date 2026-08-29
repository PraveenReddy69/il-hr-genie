/**
 * Dates, mostly — which is why these exist.
 *
 * Every rule here is an off-by-one waiting to happen: an anniversary that has already
 * gone this year, a leap-day joiner, somebody who started last week and would otherwise
 * be congratulated on their zeroth anniversary. None of it needs a backend or a DOM.
 */

import { describe, expect, it } from 'vitest'
import {
  LOOKAHEAD_DAYS,
  daysBetween,
  inViewerScope,
  isNewJoiner,
  nextAnniversary,
  totalToday,
  upcoming,
  wishHref,
  withDepartments,
  type Celebrant,
} from './celebrations'
import type { Employee, Role } from './types'

const TODAY = '2026-08-18'

const person = (
  employeeId: string,
  over: Partial<Employee> = {},
  role: Role = 'EMPLOYEE',
): Employee => ({
  employeeId,
  name: employeeId,
  title: 'Engineer',
  department: 'Experience',
  officialEmail: `${employeeId}@example.com`,
  role,
  ...over,
})

describe('counting days', () => {
  it('counts forwards and backwards', () => {
    expect(daysBetween('2026-08-18', '2026-08-20')).toBe(2)
    expect(daysBetween('2026-08-20', '2026-08-18')).toBe(-2)
    expect(daysBetween(TODAY, TODAY)).toBe(0)
  })

  it('counts across a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3)
  })
})

describe('the next work anniversary', () => {
  it('finds this year when it is still ahead', () => {
    expect(nextAnniversary('2022-10-01', TODAY)).toEqual({ isoDate: '2026-10-01', years: 4 })
  })

  it('rolls to next year when this year has gone', () => {
    // The one everybody gets wrong. A June joiner in August is eleven months away,
    // not two months behind.
    expect(nextAnniversary('2022-06-02', TODAY)).toEqual({ isoDate: '2027-06-02', years: 5 })
  })

  it('counts today as still ahead', () => {
    // Their anniversary is today. Rolling it to next year would hide the one day it
    // actually matters.
    expect(nextAnniversary('2020-08-18', TODAY)).toEqual({ isoDate: '2026-08-18', years: 6 })
  })

  it('gives a recent joiner their first anniversary next year', () => {
    // Seventeen days in. Their first anniversary is real and a year away — they are
    // also a new joiner today, which is a separate row rather than a competing one.
    expect(nextAnniversary('2026-08-01', TODAY)).toEqual({ isoDate: '2027-08-01', years: 1 })
  })

  it('has nothing to celebrate for somebody who has not started', () => {
    // A signed offer with a start date next month would otherwise show a zeroth
    // anniversary. That is what the years guard is really for.
    expect(nextAnniversary('2026-09-01', TODAY)).toBeNull()
  })

  it('marks a leap-day joiner on 28 February in a common year', () => {
    // 2027 is not a leap year. The 29th does not exist, and 1 March moves the
    // celebration into the wrong month.
    expect(nextAnniversary('2024-02-29', TODAY)).toEqual({ isoDate: '2027-02-28', years: 3 })
  })

  it('puts a leap-day joiner back on the 29th in a leap year', () => {
    expect(nextAnniversary('2024-02-29', '2028-01-01')).toEqual({
      isoDate: '2028-02-29',
      years: 4,
    })
  })

  it('ignores a date it cannot read rather than inventing one', () => {
    expect(nextAnniversary('', TODAY)).toBeNull()
    expect(nextAnniversary('01-10-2022', TODAY)).toBeNull()
  })
})

describe('who counts as a new joiner', () => {
  it('includes somebody who started today', () => {
    expect(isNewJoiner(TODAY, TODAY)).toBe(true)
  })

  it('includes somebody inside the window', () => {
    expect(isNewJoiner('2026-08-01', TODAY)).toBe(true)
  })

  it('drops somebody past it', () => {
    expect(isNewJoiner('2026-06-01', TODAY)).toBe(false)
  })

  it('drops a start date in the future', () => {
    // A signed offer is not a joiner yet, and welcoming somebody who has not turned
    // up is worse than being a day late.
    expect(isNewJoiner('2026-09-01', TODAY)).toBe(false)
  })
})

describe('the month ahead', () => {
  const staff = [
    person('EMP1', { name: 'Long server', dateOfJoining: '2022-08-25' }),
    person('EMP2', { name: 'Just joined', dateOfJoining: '2026-08-10' }),
    person('EMP3', { name: 'Far off', dateOfJoining: '2021-03-04' }),
    person('HR001', { name: 'An admin', dateOfJoining: '2019-08-20' }, 'HR_ADMIN'),
  ]

  it('lists anniversaries falling inside the window', () => {
    const rows = upcoming(staff, TODAY)
    const anniversaries = rows.filter((one) => one.kind === 'ANNIVERSARY')
    expect(anniversaries.map((one) => one.person.name)).toEqual(['Long server'])
    expect(anniversaries[0].person.years).toBe(4)
    expect(anniversaries[0].inDays).toBe(7)
  })

  it('lists recent joiners, dated back rather than forward', () => {
    const joiner = upcoming(staff, TODAY).find((one) => one.kind === 'JOINER')
    expect(joiner?.person.name).toBe('Just joined')
    expect(joiner?.inDays).toBe(-8)
  })

  it('leaves out anniversaries beyond the window', () => {
    expect(upcoming(staff, TODAY).some((one) => one.person.name === 'Far off')).toBe(false)
  })

  it('leaves out HR accounts, as every other figure in this console does', () => {
    expect(upcoming(staff, TODAY).some((one) => one.person.name === 'An admin')).toBe(false)
  })

  it('sorts soonest first, with joiners already past leading', () => {
    expect(upcoming(staff, TODAY).map((one) => one.inDays)).toEqual([-8, 7])
  })

  it('skips anybody with no joining date rather than guessing one', () => {
    expect(upcoming([person('EMP9')], TODAY)).toEqual([])
  })

  it('never returns a birthday, because the directory holds no date of birth', () => {
    // Stated as a test so that adding one is a deliberate act rather than a surprise.
    expect(upcoming(staff, TODAY, LOOKAHEAD_DAYS).some((one) => one.kind === 'BIRTHDAY')).toBe(
      false,
    )
  })
})

describe('scoping the list to an HRBP', () => {
  const hrbp = person('HR000', { departments: ['Experience'] }, 'HR')
  const admin = person('HR001', {}, 'HR_ADMIN')
  const rows = [
    { department: 'Experience', name: 'in scope' },
    { department: 'Finance', name: 'out of scope' },
    { name: 'unknown to the directory' },
  ]

  it('keeps only their departments', () => {
    expect(inViewerScope(rows, hrbp).map((one) => one.name)).toEqual(['in scope'])
  })

  it('shows an Admin everyone', () => {
    expect(inViewerScope(rows, admin)).toHaveLength(3)
  })

  it('keeps their own people whatever the department', () => {
    /*
     * The tag, which is how the API scopes. Scoping on department alone showed an
     * HRBP nobody: `departments` is empty on every HRBP account today, and an empty
     * scope means nobody by design.
     */
    const tagged = [
      { department: 'Finance', name: 'mine', hrbpId: hrbp.employeeId },
      { department: 'Finance', name: 'somebody else’s', hrbpId: 'HR999' },
    ]
    const unscoped = { ...hrbp, departments: [] }

    expect(inViewerScope(tagged, unscoped).map((one) => one.name)).toEqual(['mine'])
  })

  it('hides somebody the directory does not know from a scoped account', () => {
    // The safe direction. An unknown person shown to everybody is the leak; shown to
    // nobody, it is a gap that gets reported.
    expect(inViewerScope(rows, hrbp).some((one) => one.name.includes('unknown'))).toBe(false)
  })
})

describe('filling in departments the endpoint does not send', () => {
  const directory = [person('EMP1', { department: 'Growth' })]

  it('takes the department from the directory', () => {
    const filled = withDepartments([celebrant('EMP1')], directory)
    expect(filled[0].department).toBe('Growth')
  })

  it('leaves it undefined for somebody not in the directory', () => {
    const filled = withDepartments([celebrant('EMP9')], directory)
    expect(filled[0].department).toBeUndefined()
  })
})

describe('wishing somebody', () => {
  it('opens a Teams chat with their work address', () => {
    const href = wishHref(celebrant('EMP1', 'aamy.cp@example.com'))
    expect(href).toContain('teams.microsoft.com')
    expect(href).toContain(encodeURIComponent('aamy.cp@example.com'))
  })

  it('offers nothing without an address', () => {
    // The endpoint sends no email today. A button that opens an empty chat, or worse
    // a chat with the wrong colleague, is not better than no button.
    expect(wishHref(celebrant('EMP1', ''))).toBeNull()
  })
})

describe('what today adds up to', () => {
  it('counts all three kinds', () => {
    expect(
      totalToday({
        birthdays: [celebrant('EMP1')],
        anniversaries: [celebrant('EMP2'), celebrant('EMP3')],
        newJoiners: [],
      }),
    ).toBe(3)
  })
})

function celebrant(employeeId: string, email = `${employeeId}@example.com`): Celebrant {
  return { name: employeeId, employeeId, designation: 'Engineer', email }
}
