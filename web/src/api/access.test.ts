/**
 * The access rules, checked without a backend or a browser.
 *
 * These are the console's first tests, and they start here rather than on a page for a
 * reason: everything in access.ts is a rule about who may do what, the rules are easy
 * to state and easy to get subtly wrong, and none of them need a DOM.
 *
 * Two things are being protected. The obvious one is the escalation guards — without
 * them "Admin manages access" means Admin is Head within thirty seconds. The other is
 * section 7 of docs/ACCESS_CONTROL.md: rank buys breadth, never depth into an
 * individual's answers. That one is a promise made to employees in the app, and a role
 * system is exactly the thing that invites someone to argue their way out of it.
 */

import { describe, expect, it } from 'vitest'
import {
  BUNDLES,
  HR_ROLES,
  RANK,
  can,
  inScope,
  isConsoleRole,
  isLastHead,
  mayAssign,
  mayEdit,
  mayGrant,
  outranks,
  permissionsOf,
  refusalFor,
  scopeOf,
  type Permission,
} from './access'
import type { Employee, Role } from './types'

const person = (employeeId: string, role: Role, extra: Partial<Employee> = {}): Employee => ({
  employeeId,
  name: employeeId,
  title: '',
  department: 'Experience',
  officialEmail: `${employeeId}@example.com`,
  role,
  ...extra,
})

const hrbp = person('HR000', 'HR', { departments: ['Experience', 'Brand Marketing'] })
const admin = person('HR001', 'HR_ADMIN')
const head = person('HR002', 'HR_HEAD')
const employee = person('EMP1', 'EMPLOYEE')

describe('the ladder', () => {
  it('orders the roles so a check is one comparison', () => {
    expect(RANK.EMPLOYEE).toBeLessThan(RANK.HR)
    expect(RANK.HR).toBeLessThan(RANK.HR_ADMIN)
    expect(RANK.HR_ADMIN).toBeLessThan(RANK.HR_HEAD)
  })

  it('keeps employees out of the console entirely', () => {
    expect(isConsoleRole('EMPLOYEE')).toBe(false)
    expect(HR_ROLES).not.toContain('EMPLOYEE')
    expect(BUNDLES.EMPLOYEE).toEqual([])
  })

  it('makes each tier a superset of the one below', () => {
    // Not decoration: mayAssign is written as "every permission in that bundle is one
    // I may grant", which silently allows a promotion into powers the actor lacks the
    // moment a lower bundle holds something a higher one does not.
    for (const permission of BUNDLES.HR) expect(BUNDLES.HR_ADMIN).toContain(permission)
    for (const permission of BUNDLES.HR_ADMIN) expect(BUNDLES.HR_HEAD).toContain(permission)
  })
})

describe('what each tier holds', () => {
  it('gives HRBPs their day to day and nothing administrative', () => {
    expect(can(hrbp, 'tickets.resolve')).toBe(true)
    expect(can(hrbp, 'people.view')).toBe(true)
    expect(can(hrbp, 'pulse.view')).toBe(true)

    expect(can(hrbp, 'pulse.publish')).toBe(false)
    expect(can(hrbp, 'sales.view')).toBe(false)
    expect(can(hrbp, 'access.manage')).toBe(false)
  })

  it('keeps role changes to the Main Head', () => {
    expect(can(admin, 'access.manage')).toBe(true)
    expect(can(admin, 'roles.assign')).toBe(false)
    expect(can(head, 'roles.assign')).toBe(true)
  })

  it('takes the server list over the bundle when there is one', () => {
    // The whole reason permissions travel on the session: changing what HR includes is
    // a backend change, not a front-end release.
    const granted = person('HR003', 'HR', { permissions: ['sales.view'] as Permission[] })
    expect(permissionsOf(granted)).toEqual(['sales.view'])
    expect(can(granted, 'sales.view')).toBe(true)
    expect(can(granted, 'tickets.view')).toBe(false)
  })

  it('falls back to the bundle against a backend that predates all this', () => {
    // Without the fallback, everybody gets an empty sidebar on the day this ships and
    // the day before the API catches up.
    expect(permissionsOf(hrbp)).toEqual(BUNDLES.HR)
    expect(can(person('X', 'HR_ADMIN'), 'access.manage')).toBe(true)
  })

  it('answers no for a signed-out session rather than throwing', () => {
    expect(can(null, 'dashboard.view')).toBe(false)
  })
})

