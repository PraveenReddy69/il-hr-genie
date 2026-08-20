/**
 * Who sees which ticket.
 *
 * The rule that carries this file: **assignment narrows, it never widens.** Getting it
 * backwards in either direction is a real failure — one way an HRBP keeps seeing a
 * ticket that was handed to a colleague, the other way assigning someone a ticket hands
 * them a department they were never given.
 */

import { describe, expect, it } from 'vitest'
import {
  ANY_ASSIGNEE,
  MINE,
  UNASSIGNED,
  byAssignee,
  canAssign,
  daysWaiting,
  refusalFor,
  suggestedAssignee,
  unassignedCount,
  visibleTickets,
  visibleTo,
} from './ticketQueue'
import type { Employee, Role, Ticket, TicketStatus } from './types'

const person = (employeeId: string, role: Role, extra: Partial<Employee> = {}): Employee => ({
  employeeId,
  name: employeeId,
  title: '',
  department: 'Experience',
  officialEmail: `${employeeId}@example.com`,
  role,
  ...extra,
})

const priya = person('HR000', 'HR', { name: 'Priya', departments: ['Experience'] })
const raj = person('HR003', 'HR', { name: 'Raj', departments: ['Brand Marketing'] })
const admin = person('HR001', 'HR_ADMIN', { name: 'Admin' })
const head = person('HR002', 'HR_HEAD', { name: 'Head' })

const staff: Record<string, string> = {
  EMP1: 'Experience',
  EMP2: 'Brand Marketing',
  EMP3: 'Finance',
}
const departmentOf = (employeeId: string) => staff[employeeId] ?? ''

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 'HRG-0001',
  employeeId: 'EMP1',
  subject: 'A subject',
  category: 'Payroll',
  status: 'OPEN' as TicketStatus,
  createdAtMillis: 1_000,
  updatedAtMillis: 1_000,
  comments: [],
  ...over,
})

describe('who may assign', () => {
  it('is Admin and above', () => {
    expect(canAssign(admin)).toBe(true)
    expect(canAssign(head)).toBe(true)
  })

  it('is not an HRBP', () => {
    // An HRBP works their own queue. Handing tickets around is a workload decision
    // across the team, which is what makes it administrative.
    expect(canAssign(priya)).toBe(false)
    expect(canAssign(null)).toBe(false)
  })

  it('says why rather than just refusing', () => {
    expect(refusalFor(priya, raj)).toMatch(/only an admin/i)
    expect(refusalFor(admin, raj)).toBeNull()
  })

  it('refuses somebody who is not HR at all', () => {
    const employee = person('EMP9', 'EMPLOYEE', { name: 'Sam' })
    expect(refusalFor(admin, employee)).toMatch(/not an HR account/i)
  })

  it('allows unassigning, which has no assignee to check', () => {
    expect(refusalFor(admin, null)).toBeNull()
  })
})

describe('an unassigned ticket', () => {
  it('is in the queue of every HRBP covering that department', () => {
    expect(visibleTo(ticket(), priya, departmentOf)).toBe(true)
  })

  it('is not in the queue of an HRBP covering somewhere else', () => {
    expect(visibleTo(ticket(), raj, departmentOf)).toBe(false)
  })

  it('is visible to Admin whatever the department', () => {
    expect(visibleTo(ticket({ employeeId: 'EMP3' }), admin, departmentOf)).toBe(true)
    expect(visibleTo(ticket({ employeeId: 'EMP3' }), head, departmentOf)).toBe(true)
  })
})

describe('an assigned ticket narrows', () => {
  it('goes to its assignee', () => {
    expect(visibleTo(ticket({ assigneeId: 'HR000' }), priya, departmentOf)).toBe(true)
  })

  it('leaves the queue of everyone else in that department', () => {
    // The whole feature. Without this, assignment is a label: the rest of the
    // department still sees it, still replies, and nothing was handed over.
    const alsoExperience = person('HR004', 'HR', { departments: ['Experience'] })
    expect(visibleTo(ticket({ assigneeId: 'HR000' }), alsoExperience, departmentOf)).toBe(false)
  })

  it('reaches an assignee who does not cover that department', () => {
    // Assigning gives them the ticket, not the department. Raj covers Brand Marketing
    // and can still be handed an Experience ticket.
    expect(visibleTo(ticket({ assigneeId: 'HR003' }), raj, departmentOf)).toBe(true)
  })

  it('does not give that assignee anything else from the department', () => {
    const another = ticket({ id: 'HRG-0009', employeeId: 'EMP1' })
    expect(visibleTo(another, raj, departmentOf)).toBe(false)
  })

  it('stays visible to Admin', () => {
    // Somebody has to find a ticket whose assignee is on leave. That is most of what
    // an escalation is.
    expect(visibleTo(ticket({ assigneeId: 'HR000' }), admin, departmentOf)).toBe(true)
  })
})

