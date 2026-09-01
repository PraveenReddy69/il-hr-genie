import { relativeTime } from './Bits'
import { Avatar } from './Bits'
import type { Ticket, TicketStatus } from '../api/types'
import { STATUS_LABEL } from '../api/types'

/**
 * The column beside the queue.
 *
 * Everything here is derived from the tickets already on screen — no second endpoint,
 * and nothing that claims to know more than the list does. That is also why there is no
 * "quick actions" panel: assigning, noting and bulk-updating all need a ticket chosen
 * first, and a button that opens nothing is worse than an absent one.
 */

const SLICES: { status: TicketStatus; colour: string }[] = [
  { status: 'OPEN', colour: 'var(--orange-warn)' },
  { status: 'IN_PROGRESS', colour: 'var(--blue-primary)' },
  { status: 'RESOLVED', colour: 'var(--green-ok)' },
]

export function QueueRail({
  tickets,
  ageing,
  unassigned,
  nameOf,
  onExport,
}: {
  /** Everything this account may see, before the view filter. The rail describes the
      whole queue rather than the slice being looked at, which is the point of it. */
  tickets: Ticket[]
  ageing: number
  unassigned: number
  nameOf: (employeeId: string) => string
  onExport: () => void
}) {
  const total = tickets.length
  const counts = SLICES.map(({ status, colour }) => ({
    status,
    colour,
    n: tickets.filter((t) => t.status === status).length,
  }))

  return (
    <aside className="rail">
      <section className="card">
        <header className="card__head">
          <div style={{ minWidth: 0 }}>
            <div className="card__title">Queue by status</div>
          </div>
        </header>

        {total === 0 ? (
          <p className="rail__none">Nothing in the queue.</p>
        ) : (
          <>
            <Donut total={total} slices={counts} />

            <ul className="legend">
              {counts.map(({ status, colour, n }) => (
                <li key={status}>
                  <span className="legend__dot" style={{ background: colour }} />
                  <span className="legend__name">{STATUS_LABEL[status]}</span>
                  <span className="legend__n">
                    {n} <small>({Math.round((n / total) * 100)}%)</small>
                  </span>
                </li>
              ))}
            </ul>

            {/*
              Below the rule because these two cut across the three above rather than
              adding to them — a ticket can be open and unassigned and waiting a week.
              Drawn as arcs they would have made a chart that sums to more than itself.
            */}
            <div className="legend legend--of">
              <div className="legend__caption">of which</div>
              <ul>
                <li>
                  <span className="legend__name">Unassigned</span>
                  <span className="legend__n">{unassigned}</span>
                </li>
                <li>
                  <span className="legend__name">Waiting 3d+</span>
                  <span className="legend__n">{ageing}</span>
                </li>
              </ul>
            </div>
          </>
        )}

        <button className="rail__export" onClick={onExport} disabled={total === 0}>
          Export this queue (CSV)
        </button>
      </section>

      <Activity tickets={tickets} nameOf={nameOf} />
    </aside>
  )
}

/**
 * The ring.
 *
 * Drawn with dash offsets on one circle rather than as paths: three arcs of a known
 * circumference need no trigonometry, and a segment that rounds to nothing simply does
 * not draw instead of collapsing into a wedge.
 */
function Donut({
  total,
  slices,
}: {
  total: number
  slices: { status: TicketStatus; colour: string; n: number }[]
}) {
  const R = 54
  const C = 2 * Math.PI * R
  let used = 0

  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={R} className="donut__track" />
        {slices.map(({ status, colour, n }) => {
          if (n === 0) return null
          const share = n / total
          const dash = share * C
          // Rotated so the first slice starts at twelve o'clock rather than three.
          const offset = -used * C
          used += share
          return (
            <circle
              key={status}
              cx="70"
              cy="70"
              r={R}
              stroke={colour}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={offset}
              className="donut__slice"
            />
          )
        })}
      </svg>
      <div className="donut__mid">
        <div className="donut__total">{total}</div>
        <div className="donut__cap">Total</div>
      </div>
    </div>
  )
}

/**
 * What has happened lately, taken from the tickets themselves.
 *
 * There is no activity endpoint — `/api/audit` is a 404 — but every status change
 * leaves a comment carrying who moved it, where to, and when. That is a real record of
 * real events, which a hand-written feed of plausible-looking names would not be.
 *
 * Assignments are absent because nothing records them yet. When the API logs one, it
 * belongs here.
 */
function Activity({
  tickets,
  nameOf,
}: {
  tickets: Ticket[]
  nameOf: (employeeId: string) => string
}) {
  const events = tickets
    .flatMap((ticket) =>
      (ticket.comments ?? []).map((c) => ({
        id: `${ticket.id}-${c.atMillis}`,
        who: c.authorId,
        did: verb(c.status),
        at: c.atMillis,
      })),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)

  if (events.length === 0) return null

  return (
    <section className="card">
      <header className="card__head">
        <div style={{ minWidth: 0 }}>
          <div className="card__title">Recent activity</div>
        </div>
      </header>

      <ul className="activity">
        {events.map((event, index) => (
          <li key={event.id}>
            <Avatar name={nameOf(event.who)} index={index} />
            <span className="activity__body">
              <span className="activity__who">{nameOf(event.who)}</span>
              <span className="activity__did">{event.did}</span>
            </span>
            <span className="activity__when">{relativeTime(event.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function verb(status: TicketStatus): string {
  switch (status) {
    case 'RESOLVED':
      return 'resolved a ticket'
    case 'IN_PROGRESS':
      return 'picked up a ticket'
    case 'OPEN':
      return 'reopened a ticket'
  }
}
