import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Card,
  Empty,
  Loading,
  STATUS_COLOUR,
  StatusPill,
  clickable,
  relativeTime,
} from '../components/Bits'
import { Donut } from '../components/Chart'
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
  type TicketStatus,
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
  const [status, setStatus] = useState<TicketStatus | null>(null)
  const [assignee, setAssignee] = useState<string>(ANY_ASSIGNEE)
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

  const counts = useMemo(
    () => ({
      all: mine.length,
      OPEN: mine.filter((one) => one.status === 'OPEN').length,
      IN_PROGRESS: mine.filter((one) => one.status === 'IN_PROGRESS').length,
      RESOLVED: mine.filter((one) => one.status === 'RESOLVED').length,
      unassigned: unassignedCount(mine),
      forMe: mine.filter((one) => one.assigneeId === viewer.employeeId).length,
    }),
    [mine, viewer.employeeId],
  )

  if (!tickets) return <Loading />

  const filtered = byAssignee(
    status ? mine.filter((one) => one.status === status) : mine,
    assignee,
    viewer.employeeId,
  )

  function applyUpdate(updated: Ticket) {
    setTickets((current) =>
      (current ?? []).map((ticket) => (ticket.id === updated.id ? updated : ticket)),
    )
  }

  const now = Date.now()

  return (
    <>
      <div className="page-head">
        <h1>Ticket queue</h1>
        <p>
          {counts.all} in your queue · {counts.OPEN + counts.IN_PROGRESS} still open
          {counts.unassigned > 0 && ` · ${counts.unassigned} unassigned`}
        </p>
      </div>

      <div className="grid grid--3">
        <Card
          chip="🎫"
          chipColour="var(--orange-tint-14)"
          title="Where tickets stand"
          subtitle="Your queue, by status"
        >
          <Donut
            total={counts.all}
            caption={counts.all === 1 ? 'ticket' : 'tickets'}
            slices={TICKET_STATUSES.map((one) => ({
              label: STATUS_LABEL[one],
              value: counts[one],
              colour: STATUS_COLOUR[one],
            }))}
          />
        </Card>

        <Card chip="🙋" chipColour="var(--blue-tint-12)" title="Waiting for an owner">
          <div
            className="tile__value"
            style={{ color: counts.unassigned > 0 ? 'var(--orange)' : 'var(--blue-deep)' }}
          >
            {counts.unassigned}
          </div>
          <div className="tile__sub">
            {counts.unassigned === 0
              ? 'Everything open has somebody on it'
              : 'Open, and nobody has picked them up'}
          </div>
        </Card>

        <Card chip="👤" chipColour="var(--purple-tint-12)" title="Assigned to you">
          <div className="tile__value" style={{ color: 'var(--purple)' }}>
            {counts.forMe}
          </div>
          <div className="tile__sub">Yours to answer</div>
        </Card>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="chips">
          <button
            className={`chip ${status === null ? 'chip--on' : ''}`}
            onClick={() => setStatus(null)}
          >
            All {counts.all}
          </button>
          {TICKET_STATUSES.map((one) => (
            <button
              key={one}
              className={`chip ${status === one ? 'chip--on' : ''}`}
              onClick={() => setStatus(one)}
              style={{ opacity: counts[one] === 0 && status !== one ? 0.5 : 1 }}
            >
              {STATUS_LABEL[one]} {counts[one]}
            </button>
          ))}
        </div>

        <div className="chips" style={{ marginTop: 8 }}>
          <button
            className={`chip ${assignee === ANY_ASSIGNEE ? 'chip--on' : ''}`}
            onClick={() => setAssignee(ANY_ASSIGNEE)}
          >
            {ANY_ASSIGNEE}
          </button>
          <button
            className={`chip ${assignee === UNASSIGNED ? 'chip--on' : ''}`}
            onClick={() => setAssignee(UNASSIGNED)}
          >
            Unassigned {counts.unassigned}
          </button>
          <button
            className={`chip ${assignee === MINE ? 'chip--on' : ''}`}
            onClick={() => setAssignee(MINE)}
          >
            Mine {counts.forMe}
          </button>

          {/* One person at a time, and only where handing tickets around is the job. */}
          {canAssign(viewer) && hrAccounts.length > 0 && (
            <select
              className="search"
              style={{ marginLeft: 'auto', width: 'auto' }}
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

        <div style={{ marginTop: 10 }}>
          {filtered.length === 0 && (
            <Empty>
              {assignee === UNASSIGNED
                ? 'Everything open has somebody on it.'
                : `Nothing ${status ? STATUS_LABEL[status].toLowerCase() : 'here'} right now.`}
            </Empty>
          )}
          {filtered.map((ticket) => {
            const owner = ticket.assigneeId ? employeeById.get(ticket.assigneeId) : undefined
            const waiting = daysWaiting(ticket, now)
            return (
              <div className="row" key={ticket.id} {...clickable(() => setOpen(ticket))}>
                <span className="accent" style={{ background: STATUS_COLOUR[ticket.status] }} />
                <div className="row__main">
                  <div className="row__title">{ticket.subject}</div>
                  <div className="row__meta">
                    {ticket.id} · {ticket.category} · {employeeName(ticket.employeeId)} ·{' '}
                    {relativeTime(ticket.createdAtMillis)}
                    {/* Only once it is worth chasing. A day-old ticket is not late, and
                        an ageing badge on everything is an ageing badge on nothing. */}
                    {waiting >= 3 && (
                      <span style={{ color: 'var(--orange)', marginLeft: 8 }}>
                        · waiting {waiting} days
                      </span>
                    )}
                  </div>
                </div>

                {owner ? (
                  <span
                    className="row__meta"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 10 }}
                    title={`Assigned to ${owner.name}`}
                  >
                    <Avatar name={owner.name} index={0} />
                    {owner.employeeId === viewer.employeeId ? 'You' : owner.name}
                  </span>
                ) : (
                  <span className="tag tag--all" style={{ marginRight: 10 }}>
                    Unassigned
                  </span>
                )}

                <StatusPill status={ticket.status} />
              </div>
            )
          })}
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
