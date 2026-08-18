/**
 * Who a ticket belongs to, and who may see it.
 *
 * Two things are being decided here and they are easy to run together:
 *
 *   **Scope** — which tickets an HRBP could ever see, from the departments they cover.
 *   Already true of every read in this console; see docs/ACCESS_CONTROL.md.
 *
 *   **Assignment** — which one person is dealing with this ticket. New, and narrower:
 *   an assigned ticket stops being everybody-in-scope's problem and becomes one
 *   person's.
 *
 * The rule that follows from putting them together is the one worth stating plainly:
 * **assignment narrows, it never widens.** Assigning a ticket to an HRBP who does not
 * cover that department does not give them the department; it gives them the ticket.
 * Assigning one away from an HRBP takes it off their queue even though it is still in
 * their scope. Both are what "assign it to Priya" means when a person says it.
 *
 * As everywhere else in this console, these are decisions about what to draw. The API
 * has to apply the same rules to the rows it returns, or a filtered list is a courtesy
 * rather than a boundary.
 */

import { RANK, can, inScope } from './access'
import type { Employee } from './types'
import type { Ticket } from './types'

/** Unassigned, as a filter value. Not a real id — no ticket ever has this assignee. */
export const UNASSIGNED = '__unassigned__'
export const ANY_ASSIGNEE = 'Anyone'
export const MINE = '__mine__'

/** Whether this account decides who deals with a ticket. */
export function canAssign(who: Employee | null): boolean {
  return can(who, 'tickets.assign')
}

/**
 * Whether one ticket should be in this person's queue at all.
 *
 * Admin and above see everything — somebody has to be able to find a ticket whose
 * assignee is on leave, and that is most of what an escalation is.
 *
 * For an HRBP:
 *   - assigned to them        → yes, whatever the department
 *   - assigned to someone else → no
 *   - unassigned              → yes, if the raiser's department is theirs
 *
 * The middle case is the whole feature. Without it "assign" is decoration: everyone in
 * the department still sees the ticket, still gets to reply, and the assignment is a
 * label rather than a handover.
 */
export function visibleTo(
  ticket: Ticket,
  viewer: Employee,
  departmentOf: (employeeId: string) => string,
): boolean {
  if (RANK[viewer.role] >= RANK.HR_ADMIN) return true
  if (ticket.assigneeId) return ticket.assigneeId === viewer.employeeId
  return inScope(viewer, departmentOf(ticket.employeeId))
}

export function visibleTickets(
  tickets: Ticket[],
  viewer: Employee,
  departmentOf: (employeeId: string) => string,
): Ticket[] {
  return tickets.filter((ticket) => visibleTo(ticket, viewer, departmentOf))
}

/**
 * The HRBP suggested for a ticket, or null.
 *
 * The employee's own tagged HRBP if the directory names one, otherwise whichever HR
 * account covers their department. Nothing is auto-assigned from this — it fills the
 * picker's first slot and says why. Assigning silently would mean a queue that grows
 * owners nobody chose, and the first time it is wrong there would be no sign of who
 * decided.
 */
export function suggestedAssignee(
  hrAccounts: Employee[],
  employee: Employee | undefined,
): Employee | null {
  if (employee?.hrbpId) {
    const tagged = hrAccounts.find((one) => one.employeeId === employee.hrbpId)
    if (tagged) return tagged
  }
  if (!employee) return null
  return (
    hrAccounts.find(
      (one) => one.role === 'HR' && (one.departments ?? []).includes(employee.department),
    ) ?? null
  )
}

/** Why an assignment is refused, as a sentence, or null. */
export function refusalFor(actor: Employee, assignee: Employee | null): string | null {
  if (!canAssign(actor)) return 'Only an Admin assigns tickets.'
  if (!assignee) return null
  if (RANK[assignee.role] < RANK.HR) {
    return `${assignee.name} is not an HR account.`
  }
  return null
}

export function byAssignee(tickets: Ticket[], assignee: string, viewerId: string): Ticket[] {
  if (assignee === ANY_ASSIGNEE) return tickets
  if (assignee === UNASSIGNED) return tickets.filter((ticket) => !ticket.assigneeId)
  if (assignee === MINE) return tickets.filter((ticket) => ticket.assigneeId === viewerId)
  return tickets.filter((ticket) => ticket.assigneeId === assignee)
}

/**
 * How long an open ticket has been waiting, in days.
 *
 * Measured from the last movement rather than from when it was raised: a ticket
 * commented on yesterday is not five days stale just because it was opened last week,
 * and treating it as such is how an ageing list stops being read.
 */
export function daysWaiting(ticket: Ticket, nowMillis: number): number {
  if (ticket.status === 'RESOLVED') return 0
  return Math.floor((nowMillis - ticket.updatedAtMillis) / 86_400_000)
}

/** Open tickets nobody owns. The number worth putting on the page. */
export function unassignedCount(tickets: Ticket[]): number {
  return tickets.filter((ticket) => !ticket.assigneeId && ticket.status !== 'RESOLVED').length
}
