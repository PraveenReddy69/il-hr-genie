/**
 * Who may do what, and to whom.
 *
 * Mirrors docs/ACCESS_CONTROL.md. Everything here is **user interface only** — it
 * decides which doors to draw, never whether a door opens. The API is the authority and
 * checks the same rules per endpoint; a browser check is bypassed with devtools in ten
 * seconds, so if the server ever stops enforcing these, this file is decoration.
 *
 * Kept apart from client.ts deliberately: none of it touches the network, which is what
 * makes the escalation rules testable without a backend.
 */

import type { Employee, Role } from './types'

export type Permission =
  | 'dashboard.view'
  | 'tickets.view'
  | 'tickets.resolve'
  | 'tickets.assign'
  | 'people.view'
  | 'attendance.view'
  | 'celebrations.view'
  | 'trends.view'
  | 'analytics.view'
  | 'holidays.view'
  | 'holidays.edit'
  | 'pulse.view'
  | 'pulse.publish'
  | 'sales.view'
  | 'access.manage'
  | 'audit.view'
  | 'roles.assign'

/** Strictly ordered, so every check is `rank(actual) >= rank(required)`. */
export const RANK: Record<Role, number> = {
  EMPLOYEE: 0,
  HR: 1,
  HR_ADMIN: 2,
  HR_HEAD: 3,
}

/** The console roles, weakest first. Drives the pickers on the Access page. */
export const HR_ROLES: Role[] = ['HR', 'HR_ADMIN', 'HR_HEAD']

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: 'Employee',
  HR: 'HRBP',
  HR_ADMIN: 'Admin',
  HR_HEAD: 'Main Head',
}

const HR_BUNDLE: Permission[] = [
  'dashboard.view',
  'tickets.view',
  'tickets.resolve',
  'people.view',
  'attendance.view',
  'celebrations.view',
  'trends.view',
  'analytics.view',
  'holidays.view',
  'pulse.view',
]

const ADMIN_BUNDLE: Permission[] = [
  ...HR_BUNDLE,
  // Deciding who deals with a ticket is a workload decision across the HR team, which
  // is Admin's job. An HRBP works their own queue rather than handing things around.
  'tickets.assign',
  'holidays.edit',
  'pulse.publish',
  'sales.view',
  'access.manage',
  'audit.view',
]

/**
 * The fixed bundles.
 *
 * A fallback, not the source of truth: the server sends `permissions` already resolved,
 * and the console renders from that so a change to what HR includes never needs a
 * front-end release. This stands in on the mock, and against a backend that predates
 * access control — without it the console would show an empty sidebar to everyone the
 * day this ships and the day before the API catches up.
 */
export const BUNDLES: Record<Role, Permission[]> = {
  EMPLOYEE: [],
  HR: HR_BUNDLE,
  HR_ADMIN: ADMIN_BUNDLE,
  HR_HEAD: [...ADMIN_BUNDLE, 'roles.assign'],
}

/**
 * Only HR_HEAD may hand these out.
 *
 * Rule 3, and without it rule 1 is satisfied trivially: an Admin holding `access.manage`
 * passes it to another Admin, who passes it on, and the tier that was meant to sit above
 * them means nothing.
 */
export const HEAD_GRANTABLE_ONLY: Permission[] = ['access.manage', 'roles.assign']

/**
 * What an account can actually do. Server-resolved when present, bundle otherwise.
 *
 * There was a bridge here that granted `celebrations.view` alongside `people.view`,
 * because the API's permission set predated that string and sending a list without it
 * removed a working page for everyone. The API includes it as of 29 August 2026, so the
 * bridge is gone — as its own comment said it should be the moment this happened.
 *
 * Nothing is added to a list the server sends. That is the point: the server decides,
 * and a console that quietly tops up its own permissions is one nobody can reason about.
 */
export function permissionsOf(who: Employee): Permission[] {
  return who.permissions ?? BUNDLES[who.role] ?? []
}

