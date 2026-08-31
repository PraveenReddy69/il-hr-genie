import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Avatar, Empty, Loading, STATUS_COLOUR, clickable, relativeTime } from '../components/Bits'
import {
  AccessIcon,
  AttendanceIcon,
  CloseIcon,
  FacilitiesIcon,
  HintIcon,
  InsuranceIcon,
  LeaveIcon,
  OpenIcon,
  PayrollIcon,
  ProgressIcon,
  SearchIcon,
  SomethingElseIcon,
  TickIcon,
  UnownedIcon,
  WaitingIcon,
} from '../components/Icons'
import { TicketDrawer } from '../components/TicketDrawer'
import { employeeName, ensureDirectory, fetchEmployees, fetchTickets } from '../api/client'
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
 * One axis in the layout and one in the filter: status groups the list, the segmented
 * control narrows it by owner. They used to be the other way round and fought each
 * other — an In progress ticket sat under "Needs an owner" — so each fact now appears
 * exactly once.
 *
 * The list is narrowed before it is filtered; see visibleTickets. An assigned ticket
 * belongs to one person and leaves everyone else's queue. That is a decision about what
 * to draw, and the API has to make the same one about what to return.
 */
export function Tickets({ actorId, viewer }: { actorId: string; viewer: Employee }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [people, setPeople] = useState<Employee[]>([])
  const [assignee, setAssignee] = useState<string>(ANY_ASSIGNEE)
  const [view, setView] = useState<View>('ALL')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Ticket | null>(null)
  const [hintShown, setHintShown] = useState(() => localStorage.getItem(HINT_KEY) !== 'dismissed')
  const [loadError, setLoadError] = useState<string | null>(null)

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
          if (cancelled) return
          setTickets(rows)
          setLoadError(null)
        })
        .catch((failure: unknown) => {
          if (cancelled) return
          // A failed refresh keeps the rows already on screen — see above. A failed
          // *first* load used to keep the spinner instead, forever and with no message,
          // which is the worst of both: nothing to read and nothing to do.
          setLoadError(failure instanceof Error ? failure.message : 'Could not load the queue.')
          setTickets((current) => current ?? [])
        })
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
    fetchEmployees()
      .then(setPeople)
      .catch(() => setPeople([]))
  }, [])

  const employeeById = useMemo(() => new Map(people.map((one) => [one.employeeId, one])), [people])

  /** HR accounts a ticket can be handed to. Admins included: they cover holidays. */
  const hrAccounts = useMemo(() => people.filter((one) => isConsoleRole(one.role)), [people])

  /** Everything this account may see, before either filter. */
  const mine = useMemo(() => visibleTickets(tickets ?? [], viewer), [tickets, viewer])

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
        [one.id, one.subject, employeeName(one.employeeId)].join(' ').toLowerCase().includes(term),
      )
    : mine

  const byOwner = byAssignee(matching, assignee, viewer.employeeId)
  const filtered = byOwner.filter((one) => inView(one, view, now))

  /*
   * Grouped only while looking at everything.
   *
   * Four status headings over one scrolling list is what made a queue of thirty
   * unreadable: the thing you came for was somewhere below two headings you did not
   * care about. Once a card is chosen the heading would only repeat the card, so the
   * rows stand on their own.
   */
  const groups =
    view === 'ALL'
      ? TICKET_STATUSES.map((status) => ({
          key: status,
          label: STATUS_LABEL[status],
          rows: filtered.filter((one) => one.status === status),
        }))
      : [{ key: view, label: '', rows: filtered }]

  /** Pick a card, or press the one already on to go back to everything. */
  function pick(next: View) {
    setView((current) => (current === next ? 'ALL' : next))
  }

  function applyUpdate(updated: Ticket) {
    setTickets((current) =>
      (current ?? []).map((ticket) => (ticket.id === updated.id ? updated : ticket)),
    )
  }

  function dismissHint() {
    localStorage.setItem(HINT_KEY, 'dismissed')
    setHintShown(false)
  }

  return (
    <>
      <div className="page-head">
        <h1>Ticket queue</h1>
        <p>
          {view === 'ALL' ? (
            <>
              {counts.all} in your queue · {counts.OPEN + counts.IN_PROGRESS} still open
            </>
          ) : (
            <>
              {VIEW_LABEL[view]} · {filtered.length} of {counts.all}{' '}
              <button className="linkish" onClick={() => setView('ALL')}>
                Show all
              </button>
            </>
          )}
        </p>
      </div>

      {/*
        Shown above the queue rather than in place of it. A refresh that fails while
        rows are on screen should say so without taking them away — the last known
        queue is more use than an error page.
      */}
      {loadError && (
        <div className="banner banner--warn" style={{ marginBottom: 16 }}>
          <div className="banner__title">Could not reach the queue</div>
          <div className="banner__body">{loadError}</div>
        </div>
      )}

      <div className="stats">
        <Stat
          label="Open"
          value={counts.OPEN}
          sub="Needs attention"
          accent="var(--orange-warn)"
          tint="var(--orange-tint-14)"
          icon={<OpenIcon />}
          on={view === 'OPEN'}
          onPick={() => pick('OPEN')}
        />
        <Stat
          label="In progress"
          value={counts.IN_PROGRESS}
          sub="Being worked on"
          accent="var(--blue-primary)"
          tint="var(--blue-tint-12)"
          icon={<ProgressIcon />}
          on={view === 'IN_PROGRESS'}
          onPick={() => pick('IN_PROGRESS')}
        />
        <Stat
          label="Unassigned"
          value={counts.unassigned}
          sub="Awaiting assignment"
          // Colour only where the number is a prompt. Nought unassigned is good news,
          // and good news in orange is a warning nobody reads.
          accent={counts.unassigned > 0 ? 'var(--orange-warn)' : 'var(--ink-12)'}
          tint={counts.unassigned > 0 ? 'var(--orange-tint-14)' : 'var(--ink-05)'}
          icon={<UnownedIcon />}
          on={view === 'UNASSIGNED'}
          onPick={() => pick('UNASSIGNED')}
        />
        <Stat
          label={`Waiting ${AGEING_DAYS}d+`}
          value={counts.ageing}
          sub="Requires follow up"
          accent={counts.ageing > 0 ? 'var(--red-risk)' : 'var(--green-ok)'}
          tint={counts.ageing > 0 ? 'rgba(229, 72, 77, 0.12)' : 'var(--green-tint-14)'}
          icon={<WaitingIcon />}
          on={view === 'AGEING'}
          onPick={() => pick('AGEING')}
        />
      </div>

      <div className="queuecard" style={{ marginTop: 16 }}>
        <div className="toolbar">
          <label className="toolbar__search">
            <SearchIcon />
            <input
              value={query}
              placeholder="Search by subject, reference or person…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="seg">
            <button
              className={`seg__item ${assignee === ANY_ASSIGNEE ? 'seg__item--on' : ''}`}
              onClick={() => setAssignee(ANY_ASSIGNEE)}
            >
              {ANY_ASSIGNEE}
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
              style={{ width: 'auto', flex: 'none' }}
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

        <div className="queue">
          {filtered.length === 0 && (
            <Empty style={{ marginTop: 14 }}>
              {term
                ? `Nothing matches “${query.trim()}”.`
                : view === 'UNASSIGNED'
                  ? 'Everything open has somebody on it.'
                  : view === 'AGEING'
                    ? `Nothing has been waiting ${AGEING_DAYS} days or more.`
                    : view === 'ALL'
                      ? 'Nothing here right now.'
                      : `Nothing is ${VIEW_LABEL[view].toLowerCase()}.`}
            </Empty>
          )}

          {groups.map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.key}>
                {/* Only when looking at everything — otherwise it repeats the card. */}
                {group.label !== '' && (
                  <div className={`qgroup qgroup--${group.key}`}>
                    {group.label}
                    <span className="qgroup__count">{group.rows.length}</span>
                  </div>
                )}

                {group.rows.map((ticket) => {
                  const owner = ticket.assigneeId ? employeeById.get(ticket.assigneeId) : undefined
                  const waiting = daysWaiting(ticket, now)
                  const resolved = ticket.status === 'RESOLVED'
                  return (
                    <div className="row" key={ticket.id} {...clickable(() => setOpen(ticket))}>
                      <span
                        className="accent"
                        style={{ background: STATUS_COLOUR[ticket.status] }}
                      />

                      {/* The category, as a shape. A queue is scanned before it is read. */}
                      <span
                        className="rowicon"
                        style={{
                          background: tintFor(ticket.status),
                          color: STATUS_COLOUR[ticket.status],
                        }}
                        title={ticket.category}
                      >
                        {iconFor(ticket.category)}
                      </span>

                      <div className="row__main">
                        <div className="row__title">{ticket.subject}</div>
                        <div className="row__meta">
                          <span className="ref">{ticket.id}</span> · {ticket.category} ·{' '}
                          {employeeName(ticket.employeeId)} · {relativeTime(ticket.createdAtMillis)}
                          {/* Only once it is worth chasing. A day-old ticket is not
                              late, and a badge on everything is a badge on nothing. */}
                          {waiting >= AGEING_DAYS && (
                            <span style={{ color: 'var(--red-risk)', marginLeft: 8 }}>
                              · waiting {waiting} days
                            </span>
                          )}
                        </div>
                      </div>

                      {/*
                        Nothing about ownership on a resolved ticket. It is finished, and
                        an "Unassigned" chip on closed rows made the queue look like a
                        list of open problems.
                      */}
                      {resolved ? (
                        <span className="pill pill--done">
                          <TickIcon />
                          Resolved
                        </span>
                      ) : owner ? (
                        <span className="owner" title={`Assigned to ${owner.name}`}>
                          <Avatar name={owner.name} index={0} />
                          {owner.employeeId === viewer.employeeId ? 'You' : owner.name}
                        </span>
                      ) : (
                        <span className="pill pill--outline">
                          <UnownedIcon />
                          Needs an owner
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ),
          )}

          {hintShown && (
            <div className="hintbar">
              <HintIcon />
              <span>
                Click a ticket to move it on. Resolving needs a note saying what was done —
                the employee sees it in HR Genie chat.
              </span>
              <button className="hintbar__close" onClick={dismissHint} aria-label="Dismiss">
                <CloseIcon />
              </button>
            </div>
          )}
        </div>
      </div>

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

/**
 * One figure, and the filter behind it.
 *
 * These were four numbers you could read and not act on, above a list showing every
 * status at once. Seeing "In progress 10" and then hunting for those ten under three
 * other headings is the work the card should have done.
 *
 * A button, not a div with a handler: it lands in the tab order and answers the space
 * bar, which matters on a screen HR drives all day.
 */
function Stat({
  label,
  value,
  sub,
  accent,
  tint,
  icon,
  on,
  onPick,
}: {
  label: string
  value: number
  sub: string
  accent: string
  tint: string
  icon: ReactNode
  on: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`stat ${on ? 'stat--on' : ''}`}
      style={{ '--stat-accent': accent, '--stat-tint': tint } as CSSProperties}
      aria-pressed={on}
      onClick={onPick}
    >
      <span className="stat__icon">{icon}</span>
      <div>
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        <div className="stat__sub">{sub}</div>
      </div>
    </button>
  )
}

/**
 * The glyph for a category.
 *
 * Falls back rather than rendering nothing: the category list comes from the API, so a
 * name this console has never heard of is expected, not a bug.
 */
function iconFor(category: string) {
  switch (category) {
    case 'Payroll':
      return <PayrollIcon />
    case 'Leave':
      return <LeaveIcon />
    case 'IT & access':
      return <AccessIcon />
    case 'Insurance':
      return <InsuranceIcon />
    case 'Facilities':
      return <FacilitiesIcon />
    case 'Attendance':
      return <AttendanceIcon />
    default:
      return <SomethingElseIcon />
  }
}

/** The glyph tile takes the status tint, so a row reads as one colour. */
function tintFor(status: TicketStatus): string {
  if (status === 'OPEN') return 'var(--orange-tint-14)'
  if (status === 'IN_PROGRESS') return 'var(--blue-tint-12)'
  return 'var(--green-tint-14)'
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

/**
 * Which slice of the queue is on screen.
 *
 * Two of these are statuses and two cut across them — a ticket can be unassigned and
 * open, or in progress and waiting a week. They share one selector because only one
 * question is being asked: what am I looking at? Two filters that each half-apply is
 * how the old screen ended up showing thirty rows under four headings.
 */
type View = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'UNASSIGNED' | 'AGEING'

const VIEW_LABEL: Record<View, string> = {
  ALL: 'All',
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  UNASSIGNED: 'Unassigned',
  AGEING: `Waiting ${AGEING_DAYS}d+`,
}

function inView(ticket: Ticket, view: View, nowMillis: number): boolean {
  switch (view) {
    case 'ALL':
      return true
    case 'OPEN':
      return ticket.status === 'OPEN'
    case 'IN_PROGRESS':
      return ticket.status === 'IN_PROGRESS'
    // Resolved tickets are excluded from both of these, matching the counts on the
    // cards. A closed ticket has no owner and does not need one, and it has stopped
    // waiting for anybody.
    case 'UNASSIGNED':
      return !ticket.assigneeId && ticket.status !== 'RESOLVED'
    case 'AGEING':
      return daysWaiting(ticket, nowMillis) >= AGEING_DAYS
  }
}

/** Dismissed for good, not for this visit — it is only news once. */
const HINT_KEY = 'hr-genie-queue-hint'
