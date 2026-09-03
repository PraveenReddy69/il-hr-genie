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

import { RANK, can } from './access'
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
 * **Scope is the server's answer, not ours.** The rows handed to this function are
 * already the ones this account may see: the API scopes the queue by the HRBP tagged on
 * each raiser. This used to re-derive that from `viewer.departments`, and when the API
 * moved to the tag, that copy of the rule went stale and silently deleted every row —
 * an HRBP with 36 tickets saw an empty queue, and the console looked broken while the
 * backend was right. A client cannot enforce scope anyway; a filtered list from an
 * unfiltered endpoint is a courtesy, and re-implementing the rule bought nothing but
 * the chance to disagree with the server.
 *
 * What is left is the one narrowing the console owns:
 *
 *   - assigned to them         → yes
 *   - assigned to someone else → no
 *   - unassigned               → yes
 *
 * The middle case is the whole feature. Without it "assign" is decoration: everyone in
 * scope still sees the ticket, still gets to reply, and the assignment is a label rather
 * than a handover. It stays here because the API does not apply it yet — see §4c of
 * docs/BACKEND_HANDOVER.md — and the day it does, this becomes belt and braces rather
 * than the only thing holding.
 *
 * Admin and above see everything, including tickets assigned to somebody else: finding
 * the one whose owner is on leave is most of what an escalation is.
 */
export function visibleTo(ticket: Ticket, viewer: Employee): boolean {
  if (RANK[viewer.role] >= RANK.HR_ADMIN) return true
  if (ticket.assigneeId) return ticket.assigneeId === viewer.employeeId
  return true
}

export function visibleTickets(tickets: Ticket[], viewer: Employee): Ticket[] {
  return tickets.filter((ticket) => visibleTo(ticket, viewer))
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
  return assignmentSuggestion(hrAccounts, employee)?.who ?? null
}

/**
 * The same suggestion, with the reason it was made.
 *
 * Who is not enough on its own. "Deepak Patil" in a picker is a name an Admin has to
 * take on trust; "Deepak Patil - their HRBP" is a fact they can check, and one they
 * can overrule knowing what they are overruling. The two reasons carry very different
 * weight: a tag is a decision somebody made about this employee, department cover is
 * an inference we drew.
 */
export type SuggestionReason = 'TAGGED' | 'DEPARTMENT'

export function assignmentSuggestion(
  hrAccounts: Employee[],
  employee: Employee | undefined,
): { who: Employee; reason: SuggestionReason } | null {
  if (!employee) return null

  if (employee.hrbpId) {
    const tagged = hrAccounts.find((one) => one.employeeId === employee.hrbpId)
    // A tag that names somebody who is not an HR account is not a suggestion. It falls
    // through to department cover rather than being offered, because handing a ticket
    // to a non-HR account is the one outcome assignment must never produce.
    if (tagged) return { who: tagged, reason: 'TAGGED' }
  }

  const covering = hrAccounts.find(
    (one) => one.role === 'HR' && (one.departments ?? []).includes(employee.department),
  )
  return covering ? { who: covering, reason: 'DEPARTMENT' } : null
}

/** Why an assignment is refused, as a sentence, or null. */
export function refusalFor(actor: Employee, assignee: Employee | null): string | null {
  // Said as the permission, not the tier. It was "Only an Admin assigns tickets"
  // until HRBPs were given `tickets.assign` on 2 September, at which point the sentence
  // was both wrong and unfixable by anyone reading it.
  if (!canAssign(actor)) return 'You cannot assign tickets.'
  if (!assignee) return null
  if (RANK[assignee.role] < RANK.HR) {
    return `${assignee.name} is not an HR account.`
  }
  return null
}

export function byAssignee(tickets: Ticket[], assignee: string, viewerId: string): Ticket[] {
  if (assignee === ANY_ASSIGNEE) return tickets
  // Resolved tickets are excluded, matching unassignedCount exactly. They did not
  // before, so the chip said "Unassigned 2" and the list showed four — a resolved
  // ticket has no owner and does not need one, and counting it as work waiting for
  // somebody is the wrong answer as well as an inconsistent one.
  if (assignee === UNASSIGNED) {
    return tickets.filter((ticket) => !ticket.assigneeId && ticket.status !== 'RESOLVED')
  }
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