describe('the queue as a list', () => {
  const queue = [
    ticket({ id: 'A', employeeId: 'EMP1' }),
    ticket({ id: 'B', employeeId: 'EMP2' }),
    ticket({ id: 'C', employeeId: 'EMP1', assigneeId: 'HR000' }),
    ticket({ id: 'D', employeeId: 'EMP1', assigneeId: 'HR003' }),
  ]

  it('shows an HRBP their own and their unassigned', () => {
    expect(visibleTickets(queue, priya, departmentOf).map((one) => one.id)).toEqual(['A', 'C'])
  })

  it('shows another HRBP only what was handed to them', () => {
    expect(visibleTickets(queue, raj, departmentOf).map((one) => one.id)).toEqual(['B', 'D'])
  })

  it('shows Admin the lot', () => {
    expect(visibleTickets(queue, admin, departmentOf)).toHaveLength(4)
  })
})

describe('filtering by assignee', () => {
  const queue = [
    ticket({ id: 'A' }),
    ticket({ id: 'B', assigneeId: 'HR000' }),
    ticket({ id: 'C', assigneeId: 'HR003' }),
  ]

  it('finds what nobody owns', () => {
    expect(byAssignee(queue, UNASSIGNED, 'HR000').map((one) => one.id)).toEqual(['A'])
  })

  it('finds mine', () => {
    expect(byAssignee(queue, MINE, 'HR000').map((one) => one.id)).toEqual(['B'])
  })

  it('finds one person by id', () => {
    expect(byAssignee(queue, 'HR003', 'HR000').map((one) => one.id)).toEqual(['C'])
  })

  it('leaves everything alone for anyone', () => {
    expect(byAssignee(queue, ANY_ASSIGNEE, 'HR000')).toHaveLength(3)
  })
})

describe('suggesting an assignee', () => {
  const hrAccounts = [priya, raj, admin]

  it('prefers the HRBP the directory tags on the employee', () => {
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Finance', hrbpId: 'HR003' })
    expect(suggestedAssignee(hrAccounts, employee)?.employeeId).toBe('HR003')
  })

  it('falls back to whoever covers the department', () => {
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Experience' })
    expect(suggestedAssignee(hrAccounts, employee)?.employeeId).toBe('HR000')
  })

  it('suggests nobody when the tagged HRBP is not an HR account here', () => {
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Finance', hrbpId: 'GONE' })
    expect(suggestedAssignee(hrAccounts, employee)).toBeNull()
  })

  it('suggests nobody for a department no HRBP covers', () => {
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Finance' })
    expect(suggestedAssignee(hrAccounts, employee)).toBeNull()
  })

  it('suggests nobody when the employee is not in the directory', () => {
    expect(suggestedAssignee(hrAccounts, undefined)).toBeNull()
  })

  it('never suggests an Admin', () => {
    // Admin assigns; Admin is not the default person to do the work.
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Nowhere' })
    expect(suggestedAssignee([admin], employee)).toBeNull()
  })
})

describe('how long something has been waiting', () => {
  const now = 10 * 86_400_000

  it('counts from the last movement, not from when it was raised', () => {
    // A ticket commented on yesterday is not five days stale because it was opened
    // last week. Counting from creation is how an ageing list stops being read.
    const chased = ticket({ createdAtMillis: 0, updatedAtMillis: 9 * 86_400_000 })
    expect(daysWaiting(chased, now)).toBe(1)
  })

  it('is zero for anything resolved', () => {
    const done = ticket({ status: 'RESOLVED', updatedAtMillis: 0 })
    expect(daysWaiting(done, now)).toBe(0)
  })
})

describe('what to put on the page', () => {
  it('counts open tickets nobody owns', () => {
    const queue = [
      ticket({ id: 'A' }),
      ticket({ id: 'B', assigneeId: 'HR000' }),
      ticket({ id: 'C', status: 'RESOLVED' }),
    ]
    // Resolved and unassigned is not a problem — nobody needs to pick it up.
    expect(unassignedCount(queue)).toBe(1)
  })
})

describe('the unassigned chip and the unassigned list agree', () => {
  const queue = [
    ticket({ id: 'A' }),
    ticket({ id: 'B', status: 'RESOLVED' }),
    ticket({ id: 'C', assigneeId: 'HR000' }),
  ]

  it('counts and lists the same tickets', () => {
    // They did not. The chip read "Unassigned 2" above a list of four, because the
    // count excluded resolved tickets and the filter did not. Whichever definition
    // wins, one of them has to — this is the test that says so.
    expect(byAssignee(queue, UNASSIGNED, 'HR000')).toHaveLength(unassignedCount(queue))
  })

  it('leaves a resolved ticket out of both', () => {
    // It is finished. Nobody has to pick it up, so it is not work waiting for an owner
    // however empty its assignee field happens to be.
    expect(byAssignee(queue, UNASSIGNED, 'HR000').map((one) => one.id)).toEqual(['A'])
    expect(unassignedCount(queue)).toBe(1)
  })
})