describe('rule 1 — you cannot grant what you do not hold', () => {
  it('stops an HRBP passing on anything administrative', () => {
    expect(mayGrant(hrbp, 'sales.view')).toBe(false)
    expect(mayGrant(hrbp, 'access.manage')).toBe(false)
  })

  it('stops an Admin promoting anyone to Main Head', () => {
    expect(mayAssign(admin, 'HR_HEAD')).toBe(false)
  })

  it('lets the Head promote to any console role', () => {
    for (const role of HR_ROLES) expect(mayAssign(head, role)).toBe(true)
  })

  it('refuses to make anyone an EMPLOYEE through this door', () => {
    // Deactivation is its own action. Demoting someone out of the console by picking a
    // role from the same list would skip whatever that action is meant to do.
    expect(mayAssign(head, 'EMPLOYEE')).toBe(false)
  })
})

describe('rule 2 — nobody edits their own rank, or their peers', () => {
  it('lets an Admin manage HRBPs', () => {
    expect(mayEdit(admin, hrbp)).toBe(true)
  })

  it('stops an Admin editing another Admin', () => {
    // Equal rank is not enough. Two Admins administering each other is self-editing
    // with one step of indirection.
    expect(mayEdit(admin, person('HR009', 'HR_ADMIN'))).toBe(false)
    expect(outranks(admin, person('HR009', 'HR_ADMIN'))).toBe(false)
  })

  it('stops an Admin editing themselves', () => {
    // The quiet one: changing your own scope is how you widen it.
    expect(mayEdit(admin, admin)).toBe(false)
  })

  it('stops an Admin reaching the Main Head', () => {
    expect(mayEdit(admin, head)).toBe(false)
  })

  it('gives an HRBP no administrative reach at all', () => {
    expect(mayEdit(hrbp, person('HR010', 'HR'))).toBe(false)
  })
})

describe('rule 3 — only the Head hands out the keys', () => {
  it('lets an Admin use access.manage without passing it on', () => {
    expect(can(admin, 'access.manage')).toBe(true)
    expect(mayGrant(admin, 'access.manage')).toBe(false)
  })

  it('lets the Head hand it on', () => {
    expect(mayGrant(head, 'access.manage')).toBe(true)
    expect(mayGrant(head, 'roles.assign')).toBe(true)
  })

  it('leaves ordinary permissions grantable by anyone who holds them', () => {
    expect(mayGrant(admin, 'sales.view')).toBe(true)
    expect(mayGrant(admin, 'pulse.publish')).toBe(true)
  })
})

describe('rule 4 — the last Main Head stays', () => {
  const everyone = [hrbp, admin, head]

  it('spots the last one', () => {
    expect(isLastHead(head, everyone)).toBe(true)
  })

  it('is satisfied once there are two', () => {
    expect(isLastHead(head, [...everyone, person('HR003', 'HR_HEAD')])).toBe(false)
  })

  it('does not apply to anyone else', () => {
    expect(isLastHead(admin, everyone)).toBe(false)
  })

  it('refuses the demotion with a reason a person can read', () => {
    expect(refusalFor(head, head, everyone, { role: 'HR_ADMIN' })).toBeTruthy()
  })
})

describe('refusals explain themselves', () => {
  const everyone = [hrbp, admin, head]

  it('allows the ordinary case', () => {
    expect(refusalFor(admin, hrbp, everyone)).toBeNull()
  })

  it('names self-editing rather than saying no', () => {
    expect(refusalFor(admin, admin, everyone)).toMatch(/your own/i)
  })

  it('names seniority when the target outranks the actor', () => {
    expect(refusalFor(admin, head, everyone)).toMatch(/senior/i)
  })

  it('names who changes roles when an Admin tries', () => {
    expect(refusalFor(admin, hrbp, everyone, { role: 'HR_ADMIN' })).toMatch(/Main Head/i)
  })

  it('says nothing about a role that is not changing', () => {
    expect(refusalFor(admin, hrbp, everyone, { role: 'HR' })).toBeNull()
  })
})

describe('department scope', () => {
  it('reads the whole organisation for Admin and above', () => {
    expect(scopeOf(admin)).toBeNull()
    expect(scopeOf(head)).toBeNull()
    expect(inScope(admin, 'Anything')).toBe(true)
  })

  it('holds an HRBP to their own departments', () => {
    expect(scopeOf(hrbp)).toEqual(['Experience', 'Brand Marketing'])
    expect(inScope(hrbp, 'Experience')).toBe(true)
    expect(inScope(hrbp, 'Finance')).toBe(false)
  })

  it('shows an unassigned HRBP nobody', () => {
    // The correct failure. An HRBP nobody has assigned yet is a configuration mistake,
    // and showing them the organisation until someone notices is the leak this exists
    // to prevent. Null means org-wide; empty means nothing, and they are not the same.
    const unassigned = person('HR011', 'HR')
    expect(scopeOf(unassigned)).toEqual([])
    expect(inScope(unassigned, 'Experience')).toBe(false)
  })
})

