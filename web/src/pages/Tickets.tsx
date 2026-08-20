import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Empty,
  Loading,
  STATUS_COLOUR,
  clickable,
  relativeTime,
} from '../components/Bits'
import { TicketDrawer } from '../components/TicketDrawer'
import {
  employeeName,
  ensureDirectory,
  fetchEmployees,
  fetchTickets,
} from '../api/client'
import { isConsoleRole } from '../api/access'
import {
  ANY_ASSIGNEE,
  MINE,
  UNASSIGNED,
  byAssignee,
  canAssign,
  daysWaiting,
  unassignedCount,
  visibleTickets,
} from '../api/ticketQueue'
import {
  STATUS_LABEL,
  TICKET_STATUSES,
  type Employee,
  type Ticket,
} from '../api/types'

/**
 * The ticket queue.
 *
 * Two filters rather than one, because they answer different questions: *what state is
 * the work in* and *whose work is it*. An Admin opens this page to find what nobody has
 * picked up; an HRBP opens it to find their own.
 *
 * The list is already narrowed before it is filtered — see visibleTickets. An assigned
 * ticket belongs to one person, and the rest of that department stops seeing it. That is
 * a decision about what to draw; the API has to make the same one about what to return.
 */
export function Tickets({ actorId, viewer }: { actorId: string; viewer: Employee }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [people, setPeople] = useState<Employee[]>([])
  const [assignee, setAssignee] = useState<string>(ANY_ASSIGNEE)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Ticket | null>(null)

  /**
   * Reloads on a timer and whenever the tab is looked at again.
   *
   * The queue was fetched once on mount, so a console left open never saw a ticket
   * raised after it loaded — which reads as "the app did not file it" rather than
   * "this page is stale". A failed refresh keeps the rows already on screen.
   */
  useEffect(() => {
    let cancelled = false

    const load = () => {
      Promise.all([fetchTickets(), ensureDirectory()])
        .then(([rows]) => {
          if (!cancelled) setTickets(rows)
        })
        .catch(() => {})
    }

    load()
    const timer = window.setInterval(load, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    fetchEmployees().then(setPeople).catch(() => setPeople([]))
  }, [])

  const departmentOf = useMemo(() => {
    const byId = new Map(people.map((one) => [one.employeeId, one.department]))
    return (employeeId: string) => byId.get(employeeId) ?? ''
  }, [people])

  const employeeById = useMemo(
    () => new Map(people.map((one) => [one.employeeId, one])),
    [people],
  )

  /** HR accounts a ticket can be handed to. Admins included: they cover holidays. */
  const hrAccounts = useMemo(
    () => people.filter((one) => isConsoleRole(one.role)),
    [people],
  )

  /** Everything this account may see, before either filter. */
  const mine = useMemo(
    () => visibleTickets(tickets ?? [], viewer, departmentOf),
    [tickets, viewer, departmentOf],
  )

  const now = Date.now()

  const counts = useMemo(
    () => ({
      all: mine.length,
      OPEN: mine.filter((one) => one.status === 'OPEN').length,
      IN_PROGRESS: mine.filter((one) => one.status === 'IN_PROGRESS').length,
      RESOLVED: mine.filter((one) => one.status === 'RESOLVED').length,
      unassigned: unassignedCount(mine),
      forMe: mine.filter((one) => one.assigneeId === viewer.employeeId).length,
      ageing: mine.filter((one) => daysWaiting(one, now) >= AGEING_DAYS).length,
    }),
    // `now` is deliberately not a dependency: it changes on every render, and the
    // ageing count moving by a millisecond is not worth recomputing the whole queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mine, viewer.employeeId],
  )

  if (!tickets) return <Loading />

  /**
   * Search across the three things somebody actually has in their head.
   *
   * The reference because it is what a person quotes, the subject because it is what
   * they remember, and the raiser's name because half the time the request arrives as
   * "the one Faiyaz raised". Category deliberately left out — it is already a visible
   * grouping and matching on it makes a search for "leave" return the whole department.
   */
  const term = query.trim().toLowerCase()
  const matching = term
    ? mine.filter((one) =>
        [one.id, one.subject, employeeName(one.employeeId)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : mine

  const filtered = byAssignee(matching, assignee, viewer.employeeId)

  /*
   * Grouped by status, which is the same thing the pills used to say.
   *
   * They were grouped by owner — Needs an owner, In flight, Done — while every row
   * carried a status pill. Two axes on one row, and they contradicted each other in
   * plain sight: an In progress ticket sat under "Needs an owner" because it happened
   * to have no assignee. Both readings were correct and the pair was nonsense.
   *
   * One axis in the layout, one in the filter. Status groups the list; the owner is
   * what the segmented control filters by. Each fact appears once.
   */
  const groups = TICKET_STATUSES.map((status) => ({
    key: status,
    label: STATUS_LABEL[status],
    rows: filtered.filter((one) => one.status === status),
  }))

  function applyUpdate(updated: Ticket) {
    setTickets((current) =>
      (current ?? []).map((ticket) => (ticket.id === updated.id ? updated : ticket)),
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>Ticket queue</h1>
        <p>
          {counts.all} in your queue · {counts.OPEN + counts.IN_PROGRESS} still open
        </p>
      </div>

      <div className="statstrip">
        <div className="statstrip__cell">
          <div className="statstrip__label">Open</div>
          <div className="statstrip__value">{counts.OPEN}</div>
        </div>
        <div className="statstrip__cell">
          <div className="statstrip__label">In progress</div>
          <div className="statstrip__value">{counts.IN_PROGRESS}</div>
        </div>
        <div className="statstrip__cell">
          <div className="statstrip__label">Unassigned</div>
          {/* Coloured only when it is a number somebody has to do something about. A
              permanently orange zero is a warning nobody reads. */}
          <div
            className="statstrip__value"
            style={{ color: counts.unassigned > 0 ? 'var(--orange-warn)' : undefined }}
          >
            {counts.unassigned}
          </div>
        </div>
        <div className="statstrip__cell">
          <div className="statstrip__label">Waiting {AGEING_DAYS}d+</div>
          <div
            className="statstrip__value"
            style={{ color: counts.ageing > 0 ? 'var(--red-risk)' : undefined }}
          >
            {counts.ageing}
          </div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="search"
            style={{ flex: 1, minWidth: 200 }}
            value={query}
            placeholder="Search subject, reference or person"
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="seg">
            <button
              className={`seg__item ${assignee === ANY_ASSIGNEE ? 'seg__item--on' : ''}`}
              onClick={() => setAssignee(ANY_ASSIGNEE)}
            >
              {ANY_ASSIGNEE}
            </button>
            <button
              className={`seg__item ${assignee === UNASSIGNED ? 'seg__item--on' : ''}`}
              onClick={() => setAssignee(UNASSIGNED)}
            >
              Unassigned {counts.unassigned}
            </button>
            <button
              className={`seg__item ${assignee === MINE ? 'seg__item--on' : ''}`}
              onClick={() => setAssignee(MINE)}
            >
              Mine {counts.forMe}
            </button>
          </div>

          {/* One person at a time, and only where handing tickets around is the job. */}
          {canAssign(viewer) && hrAccounts.length > 0 && (
            <select
              className="search"
              style={{ width: 'auto' }}
              value={
                assignee === ANY_ASSIGNEE || assignee === UNASSIGNED || assignee === MINE
                  ? ''
                  : assignee
              }
              onChange={(event) => setAssignee(event.target.value || ANY_ASSIGNEE)}
            >
              <option value="">Somebody else…</option>
              {hrAccounts.map((one) => (
                <option key={one.employeeId} value={one.employeeId}>
                  {one.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ marginTop: 4 }}>
          {filtered.length === 0 && (
            <Empty style={{ marginTop: 14 }}>
              {term
                ? `Nothing matches "${query.trim()}".`
                : assignee === UNASSIGNED
                  ? 'Everything open has somebody on it.'
                  : 'Nothing here right now.'}
            </Empty>
          )}

          {groups.map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.key}>
                <div className="qgroup">
                  {group.label}
                  <span className="qgroup__count">{group.rows.length}</span>
                </div>

                {group.rows.map((ticket) => {
                  const owner = ticket.assigneeId ? employeeById.get(ticket.assigneeId) : undefined
                  const waiting = daysWaiting(ticket, now)
                  return (
                    <div className="row" key={ticket.id} {...clickable(() => setOpen(ticket))}>
                      <span
                        className="accent"
                        style={{ background: STATUS_COLOUR[ticket.status] }}
                      />
                      <div className="row__main">
                        <div className="row__title">{ticket.subject}</div>
                        <div className="row__meta">
                          <span className="ref">{ticket.id}</span> · {ticket.category} ·{' '}
                          {employeeName(ticket.employeeId)} ·{' '}
                          {relativeTime(ticket.createdAtMillis)}
                          {/* Only once it is worth chasing. A day-old ticket is not
                              late, and an ageing badge on everything is one on nothing. */}
                          {waiting >= AGEING_DAYS && (
                            <span style={{ color: 'var(--red-risk)', marginLeft: 8 }}>
                              · waiting {waiting} days
                            </span>
                          )}
                        </div>
                      </div>

                      {/*
                        Nothing about ownership on a resolved ticket. It is finished;
                        who still nominally owns it is not a fact anybody acts on, and
                        an "Unassigned" chip on four closed rows made the queue look
                        like four open problems.
                      */}
                      {ticket.status !== 'RESOLVED' &&
                        (owner ? (
                          <span className="owner" title={`Assigned to ${owner.name}`}>
                            <Avatar name={owner.name} index={0} />
                            {owner.employeeId === viewer.employeeId ? 'You' : owner.name}
                          </span>
                        ) : (
                          <span className="owner owner--none">Needs an owner</span>
                        ))}
                    </div>
                  )
                })}
              </div>
            ),
          )}
        </div>
      </section>

      <p className="note">
        Click a ticket to move it on. Resolving needs a note saying what was done — the
        employee sees it in HR Genie chat.
      </p>

      {open && (
        <TicketDrawer
          ticket={tickets.find((ticket) => ticket.id === open.id) ?? open}
          actorId={actorId}
          viewer={viewer}
          hrAccounts={hrAccounts}
          employee={employeeById.get(open.employeeId)}
          onClose={() => setOpen(null)}
          onUpdated={applyUpdate}
        />
      )}
    </>
  )
}

/** Often enough that a ticket raised on the phone shows up while HR is looking. */
const REFRESH_MS = 30_000

/**
 * When a ticket stops being "recent" and starts being "waiting".
 *
 * Three days rather than one: a ticket raised yesterday is not late, and a badge that
 * appears on everything is a badge that says nothing.
 */
const AGEING_DAYS = 3