export function can(who: Employee | null, permission: Permission): boolean {
  if (!who) return false
  return permissionsOf(who).includes(permission)
}

/** True for any role that belongs in this console at all. */
export function isConsoleRole(role: Role): boolean {
  return RANK[role] >= RANK.HR
}

/**
 * Whether `actor` is strictly senior to `target`.
 *
 * Strictly: equal rank is not enough. Two Admins administering each other is the same
 * hole as an Admin administering themselves, one step removed.
 */
export function outranks(actor: Employee, target: Employee): boolean {
  return RANK[actor.role] > RANK[target.role]
}

/**
 * Rule 2 — you cannot edit an account at or above your own rank, including your own.
 *
 * Self-editing is called out separately because it is the one case that looks harmless:
 * changing your own scope is how you quietly widen it.
 */
export function mayEdit(actor: Employee, target: Employee): boolean {
  if (!can(actor, 'access.manage')) return false
  if (actor.employeeId === target.employeeId) return false
  return outranks(actor, target)
}

/** Rules 1 and 3 — you cannot pass on what you do not hold, or what only Head hands out. */
export function mayGrant(actor: Employee, permission: Permission): boolean {
  if (!can(actor, permission)) return false
  if (HEAD_GRANTABLE_ONLY.includes(permission)) return actor.role === 'HR_HEAD'
  return true
}

/** Rule 1 applied to a whole role: you cannot promote anyone into powers you lack. */
export function mayAssign(actor: Employee, role: Role): boolean {
  if (!can(actor, 'roles.assign')) return false
  if (!isConsoleRole(role)) return false
  return BUNDLES[role].every((permission) => mayGrant(actor, permission))
}

/**
 * Rule 4 — the last active Main Head cannot be demoted or deactivated.
 *
 * Counted rather than flagged, and counted at the moment of the change. One click
 * otherwise locks the organisation out of its own console, recoverable only by someone
 * with database access.
 *
 * The console checks this to explain itself before the request; the server checks it
 * again inside the transaction, which is the one that counts.
 */
export function isLastHead(target: Employee, everyone: Employee[]): boolean {
  if (target.role !== 'HR_HEAD') return false
  return everyone.filter((one) => one.role === 'HR_HEAD').length <= 1
}

/**
 * Why an edit is refused, as a sentence, or null when it is allowed.
 *
 * Returned rather than thrown so a disabled row can explain itself in place. The server
 * sends its own message on 403 and the page shows that verbatim — these are the same
 * rules said early, not a second opinion.
 */
export function refusalFor(
  actor: Employee,
  target: Employee,
  everyone: Employee[],
  intent: { role?: Role } = {},
): string | null {
  if (!can(actor, 'access.manage')) return 'You do not manage access.'
  if (actor.employeeId === target.employeeId) return 'You cannot change your own access.'
  if (!outranks(actor, target)) {
    return `${ROLE_LABEL[target.role]} accounts are managed by someone more senior.`
  }
  if (intent.role && intent.role !== target.role) {
    if (!can(actor, 'roles.assign')) return 'Only the Main Head changes roles.'
    if (!mayAssign(actor, intent.role)) {
      return `You cannot grant ${ROLE_LABEL[intent.role]} — it includes more than you hold.`
    }
    if (isLastHead(target, everyone)) {
      return 'This is the last Main Head. Promote someone else first.'
    }
  }
  return null
}

/**
 * The departments an account may read, or null for the whole organisation.
 *
 * Null and empty are deliberately different: null is org-wide, empty is nothing. An HR
 * account nobody has assigned yet sees no one, which is the right failure — showing
 * them everything until somebody notices is the leak this exists to prevent.
 */
export function scopeOf(who: Employee): string[] | null {
  if (RANK[who.role] >= RANK.HR_ADMIN) return null
  return who.departments ?? []
}

/** Whether a row belongs to a scoped account. Org-wide accounts see everything. */
export function inScope(who: Employee, department: string): boolean {
  const scope = scopeOf(who)
  return scope === null || scope.includes(department)
}
