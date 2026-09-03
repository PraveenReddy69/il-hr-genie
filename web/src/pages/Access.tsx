/**
 * Who can do what in this console.
 *
 * The point of the page is that an Admin stops asking the backend to change somebody's
 * access. It does three things, in the order people need them:
 *
 *   1. lists the accounts this Admin may administer, and lets them change one;
 *   2. shows what each role actually grants, so "what does an Admin get" is a thing you
 *      can read rather than a question you send;
 *   3. shows the log of changes, so the answer to "who gave them that" exists.
 *
 * **A role's bundle is not editable, deliberately.** `/api/access/roles` is a read-only
 * reference. Editing what `HR` means would silently change every HRBP at once,
 * including people nobody had in mind; a per-account grant changes exactly the person
 * in front of you and is visible as an exception afterwards.
 *
 * Every refusal here is also enforced on the server. These are the same five rules said
 * early, so a disabled control can explain itself instead of a click ending in a 403 —
 * and when the server does refuse, its sentence is shown rather than ours.
 */

import { useEffect, useMemo, useState } from 'react'
import { Empty, Loading, clickable } from '../components/Bits'
import {
  BUNDLES,
  HEAD_GRANTABLE_ONLY,
  ROLE_LABEL,
  mayAssign,
  mayGrant,
  refusalFor,
  type Permission,
} from '../api/access'
import {
  describeChange,
  effectivePermissions,
  fetchAccessUsers,
  fetchAudit,
  fetchRoleBundles,
  updateAccess,
  type AccessPatch,
  type AccessUser,
  type AuditEntry,
} from '../api/accessAdmin'
import { fetchEmployees } from '../api/client'
import type { Employee, Role } from '../api/types'

/** `GRANTS_CHANGED` reads as shouting in a list of sentences. */
function ACTION_LABEL(action?: string): string {
  if (!action) return 'changed their access'
  return action.toLowerCase().replace(/_/g, ' ')
}

const CONSOLE_ONLY = 'Console accounts'
const EVERYONE = 'Everyone'
const ROLES: Role[] = ['EMPLOYEE', 'HR', 'HR_ADMIN', 'HR_HEAD']

/** Every permission the console knows, in the order the Head's bundle lists them. */
const ALL_PERMISSIONS: Permission[] = BUNDLES.HR_HEAD

