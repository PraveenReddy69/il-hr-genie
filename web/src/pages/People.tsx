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
import { fetchEmployeeSummary, fetchEmployeeTickets, fetchEmployees } from '../api/client'
import { MOODS, type Employee, type EmployeeSummary, type Ticket } from '../api/types'

/** Departments offered as chips before the rest are folded away. */
const TOP_DEPARTMENTS = 8

/** Rows rendered at once; the directory is far too long to paint in full. */
const PAGE_SIZE = 50

/** Filter value for "the people tagged to me". Not a department — see MINE below. */
const MINE = '__mine__'

export function People({ viewer }: { viewer: Employee }) {
  const [people, setPeople] = useState<Employee[] | null>(null)
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState<string | null>(null)
  const [open, setOpen] = useState<Employee | null>(null)
  const [allDepartments, setAllDepartments] = useState(false)
  const [page, setPage] = useState(0)

  /*
   * Any change to what is being listed puts you back on page one.
   *
   * Searching while on page 12 of the unfiltered directory otherwise leaves you looking
   * at an empty page 12 of four results, which reads as "no matches" when there are
   * plenty — the rows are simply behind you.
   */
  useEffect(() => {
    setPage(0)
  }, [query, department])

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

  /**
   * The people this HRBP is tagged to, by `hrbpId` rather than by department.
   *
   * The tag is the association somebody actually made; a department is an inference.
   * An HRBP whose `departments` is empty — which is all of them today — covers nobody
   * by department and can still be the named HRBP for a hundred people.
   *
   * Counted from the rows the server sent. The chip below only appears when this is
   * non-empty, so it never offers a filter that would empty the page.
   */
  const taggedToMe = useMemo(
    () => (people ?? []).filter((one) => one.hrbpId === viewer.employeeId),
    [people, viewer.employeeId],
  )

  if (!people) return <Loading />

  // Name, id, title and department all match, because HR searches by whatever they
  // happen to have — a name from a meeting, an ID from a ticket.
  const needle = query.trim().toLowerCase()
  const matches = people.filter((person) => {
    if (department === MINE && person.hrbpId !== viewer.employeeId) return false
    if (department && department !== MINE && person.department !== department) return false
    if (!needle) return true
    return [person.name, person.employeeId, person.title, person.department]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  /*
   * Paged rather than truncated.
   *
   * It used to render the first fifty and say how many were hidden, which is honest but
   * leaves nine-tenths of the directory unreachable except by search — and search only
   * helps somebody who already knows who they are looking for.
   */
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const from = safePage * PAGE_SIZE
  const filtered = matches.slice(from, from + PAGE_SIZE)

  // Fifty departments would push the first person off the screen, so only the
  // largest are offered up front.
  const shownDepartments = allDepartments ? departments : departments.slice(0, TOP_DEPARTMENTS)

  /**
   * The directory as a spreadsheet.
   *
   * Everything this account may see, not the filtered page: an export of somebody's
   * scope is a document they can work from, where an export of whichever chip happened
   * to be pressed is one nobody can interpret later.
   *
   * Contact details stop at the work address. Date of birth is on the record now, and
   * it is deliberately not written out — see the note under the list.
   */
  function exportCsv() {
    const rows = [
      ['Employee ID', 'Name', 'Title', 'Department', 'Official email', 'Joined'],
      ...(people ?? []).map((one) => [
        one.employeeId,
        one.name,
        one.title,
        one.department,
        one.officialEmail,
        one.dateOfJoining ?? '',
      ]),
    ]
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `hr-genie-people-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h1>People</h1>
          <p>
            {people.length} on the directory · {departments.length} departments
          </p>
        </div>
        <button className="ghostbtn" onClick={exportCsv} disabled={people.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="peoplelayout">

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
          {/*
            Only where there is somebody to show. A chip that filters to nought is a
            control that looks broken, and every HRBP would have one until the
            directory carries the tag.
          */}
          {taggedToMe.length > 0 && (
            <button
              className={`chip ${department === MINE ? 'chip--on' : ''}`}
              onClick={() => setDepartment(department === MINE ? null : MINE)}
            >
              Tagged to me {taggedToMe.length}
            </button>
          )}
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
          {filtered.length === 0 &&
            (people.length === 0 ? (
              /*
               * Nobody at all, rather than nobody matching. The old message blamed a
               * filter that was not set — it read "Nobody matches ''. Try an ID, or
               * clear the filter" on an empty search box, which tells an HRBP with an
               * empty directory to clear something they never typed.
               */
              <Empty>
                Nobody is in your scope yet. An HRBP sees the people tagged to them and
                the departments they cover — ask an Admin if this looks wrong.
              </Empty>
            ) : (
              <Empty>Nobody matches “{query}”. Try an ID, or clear the filter.</Empty>
            ))}
          {matches.length > PAGE_SIZE && (
            <div className="row__meta" style={{ padding: '4px 2px 10px' }}>
              Showing {from + 1}–{from + filtered.length} of {matches.length}. Search or
              pick a department to narrow it down.
            </div>
          )}
          {filtered.map((person, index) => (
            <div
              className={`row ${open?.employeeId === person.employeeId ? 'row--on' : ''}`}
              key={person.employeeId}
              {...clickable(() => setOpen(person))}
            >
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
              <ChevronIcon />
            </div>
          ))}

          {pages > 1 && (
            <nav className="pager" aria-label="Directory pages">
              <button
                className="pager__step"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
                aria-label="Previous page"
              >
                ‹
              </button>
              {pageNumbers(safePage, pages).map((n, i) =>
                n === null ? (
                  <span className="pager__gap" key={`gap-${i}`}>
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    className={`pager__n ${n === safePage ? 'pager__n--on' : ''}`}
                    onClick={() => setPage(n)}
                    aria-current={n === safePage ? 'page' : undefined}
                  >
                    {n + 1}
                  </button>
                ),
              )}
              <button
                className="pager__step"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pages - 1}
                aria-label="Next page"
              >
                ›
              </button>
            </nav>
          )}
        </div>
      </section>

      {open ? (
        <PersonPanel employee={open} onClose={() => setOpen(null)} />
      ) : (
        <aside className="card person person--empty">
          <p>Pick somebody to see their programme activity and the tickets they raised.</p>
        </aside>
      )}
      </div>

      <p className="note">
        Directory and programme activity. Personal records — contact details, date of
        birth — live in the HRMS, not here.
      </p>

    </>
  )
}

/**
 * Which page numbers to draw.
 *
 * Always the first, the last, and a window around wherever you are, with gaps for the
 * rest. Forty-five buttons is not navigation, and a bare pair of arrows makes the far
 * end of a long directory a hundred clicks away.
 */
function pageNumbers(current: number, total: number): (number | null)[] {
  const keep = new Set([0, total - 1, current - 1, current, current + 1])
  const out: (number | null)[] = []
  let gap = false
  for (let n = 0; n < total; n += 1) {
    if (keep.has(n)) {
      out.push(n)
      gap = false
    } else if (!gap) {
      out.push(null)
      gap = true
    }
  }
  return out
}

function ChevronIcon() {
  return (
    <svg className="row__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function PersonPanel({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [summary, setSummary] = useState<EmployeeSummary | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])

  useEffect(() => {
    fetchEmployeeSummary(employee.employeeId).then(setSummary)
    fetchEmployeeTickets(employee.employeeId).then(setTickets)
  }, [employee.employeeId])

  const isHr = employee.role === 'HR'
  const mood = summary?.moodToday ? MOODS[summary.moodToday] : null

  return (
    <aside className="card person">
      <header className="person__head">
        <Avatar name={employee.name} index={0} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="person__name">{employee.name}</div>
          <div className="person__role">
            {employee.title} · {employee.department}
          </div>
        </div>
        <button className="person__close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <div className="grid grid--2">
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
        <ShieldIcon />
        Written check-in notes are never shown here — the app promises employees they
        stay private.
      </p>
    </aside>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className="note__shield" aria-hidden="true">
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </svg>
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
