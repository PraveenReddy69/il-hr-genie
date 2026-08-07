import { useEffect, useMemo, useState } from 'react'
import {
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
import { employeeName, ensureDirectory, fetchTickets } from '../api/client'
import { STATUS_LABEL, TICKET_STATUSES, type Ticket, type TicketStatus } from '../api/types'

export function Tickets({ actorId }: { actorId: string }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [filter, setFilter] = useState<TicketStatus | null>(null)
  const [open, setOpen] = useState<Ticket | null>(null)

  useEffect(() => {
    Promise.all([fetchTickets(), ensureDirectory()]).then(([rows]) => setTickets(rows))
  }, [])

  const counts = useMemo(() => {
    const list = tickets ?? []
    return {
      all: list.length,
      OPEN: list.filter((t) => t.status === 'OPEN').length,
      IN_PROGRESS: list.filter((t) => t.status === 'IN_PROGRESS').length,
      RESOLVED: list.filter((t) => t.status === 'RESOLVED').length,
    }
  }, [tickets])

  if (!tickets) return <Loading />

  const filtered = filter ? tickets.filter((ticket) => ticket.status === filter) : tickets

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
          {counts.all} raised · {counts.OPEN + counts.IN_PROGRESS} still open
        </p>
      </div>

      <Card
        chip="🎫"
        chipColour="var(--orange-tint-14)"
        title="Where tickets stand"
        subtitle="The whole queue, by status"
      >
        <Donut
          total={counts.all}
          caption={counts.all === 1 ? 'ticket' : 'tickets'}
          slices={TICKET_STATUSES.map((status) => ({
            label: STATUS_LABEL[status],
            value: counts[status],
            colour: STATUS_COLOUR[status],
          }))}
        />
      </Card>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="chips">
          <button
            className={`chip ${filter === null ? 'chip--on' : ''}`}
            onClick={() => setFilter(null)}
          >
            All {counts.all}
          </button>
          {TICKET_STATUSES.map((status) => (
            <button
              key={status}
              className={`chip ${filter === status ? 'chip--on' : ''}`}
              onClick={() => setFilter(status)}
              style={{ opacity: counts[status] === 0 && filter !== status ? 0.5 : 1 }}
            >
              {STATUS_LABEL[status]} {counts[status]}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10 }}>
          {filtered.length === 0 && (
            <Empty>Nothing {filter ? STATUS_LABEL[filter].toLowerCase() : ''} right now.</Empty>
          )}
          {filtered.map((ticket) => (
            <div className="row" key={ticket.id} {...clickable(() => setOpen(ticket))}>
              <span className="accent" style={{ background: STATUS_COLOUR[ticket.status] }} />
              <div className="row__main">
                <div className="row__title">{ticket.subject}</div>
                <div className="row__meta">
                  {ticket.id} · {ticket.category} · {employeeName(ticket.employeeId)} ·{' '}
                  {relativeTime(ticket.createdAtMillis)}
                </div>
              </div>
              <StatusPill status={ticket.status} />
            </div>
          ))}
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
          onClose={() => setOpen(null)}
          onUpdated={applyUpdate}
        />
      )}
    </>
  )
}