export function Access({ viewer }: { viewer: Employee }) {
  const [rows, setRows] = useState<AccessUser[] | null>(null)
  const [bundles, setBundles] = useState<Record<Role, Permission[]> | null>(null)
  const [departments, setDepartments] = useState<string[]>([])
  const [log, setLog] = useState<AuditEntry[]>([])
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<string>(CONSOLE_ONLY)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  function load() {
    return Promise.all([fetchAccessUsers(), fetchRoleBundles()]).then(([people, byRole]) => {
      setRows(people)
      setBundles(byRole)
    })
  }

  useEffect(() => {
    load().catch((failure: unknown) => {
      setRows([])
      setProblem(failure instanceof Error ? failure.message : 'Could not load accounts.')
    })
    fetchAudit().then(setLog).catch(() => setLog([]))
    // The department list is the directory's, not this endpoint's — an account with no
    // departments yet still needs the full set to choose from.
    fetchEmployees()
      .then((people) => setDepartments([...new Set(people.map((one) => one.department))].sort()))
      .catch(() => setDepartments([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (rows ?? [])
      .filter((row) => (scope === CONSOLE_ONLY ? row.role !== 'EMPLOYEE' : true))
      .filter(
        (row) =>
          !needle ||
          `${row.name} ${row.employeeId}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 60)
  }, [rows, query, scope])

  if (!rows || !bundles) return <Loading />

  const selected = rows.find((one) => one.employeeId === open) ?? null

  async function save(employeeId: string, change: Parameters<typeof updateAccess>[1]) {
    setBusy(true)
    setProblem(null)
    try {
      await updateAccess(employeeId, change)
      await load()
      // The server's own account of what happened, not ours.
      fetchAudit().then(setLog).catch(() => undefined)
      return true
    } catch (failure) {
      // Shown verbatim: a 403 here names which of the five rules was violated, and the
      // server is the side that actually knows.
      setProblem(failure instanceof Error ? failure.message : 'That change was refused.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const consoleAccounts = rows.filter((one) => one.role !== 'EMPLOYEE').length

  return (
    <>
      <div className="page-head">
        <h1>Access</h1>
        <p>
          {consoleAccounts} console {consoleAccounts === 1 ? 'account' : 'accounts'} ·{' '}
          {rows.length.toLocaleString()} you may administer
        </p>
      </div>

      {problem && (
        <div className="error" style={{ marginTop: 12 }}>
          {problem}
        </div>
      )}

      <div className={`accesslayout ${selected ? 'accesslayout--split' : ''}`}>
        <section className="card">
          <div className="askfilters">
            <div className="asksearch">
              <SearchIcon />
              <input
                className="asksearch__input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or employee id"
                aria-label="Search accounts"
              />
            </div>
            <div className="tagpick">
              <select
                className="tagpick__select"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                aria-label="Which accounts"
              >
                <option value={CONSOLE_ONLY}>{CONSOLE_ONLY}</option>
                <option value={EVERYONE}>{EVERYONE}</option>
              </select>
              <ChevronDown />
            </div>
          </div>

          {shown.length === 0 ? (
            <Empty style={{ marginTop: 14 }}>
              {scope === CONSOLE_ONLY && !query
                ? 'No console accounts below yours.'
                : 'Nobody matches that.'}
            </Empty>
          ) : (
            <div className="acclist">
              {shown.map((row) => {
                const target = asEmployee(row)
                const refusal = refusalFor(viewer, target, rows.map(asEmployee))
                return (
                  <div
                    key={row.employeeId}
                    {...clickable(() => !refusal && setOpen(row.employeeId))}
                    className={`accrow ${open === row.employeeId ? 'accrow--on' : ''} ${
                      refusal ? 'accrow--locked' : ''
                    } ${row.isActive ? '' : 'accrow--off'}`}
                    title={refusal ?? undefined}
                  >
                    <span className={`rolepill rolepill--${row.role.toLowerCase()}`}>
                      {ROLE_LABEL[row.role]}
                    </span>
                    <span className="accrow__who">
                      <span className="accrow__name">{row.name}</span>
                      <span className="accrow__id">{row.employeeId}</span>
                    </span>
                    <span className="accrow__scope">
                      {row.role === 'EMPLOYEE'
                        ? '—'
                        : row.departments.length === 0
                          ? 'No departments'
                          : `${row.departments.length} department${row.departments.length === 1 ? '' : 's'}`}
                    </span>
                    {(row.grants.add.length > 0 || row.grants.remove.length > 0) && (
                      <span className="accrow__exc">
                        {row.grants.add.length > 0 && `+${row.grants.add.length}`}
                        {row.grants.remove.length > 0 && ` −${row.grants.remove.length}`}
                      </span>
                    )}
                    {!row.isActive && <span className="accrow__off">Switched off</span>}
                  </div>
                )
              })}
              {shown.length === 60 && (
                <p className="note">
                  First 60. Search to narrow it — the directory has{' '}
                  {rows.length.toLocaleString()} accounts.
                </p>
              )}
            </div>
          )}
        </section>

        {selected && (
          <AccessEditor
            key={selected.employeeId}
            row={selected}
            viewer={viewer}
            everyone={rows}
            bundles={bundles}
            departments={departments}
            busy={busy}
            onClose={() => setOpen(null)}
            onSave={save}
          />
        )}
      </div>

      <RoleReference bundles={bundles} />

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Recent changes</div>
            <div className="card__subtitle">Who changed whose access, and when</div>
          </div>
        </div>
        {log.length === 0 ? (
          <Empty>No access has been changed yet.</Empty>
        ) : (
          log.map((entry, at) => {
            // The log stores ids; the names come from the account list already loaded.
            // An id with no match is shown as itself rather than as "Unknown" — a
            // leaver still did the thing.
            const named = (id?: string) =>
              rows.find((one) => one.employeeId === id)?.name ?? id ?? 'someone'
            const what = describeChange(entry)
            return (
              <div className="row" key={entry.id ?? at}>
                <div className="row__main">
                  <div className="row__title">
                    {named(entry.actorId)} changed {named(entry.targetId)}
                  </div>
                  <div className="row__meta">{what ?? ACTION_LABEL(entry.action)}</div>
                </div>
                {entry.atMillis && (
                  <span className="row__meta" style={{ flex: 'none' }}>
                    {new Date(entry.atMillis).toLocaleString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            )
          })
        )}
      </section>
    </>
  )
}

/**
 * One account, editable.
 *
 * Role, departments, the exceptions, and whether the account works at all. Every control
 * is disabled with a reason when a rule forbids it rather than left live to fail — the
 * point of mirroring the rules is to say no before the request, not after.
 */
function AccessEditor({
  row,
  viewer,
  everyone,
  bundles,
  departments,
  busy,
  onClose,
  onSave,
}: {
  row: AccessUser
  viewer: Employee
  everyone: AccessUser[]
  bundles: Record<Role, Permission[]>
  departments: string[]
  busy: boolean
  onClose: () => void
  onSave: (employeeId: string, change: AccessPatch) => Promise<boolean>
}) {
  const [role, setRole] = useState<Role>(row.role)
  const [depts, setDepts] = useState<string[]>(row.departments)
  const [grants, setGrants] = useState(row.grants)
  const [active, setActive] = useState(row.isActive)
  const [showAll, setShowAll] = useState(false)

  const staff = useMemo(() => everyone.map(asEmployee), [everyone])
  const target = asEmployee(row)
  // Only asked about the role when the role is moving: refusalFor treats an intent to
  // set the same role as no intent at all, but being explicit keeps the two in step.
  const roleRefusal = refusalFor(viewer, target, staff, role === row.role ? {} : { role })
  const bundle = bundles[role] ?? []
  const effective = new Set(effectivePermissions(role, grants, bundles))

  /*
   * Only what actually changed goes to the server.
   *
   * Every field is optional and anything omitted is left alone — and sending a field
   * is not free. `PATCH` enforces the rule attached to each key it receives, so an
   * Admin saving a permission change while also echoing the unchanged `role` was
   * refused with "Changing roles requires the 'roles.assign' permission", about a role
   * they had not touched. Sending the whole object made every save a role change.
   */
  const change: AccessPatch = {}
  if (role !== row.role) change.role = role
  if (active !== row.isActive) change.isActive = active
  if (depts.join('|') !== row.departments.join('|')) change.departments = depts
  if (
    grants.add.join('|') !== row.grants.add.join('|') ||
    grants.remove.join('|') !== row.grants.remove.join('|')
  ) {
    change.grants = grants
  }
  const dirty = Object.keys(change).length > 0

  /**
   * Turn one permission on or off for this person.
   *
   * Expressed as a difference from the bundle rather than a flat list: switching off
   * something the role grants records a `remove`, switching on something it does not
   * records an `add`, and returning to the bundle's own answer clears both. That way an
   * exception stays visibly an exception, and a later change to the role still flows
   * through everything nobody has overridden.
   */
  function toggle(permission: Permission) {
    const inBundle = bundle.includes(permission)
    const on = effective.has(permission)
    const add = grants.add.filter((one) => one !== permission)
    const remove = grants.remove.filter((one) => one !== permission)
    if (on && inBundle) remove.push(permission)
    if (!on && !inBundle) add.push(permission)
    setGrants({ add, remove })
  }

  function toggleDepartment(name: string) {
    setDepts((current) =>
      current.includes(name) ? current.filter((one) => one !== name) : [...current, name],
    )
  }

  const listed = showAll ? departments : departments.slice(0, 6)

  return (
    <aside className="card holpanel accesspanel">
      <header className="holpanel__head">
        <span className="holpanel__mark">
          <KeyIcon />
        </span>
        <div className="holpanel__title">
          {row.name}
          <span className="accpanel__id">{row.employeeId}</span>
        </div>
        <button className="holpanel__close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <div className="holfield">
        <span className="holfield__label">Role</span>
        <div className="chips">
          {ROLES.map((one) => {
            const blocked =
              one !== row.role && one !== 'EMPLOYEE' && !mayAssign(viewer, one)
                ? `You cannot grant ${ROLE_LABEL[one]} — it includes more than you hold.`
                : null
            return (
              <button
                key={one}
                className={`chip ${role === one ? 'chip--on' : ''}`}
                disabled={Boolean(blocked)}
                title={blocked ?? undefined}
                onClick={() => setRole(one)}
              >
                {ROLE_LABEL[one]}
              </button>
            )
          })}
        </div>
        {roleRefusal && <div className="field-foot field-foot--warn">{roleRefusal}</div>}
      </div>

      {role !== 'EMPLOYEE' && (
        <div className="holfield">
          <span className="holfield__label">
            Departments {depts.length === 0 && '· none, so they see nobody'}
          </span>
          <div className="deptlist">
            {listed.map((name) => (
              <div
                key={name}
                {...clickable(() => toggleDepartment(name))}
                className={`deptrow ${depts.includes(name) ? 'deptrow--on' : ''}`}
              >
                <Tick on={depts.includes(name)} />
                <span className="deptrow__name">{name}</span>
              </div>
            ))}
          </div>
          {departments.length > 6 && (
            <button className="showmore" onClick={() => setShowAll((on) => !on)}>
              {showAll ? 'Show fewer' : `Show ${departments.length - 6} more`}
            </button>
          )}
        </div>
      )}

      <div className="holfield">
        <span className="holfield__label">What they can do</span>
        <div className="permlist">
          {ALL_PERMISSIONS.map((permission) => {
            const inBundle = bundle.includes(permission)
            const on = effective.has(permission)
            const headOnly = HEAD_GRANTABLE_ONLY.includes(permission)
            const blocked = !mayGrant(viewer, permission)
              ? headOnly
                ? 'Only the Main Head hands this one out.'
                : 'You do not hold this yourself.'
              : null
            return (
              <div
                key={permission}
                {...clickable(() => !blocked && toggle(permission))}
                className={`permrow ${on ? 'permrow--on' : ''} ${blocked ? 'permrow--locked' : ''}`}
                title={blocked ?? undefined}
              >
                <Tick on={on} blocked={Boolean(blocked)} />
                <code className="permrow__name">{permission}</code>
                {on && !inBundle && <span className="permrow__tag permrow__tag--add">added</span>}
                {!on && inBundle && (
                  <span className="permrow__tag permrow__tag--gone">removed</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="field-foot">
          Unmarked permissions come from {ROLE_LABEL[role]}. Changing the role moves them.
        </div>
      </div>

      <div className="holfield">
        <span className="holfield__label">Account</span>
        <div
          {...clickable(() => setActive((on) => !on))}
          className={`deptrow ${active ? 'deptrow--on' : ''}`}
        >
          <Tick on={active} />
          <span className="deptrow__name">
            {active ? 'Active — can sign in' : 'Switched off — cannot sign in'}
          </span>
        </div>
      </div>

      <button
        className="button holpanel__save"
        disabled={busy || !dirty || Boolean(roleRefusal)}
        onClick={() =>
          void onSave(row.employeeId, change).then((ok) => ok && onClose())
        }
      >
        {busy ? 'Saving…' : 'Save changes'}
      </button>
      <button className="holpanel__cancel" onClick={onClose}>
        Cancel
      </button>
    </aside>
  )
}

/** What each role grants, read from the server rather than assumed. */
function RoleReference({ bundles }: { bundles: Record<Role, Permission[]> }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <button className="refhead" onClick={() => setOpen((on) => !on)} aria-expanded={open}>
        <div>
          <div className="card__title">What each role grants</div>
          <div className="card__subtitle">
            Fixed on the server, the same for everybody holding the role
          </div>
        </div>
        <Caret open={open} />
      </button>

      {open && (
        <div className="refgrid">
          {ROLES.map((role) => (
            <div className="refcol" key={role}>
              <div className={`rolepill rolepill--${role.toLowerCase()}`}>{ROLE_LABEL[role]}</div>
              {(bundles[role] ?? []).length === 0 ? (
                <p className="refcol__none">Nothing in the console.</p>
              ) : (
                (bundles[role] ?? []).map((permission) => (
                  <code className="refcol__perm" key={permission}>
                    {permission}
                  </code>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * An access row as the rules functions expect it.
 *
 * `access.ts` reasons about `Employee`, and this endpoint sends a narrower record. The
 * fields the rules actually read are role, employeeId and permissions; the rest is
 * filled so the shape typechecks and nothing invented is ever displayed.
 */
function asEmployee(row: AccessUser): Employee {
  return {
    employeeId: row.employeeId,
    name: row.name,
    role: row.role,
    departments: row.departments,
    permissions: row.permissions,
    title: '',
    department: '',
    officialEmail: '',
  } as Employee
}

// -------------------------------------------------------------------- glyphs

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Tick({ on, blocked = false }: { on: boolean; blocked?: boolean }) {
  return (
    <span
      className={`deptick ${on ? 'deptick--on' : ''} ${blocked ? 'deptick--blocked' : ''}`}
      aria-hidden="true"
    >
      {on && (
        <svg viewBox="0 0 24 24" {...S} strokeWidth={2.8}>
          <path d="M6 12.4l4 4 8-8.6" />
        </svg>
      )}
      {blocked && !on && (
        <svg viewBox="0 0 24 24" {...S} strokeWidth={2.4}>
          <path d="M7 12h10" />
        </svg>
      )}
    </span>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="8.4" cy="8.4" r="4.4" />
      <path d="M11.6 11.6L20 20M17 17l-2 2M14 14l-2 2" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="asksearch__glyph" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="M15.4 15.4l4 4" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg className="tagpick__chev" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </svg>
  )
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`askq__caret ${open ? 'askq__caret--open' : ''}`}
      viewBox="0 0 24 24"
      {...S}
      aria-hidden="true"
    >
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}
