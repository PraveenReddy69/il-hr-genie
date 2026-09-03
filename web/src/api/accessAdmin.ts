/**
 * Reading and changing who can do what.
 *
 * The rules themselves live in `access.ts` and have since before there was an endpoint
 * to apply them to — `mayAssign`, `mayGrant`, `isLastHead`, `refusalFor`. This file is
 * only the wire: four calls, and the shapes the server actually sends.
 *
 * **Role bundles are not editable.** `/api/access/roles` is a read-only reference, by
 * the server's own description, so an Admin cannot redefine what `HR` means for
 * everybody holding it. What they change is one account at a time: its role, its
 * departments, its grants, and whether it is switched on at all. That is the safer
 * shape — redefining a role silently changes what every holder can do, including people
 * nobody had in mind at the time.
 *
 * Every rule here is enforced on the server too. The console mirrors them so a refusal
 * can be explained in place rather than arriving as a 403, and when one does arrive its
 * message is shown verbatim: the server is the side that knows.
 */

import { get, isLive, request } from './client'
import { BUNDLES, type Permission } from './access'
import type { Role } from './types'
import { mockEmployees } from './mock'

/** One account, as `/api/access/users` sends it. */
export interface AccessUser {
  employeeId: string
  name: string
  role: Role
  /** Empty means no department scope: nothing for an HRBP, everything for an Admin. */
  departments: string[]
  /**
   * The exceptions layered over the role bundle.
   *
   * `add` is a permission this person has and their role does not; `remove` is one
   * their role grants and this person does not. Both, rather than a flat list, so the
   * bundle stays the source of truth and an exception is visible *as* an exception.
   */
  grants: { add: Permission[]; remove: Permission[] }
  isActive: boolean
  /** What the server resolved: bundle, plus `add`, minus `remove`. */
  permissions: Permission[]
}

/** What may be changed about an account. Anything omitted is left alone. */
export interface AccessPatch {
  role?: Role
  departments?: string[]
  grants?: { add: Permission[]; remove: Permission[] }
  isActive?: boolean
}

export interface AuditEntry {
  id?: string
  atMillis?: number
  actorId?: string
  actorName?: string
  targetId?: string
  targetName?: string
  action?: string
  detail?: string
}

/**
 * The fixed permission bundle behind each role.
 *
 * Read from the server rather than assumed from `BUNDLES`, because the console's copy
 * is a mirror and mirrors drift. Shown on the page so "what does an Admin get" is
 * answerable without asking the backend — which is most of why this page exists.
 */
export function fetchRoleBundles(): Promise<Record<Role, Permission[]>> {
  if (!isLive) return Promise.resolve({ ...BUNDLES })
  return get<Record<string, string[]>>('/api/access/roles').then(
    (raw) => raw as Record<Role, Permission[]>,
  )
}

/**
 * The accounts this caller may administer — the server returns only ranks below theirs.
 *
 * It sends everybody, employees included: 2,246 rows on the live directory, of which
 * seven are console accounts. The page filters rather than the request, because
 * promoting somebody means finding them among the other 2,239.
 */
export function fetchAccessUsers(): Promise<AccessUser[]> {
  if (!isLive) return Promise.resolve(mockAccessUsers())
  return get<unknown>('/api/access/users').then((raw) => {
    const rows = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? [])
    return rows.map(readUser)
  })
}

export function updateAccess(employeeId: string, change: AccessPatch): Promise<AccessUser> {
  if (!isLive) return Promise.resolve(mockUpdate(employeeId, change))
  return request<unknown>(`/api/access/users/${encodeURIComponent(employeeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(change),
  }).then(readUser)
}

/** Recent access changes. Empty on the live system today; the endpoint exists. */
export function fetchAudit(limit = 25): Promise<AuditEntry[]> {
  if (!isLive) return Promise.resolve([] as AuditEntry[])
  return get<{ items?: AuditEntry[] }>(`/api/audit?limit=${limit}`)
    .then((raw) => raw.items ?? [])
    .catch(() => [])
}

/**
 * One row, read defensively.
 *
 * `grants` has been seen as `{add: [], remove: []}` and there is no schema for it in the
 * spec — it is typed as a bare object. A missing half must not crash the page, and an
 * account with no grants at all is the common case.
 */
function readUser(raw: unknown): AccessUser {
  const row = (raw ?? {}) as Record<string, unknown>
  const grants = (row.grants ?? {}) as Record<string, unknown>
  return {
    employeeId: String(row.employeeId ?? ''),
    name: String(row.name ?? ''),
    role: (row.role as Role) ?? 'EMPLOYEE',
    departments: Array.isArray(row.departments) ? row.departments.map(String) : [],
    grants: {
      add: Array.isArray(grants.add) ? (grants.add.map(String) as Permission[]) : [],
      remove: Array.isArray(grants.remove) ? (grants.remove.map(String) as Permission[]) : [],
    },
    isActive: row.isActive !== false,
    permissions: Array.isArray(row.permissions)
      ? (row.permissions.map(String) as Permission[])
      : [],
  }
}

/**
 * What an account can do once the exceptions are applied.
 *
 * The server sends `permissions` already resolved, and this recomputes it for the row
 * being edited so the panel can show the consequence of a change before it is saved.
 * The two agree; if they ever did not, the server's is the one that counts.
 */
export function effectivePermissions(
  role: Role,
  grants: { add: Permission[]; remove: Permission[] },
  bundles: Record<Role, Permission[]>,
): Permission[] {
  const base = new Set(bundles[role] ?? [])
  grants.add.forEach((one) => base.add(one))
  grants.remove.forEach((one) => base.delete(one))
  return [...base]
}

// ------------------------------------------------------------------ mock only

let mockRows: AccessUser[] | null = null

function mockAccessUsers(): AccessUser[] {
  mockRows ??= mockEmployees().map((one) => ({
    employeeId: one.employeeId,
    name: one.name,
    role: one.role,
    departments: one.departments ?? [],
    grants: { add: [], remove: [] },
    isActive: true,
    permissions: one.permissions ?? BUNDLES[one.role] ?? [],
  }))
  return mockRows.map((one) => ({ ...one, grants: { ...one.grants } }))
}

function mockUpdate(employeeId: string, change: AccessPatch): AccessUser {
  mockAccessUsers()
  const at = mockRows!.findIndex((one) => one.employeeId === employeeId)
  if (at < 0) throw new Error(`No account ${employeeId}`)
  const next: AccessUser = { ...mockRows![at], ...change }
  next.permissions = effectivePermissions(next.role, next.grants, BUNDLES)
  mockRows![at] = next
  return { ...next }
}
