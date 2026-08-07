import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Empty,
  Loading,
  STATUS_COLOUR,
  StatusPill,
  clickable,
  relativeTime,
} from '../components/Bits'
import { Drawer } from '../components/Drawer'
import { fetchEmployeeSummary, fetchEmployeeTickets, fetchEmployees } from '../api/client'
import { MOODS, type Employee, type EmployeeSummary, type Ticket } from '../api/types'

/** Departments offered as chips before the rest are folded away. */
const TOP_DEPARTMENTS = 8

/** Rows rendered at once; the directory is far too long to paint in full. */
const PAGE_SIZE = 50

export function People() {
  const [people, setPeople] = useState<Employee[] | null>(null)
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState<string | null>(null)
  const [open, setOpen] = useState<Employee | null>(null)
  const [allDepartments, setAllDepartments] = useState(false)

  useEffect(() => {
    fetchEmployees().then(setPeople)
  }, [])

  const departments = useMemo(() => {
    const counts = new Map<string, number>()
    ;(people ?? []).forEach((person) => {
      counts.set(person.department, (counts.get(person.department) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [people])

  if (!people) return <Loading />

  // Name, id, title and department all match, because HR searches by whatever they
  // happen to have — a name from a meeting, an ID from a ticket.
  const needle = query.trim().toLowerCase()
  const matches = people.filter((person) => {
    if (department && person.department !== department) return false
    if (!needle) return true
    return [person.name, person.employeeId, person.title, person.department]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  // The real directory is nearly two thousand people. Rendering every row costs a
  // visible pause and nobody scrolls that far — search is how HR finds someone, so
  // the list shows the first page and says what it is holding back.
  const filtered = matches.slice(0, PAGE_SIZE)
  const hidden = matches.length - filtered.length

  // Fifty departments would push the first person off the screen, so only the
  // largest are offered up front.
  const shownDepartments = allDepartments ? departments : departments.slice(0, TOP_DEPARTMENTS)

  return (
    <>
      <div className="page-head">
        <h1>People</h1>
        <p>
          {people.length} on the directory · {departments.length} departments
        </p>
      </div>

      <section className="card">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, ID, role or department…"
          aria-label="Search employees"
        />

        <div className="chips" style={{ marginTop: 14 }}>
          <button
            className={`chip ${department === null ? 'chip--on' : ''}`}
            onClick={() => setDepartment(null)}
          >
            All {people.length}
          </button>
          {shownDepartments.map(([name, count]) => (
            <button
              key={name}
              className={`chip ${department === name ? 'chip--on' : ''}`}
              onClick={() => setDepartment(name)}
            >
              {name} {count}
            </button>
          ))}
          {departments.length > TOP_DEPARTMENTS && (
            <button className="chip" onClick={() => setAllDepartments(!allDepartments)}>
              {allDepartments
                ? 'Show fewer'
                : `+${departments.length - TOP_DEPARTMENTS} more`}
            </button>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          {filtered.length === 0 && (
            <Empty>Nobody matches “{query}”. Try an ID, or clear the filter.</Empty>
          )}
          {hidden > 0 && (
            <div className="row__meta" style={{ padding: '4px 2px 10px' }}>
              Showing {filtered.length} of {matches.length}. Search or pick a department
              to narrow it down.
            </div>
          )}
          {filtered.map((person, index) => (
            <div className="row" key={person.employeeId} {...clickable(() => setOpen(person))}>
              <Avatar name={person.name} index={index} />
              <div className="row__main">
                <div className="row__title">
                  {person.name}
                  {person.role === 'HR' && (
                    <span className="pill pill--neutral" style={{ marginLeft: 8 }}>
                      HR
                    </span>
                  )}
                  {(person.reportees ?? 0) > 0 && (
                    <span className="pill pill--muted" style={{ marginLeft: 6 }}>
                      {person.reportees} reporting
                    </span>
                  )}
                </div>
                <div className="row__meta">
                  {person.employeeId} · {person.title}
                </div>
              </div>
              <span className="pill pill--muted">{person.department}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="note">
        Directory and programme activity. Personal records — contact details, date of
        birth — live in the HRMS, not here.
      </p>

      {open && <PersonDrawer employee={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function PersonDrawer({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [summary, setSummary] = useState<EmployeeSummary | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])

  useEffect(() => {
    fetchEmployeeSummary(employee.employeeId).then(setSummary)
    fetchEmployeeTickets(employee.employeeId).then(setTickets)
  }, [employee.employeeId])

  const isHr = employee.role === 'HR'
  const mood = summary?.moodToday ? MOODS[summary.moodToday] : null

  return (
    <Drawer title={employee.name} subtitle={`${employee.title} · ${employee.department}`} onClose={onClose}>
      <div className="grid grid--2" style={{ marginTop: 18 }}>
        <Field label="Employee ID" value={employee.employeeId} />
        <Field label="Role" value={isHr ? 'HR business partner' : 'Employee'} />
        <Field label="Official email" value={employee.officialEmail} />
        <Field
          label="Joined"
          value={
            employee.dateOfJoining
              ? new Date(`${employee.dateOfJoining}T00:00:00`).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : '—'
          }
        />
      </div>

      {isHr ? (
        <>
          <div className="drawer__label">Programme activity</div>
          <Empty>
            HR accounts are not subjects of the sentiment programme, so nothing is
            recorded against them.
          </Empty>
        </>
      ) : (
        <>
          <div className="drawer__label">Programme activity</div>
          {!summary ? (
            <Loading />
          ) : (
            <div className="grid grid--2">
              <div className="tile tile--purple">
                <div className="tile__value" style={{ fontSize: 18, color: 'var(--purple)' }}>
                  {mood ? `${mood.emoji} ${mood.label}` : '—'}
                </div>
                <div className="tile__label">Today&apos;s check-in</div>
              </div>
              <div className="tile tile--blue">
                <div className="tile__value" style={{ color: 'var(--blue-deep)' }}>
                  {summary.checkInDays}
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    /{summary.trendDays}
                  </span>
                </div>
                <div className="tile__label">Days checked in</div>
              </div>
              <div
                className={`tile ${summary.pulseCompleted ? 'tile--green' : 'tile--amber'}`}
              >
                <div
                  className="tile__value"
                  style={{
                    fontSize: 18,
                    color: summary.pulseCompleted ? 'var(--green-ok)' : 'var(--orange-warn)',
                  }}
                >
                  {summary.pulseCompleted ? 'Done' : 'Pending'}
                </div>
                <div className="tile__label">This month&apos;s pulse</div>
              </div>
              <div className="tile tile--amber">
                <div className="tile__value" style={{ color: 'var(--orange-warn)' }}>
                  {summary.ticketsOpen}
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    /{summary.ticketsTotal}
                  </span>
                </div>
                <div className="tile__label">Tickets open</div>
              </div>
            </div>
          )}

          <div className="drawer__label">Tickets raised</div>
          {tickets.length === 0 ? (
            <Empty>Nothing raised with HR yet.</Empty>
          ) : (
            tickets.map((ticket) => (
              <div className="row" key={ticket.id}>
                <span className="accent" style={{ background: STATUS_COLOUR[ticket.status] }} />
                <div className="row__main">
                  <div className="row__title">{ticket.subject}</div>
                  <div className="row__meta">
                    {ticket.id} · {ticket.category} · {relativeTime(ticket.createdAtMillis)}
                  </div>
                </div>
                <StatusPill status={ticket.status} />
              </div>
            ))
          )}
        </>
      )}

      <p className="note">
        Written check-in notes are never shown here — the app promises employees they
        stay private.
      </p>
    </Drawer>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 3, wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}