describe('rank buys breadth, never depth', () => {
  /*
   * docs/ACCESS_CONTROL.md section 7, as a test rather than a comment.
   *
   * The app told employees their notes are private and their mood reaches HR only as
   * anonymised trends. A role system is precisely what invites the argument that the
   * top tier should see everything — and it is impossible to walk back once somebody
   * has read a note. If a permission for either ever appears, this fails.
   */
  const everyPermission = new Set<Permission>([
    ...BUNDLES.HR,
    ...BUNDLES.HR_ADMIN,
    ...BUNDLES.HR_HEAD,
  ])

  it('defines no permission that reads an individual mood note', () => {
    for (const permission of everyPermission) {
      expect(permission).not.toMatch(/note/i)
    }
  })

  it('defines no permission that lifts the cohort floor', () => {
    for (const permission of everyPermission) {
      expect(permission).not.toMatch(/cohort|raw|unmask|identif/i)
    }
  })

  it('gives the Main Head no read the HRBP does not also have', () => {
    // Everything above HR is administrative — managing access, publishing questions,
    // the sales page. Not one of them is a deeper look at a person's answers.
    const extra = BUNDLES.HR_HEAD.filter((permission) => !BUNDLES.HR.includes(permission))
    expect(extra.sort()).toEqual(
      [
        'access.manage',
        'audit.view',
        'holidays.edit',
        'pulse.publish',
        'roles.assign',
        'sales.view',
        // `tickets.assign` was here until 2 September, when it moved into the HR
        // bundle. Every entry left has to be administrative; the day one of them is a
        // deeper look at an individual's answers, this test is what should stop it.
      ],
    )
  })
})

describe('the sign-in gate', () => {
  it('turns an employee away', () => {
    expect(isConsoleRole(employee.role)).toBe(false)
    expect(permissionsOf(employee)).toEqual([])
  })

  it('lets all three console tiers in', () => {
    for (const role of HR_ROLES) expect(isConsoleRole(role)).toBe(true)
  })
})

describe('a permission list the server sent', () => {
  /*
   * The API's list is authoritative and nothing is added to it.
   *
   * A bridge used to sit here granting `celebrations.view` alongside `people.view`,
   * because the API's permission set predated that string and a list without it removed
   * a working page for everybody. The API includes it as of 29 August 2026, so the
   * bridge went — and these tests changed from proving it worked to proving it is gone.
   */
  const sentByServer: Permission[] = [
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

  it('is used exactly as sent', () => {
    const hrbp = person('HYD606840', 'HR', { permissions: sentByServer })
    expect(permissionsOf(hrbp)).toEqual(sentByServer)
  })

  it('grants nothing the server withheld', () => {
    const hrbp = person('HYD606840', 'HR', { permissions: sentByServer })
    expect(can(hrbp, 'holidays.edit')).toBe(false)
    expect(can(hrbp, 'pulse.publish')).toBe(false)
    expect(can(hrbp, 'access.manage')).toBe(false)
  })

  it('withholds a page when the server withholds its permission', () => {
    // The behaviour the bridge was working around, now allowed to happen. If a page
    // vanishes, the list is the thing to fix — not the console.
    const stripped = person('X', 'HR', { permissions: ['dashboard.view'] as Permission[] })
    expect(can(stripped, 'celebrations.view')).toBe(false)
    expect(can(stripped, 'people.view')).toBe(false)
  })

  it('falls back to the bundle only when no list was sent at all', () => {
    const noList = person('X', 'HR')
    expect(can(noList, 'celebrations.view')).toBe(true)
    expect(can(noList, 'holidays.edit')).toBe(false)
  })
})

describe('resolving a ticket', () => {
  /*
   * Closing a ticket is not an HRBP-only job. An Admin has to be able to finish one
   * whose owner has left or is on leave, which is most of what an escalation ends in —
   * and a Head above them for the same reason.
   *
   * Worth pinning because `tickets.resolve` sat in the permission set unread for a long
   * time: the drawer showed the controls to anybody, so nothing would have failed if a
   * role had quietly lost it.
   */
  it.each(HR_ROLES)('is open to %s', (role) => {
    expect(can(person('X', role), 'tickets.resolve')).toBe(true)
  })

  it('is not open to an employee', () => {
    expect(can(person('EMP1', 'EMPLOYEE'), 'tickets.resolve')).toBe(false)
  })

  it('is withheld when the server withholds it', () => {
    // The reason the check exists: a role that keeps `tickets.view` but loses
    // `tickets.resolve` should read the queue and not be offered a button that 403s.
    const readOnly = person('X', 'HR_ADMIN', {
      permissions: ['dashboard.view', 'tickets.view'] as Permission[],
    })
    expect(can(readOnly, 'tickets.view')).toBe(true)
    expect(can(readOnly, 'tickets.resolve')).toBe(false)
  })
})
