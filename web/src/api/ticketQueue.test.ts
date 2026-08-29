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
  assignmentSuggestion,
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
  /*
   * Scope is no longer decided here.
   *
   * The API scopes the queue by the HRBP tagged on each raiser, and these rows arrive
   * already narrowed. This module used to re-derive that from `viewer.departments`;
   * when the API moved to the tag, the stale copy deleted every row and an HRBP with
   * thirty-six tickets saw an empty queue.
   */
  it('is in the queue of whoever the server sent it to', () => {
    expect(visibleTo(ticket(), priya)).toBe(true)
  })

  it('does not second-guess the server with a department rule of its own', () => {
    // Raj covers Brand Marketing and the raiser is in Experience. Once this row has
    // been handed to him, hiding it is the console overruling the API on a question
    // the API is the authority on.
    expect(visibleTo(ticket(), raj)).toBe(true)
  })

  it('is visible to Admin, who is sent everything', () => {
    expect(visibleTo(ticket({ employeeId: 'EMP3' }), admin)).toBe(true)
    expect(visibleTo(ticket({ employeeId: 'EMP3' }), head)).toBe(true)
  })

  it('is not hidden from an HRBP whose departments are empty', () => {
    // The regression, stated directly. Every HRBP account has `departments: []` today,
    // and an empty scope means nobody — so the old rule emptied the queue for all of
    // them at once.
    const untagged = person('HR009', 'HR', { departments: [] })
    expect(visibleTo(ticket(), untagged)).toBe(true)
  })
})

describe('an assigned ticket narrows', () => {
  it('goes to its assignee', () => {
    expect(visibleTo(ticket({ assigneeId: 'HR000' }), priya)).toBe(true)
  })

  it('leaves the queue of everyone else', () => {
    // The whole feature, and the one narrowing the console still owns: the API does
    // not apply it yet. Without this, assignment is a label — everyone in scope still
    // sees the ticket, still replies, and nothing was handed over.
    const alsoExperience = person('HR004', 'HR', { departments: ['Experience'] })
    expect(visibleTo(ticket({ assigneeId: 'HR000' }), alsoExperience)).toBe(false)
  })

  it('reaches an assignee who does not cover that department', () => {
    // Assigning gives them the ticket, not the department.
    expect(visibleTo(ticket({ assigneeId: 'HR003' }), raj)).toBe(true)
  })

  it('stays visible to Admin', () => {
    // Somebody has to find a ticket whose assignee is on leave. That is most of what
    // an escalation is.
    expect(visibleTo(ticket({ assigneeId: 'HR000' }), admin)).toBe(true)
  })
})

describe('the queue as a list', () => {
  const queue = [
    ticket({ id: 'A', employeeId: 'EMP1' }),
    ticket({ id: 'B', employeeId: 'EMP2' }),
    ticket({ id: 'C', employeeId: 'EMP1', assigneeId: 'HR000' }),
    ticket({ id: 'D', employeeId: 'EMP1', assigneeId: 'HR003' }),
  ]

  it('shows an HRBP the unassigned rows plus their own', () => {
    expect(visibleTickets(queue, priya).map((one) => one.id)).toEqual(['A', 'B', 'C'])
  })

  it('shows another HRBP the unassigned rows plus theirs', () => {
    expect(visibleTickets(queue, raj).map((one) => one.id)).toEqual(['A', 'B', 'D'])
  })

  it('shows Admin the lot, assigned elsewhere or not', () => {
    expect(visibleTickets(queue, admin)).toHaveLength(4)
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

describe('why a suggestion was made', () => {
  const hrAccounts = [priya, raj, admin]

  it('prefers the tagged HRBP and says the tag is why', () => {
    // Raj covers Brand Marketing, not Finance. The tag still wins: somebody decided
    // this employee is Raj's, and that outranks anything we infer from a department.
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Finance', hrbpId: 'HR003' })
    const suggestion = assignmentSuggestion(hrAccounts, employee)

    expect(suggestion?.who.employeeId).toBe('HR003')
    expect(suggestion?.reason).toBe('TAGGED')
  })

  it('marks department cover as the weaker reason it is', () => {
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Experience' })
    const suggestion = assignmentSuggestion(hrAccounts, employee)

    expect(suggestion?.who.employeeId).toBe('HR000')
    expect(suggestion?.reason).toBe('DEPARTMENT')
  })

  it('falls through a tag naming somebody who is not an HR account here', () => {
    // Handing a ticket to a non-HR account is the one outcome assignment must never
    // produce, so a tag we cannot resolve is not offered — cover is tried instead.
    const employee = person('EMP1', 'EMPLOYEE', { department: 'Experience', hrbpId: 'GONE' })
    const suggestion = assignmentSuggestion(hrAccounts, employee)

    expect(suggestion?.who.employeeId).toBe('HR000')
    expect(suggestion?.reason).toBe('DEPARTMENT')
  })

  it('suggests nobody when there is neither a tag nor cover', () => {
    expect(assignmentSuggestion(hrAccounts, person('EMP1', 'EMPLOYEE', { department: 'Legal' })))
      .toBeNull()
  })
})
