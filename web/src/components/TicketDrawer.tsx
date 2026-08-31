import { useState } from 'react'
import { Drawer } from './Drawer'
import { STATUS_COLOUR, relativeTime } from './Bits'
import { assignTicket, employeeName, updateTicketStatus } from '../api/client'
import { assignmentSuggestion, canAssign } from '../api/ticketQueue'
import { can } from '../api/access'
import {
  STATUS_LABEL,
  TICKET_STATUSES,
  type Employee,
  type Ticket,
  type TicketStatus,
} from '../api/types'

/**
 * One ticket, and the move HR wants to make on it.
 *
 * A resolved ticket reports rather than asks: the outcome leads and the controls stay
 * behind an explicit reopen, because a closed request presented as an unfinished form
 * reads as unfinished work.
 */
export function TicketDrawer({
  ticket,
  actorId,
  viewer,
  hrAccounts,
  employee,
  onClose,
  onUpdated,
}: {
  ticket: Ticket
  actorId: string
  viewer: Employee
  hrAccounts: Employee[]
  /** The person who raised it, for the suggestion. Absent if the directory has not loaded. */
  employee: Employee | undefined
  onClose: () => void
  onUpdated: (ticket: Ticket) => void
}) {
  const isResolved = ticket.status === 'RESOLVED'
  const [assigning, setAssigning] = useState(false)
  const suggestion = assignmentSuggestion(hrAccounts, employee)
  const suggested = suggestion?.who ?? null
  const owner = hrAccounts.find((one) => one.employeeId === ticket.assigneeId) ?? null
  const [reopening, setReopening] = useState(false)
  const [selected, setSelected] = useState<TicketStatus | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /**
   * Whether this account may move a ticket at all.
   *
   * `tickets.resolve` has existed since the permission set was written and nothing has
   * ever read it — the drawer showed the status controls to anybody who could open a
   * ticket. Both console roles carry it, so this changes nothing today; it means the
   * permission is real rather than decorative, and an account the server withholds it
   * from stops being offered a button that would come back 403.
   *
   * Admin and Head hold it as well as HR. Somebody has to be able to close a ticket
   * whose owner has left, and that is most of what an escalation ends in.
   */
  const mayMove = can(viewer, 'tickets.resolve')

  const controlsVisible = mayMove && (!isResolved || reopening)
  const closingNote = [...ticket.comments].reverse().find((c) => c.status === 'RESOLVED')

  /**
   * Hand it over, or take it back with an empty value.
   *
   * Applied straight away rather than gathered with the status change: assigning is a
   * decision on its own, and burying it behind the same Save as a status move means
   * either can only happen with the other.
   */
  async function assign(assigneeId: string | null) {
    setAssigning(true)
    setError(null)
    try {
      onUpdated(await assignTicket(ticket.id, assigneeId))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not assign the ticket.')
    } finally {
      setAssigning(false)
    }
  }

  async function apply() {
    if (!selected) {
      setError('Pick the status to move it to.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      onUpdated(await updateTicketStatus(ticket.id, selected, comment, actorId))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the ticket.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer title={ticket.subject} onClose={onClose}>
      {canAssign(viewer) ? (
        <>
          <div className="drawer__label">Assigned to</div>
          <select
            className="search"
            disabled={assigning}
            value={ticket.assigneeId ?? ''}
            onChange={(event) => assign(event.target.value || null)}
          >
            <option value="">Nobody yet</option>
            {hrAccounts.map((one) => (
              <option key={one.employeeId} value={one.employeeId}>
                {one.name}
                {one.employeeId === suggested?.employeeId
                  ? suggestion?.reason === 'TAGGED'
                    ? ' — their HRBP'
                    : ' — covers this department'
                  : ''}
              </option>
            ))}
          </select>
          <div className="field-foot">
            {ticket.assigneeId
              ? 'Only they and an Admin see this ticket now.'
              : suggestion?.reason === 'TAGGED'
                ? `${suggestion.who.name} is their tagged HRBP.`
                : suggestion
                  ? `${suggestion.who.name} covers ${employee?.department ?? 'this department'}.`
                  : /*
                     * Said plainly, because it is the state that needs a person. The
                     * employee has no HRBP tagged and nobody covers their department,
                     * so there is nothing to suggest and no rule that will pick one.
                     */
                    'No HRBP is tagged to them and nobody covers their department — pick an owner.'}
          </div>
        </>
      ) : (
        owner && (
          <>
            <div className="drawer__label">Assigned to</div>
            <div className="row__meta" style={{ marginBottom: 6 }}>
              {owner.employeeId === viewer.employeeId ? 'You' : owner.name}
            </div>
          </>
        )
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
          }}
        >
          {ticket.id}
        </span>
        <span className="pill pill--neutral">{ticket.category}</span>
      </div>

      <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 10 }}>
        {employeeName(ticket.employeeId)} · raised {relativeTime(ticket.createdAtMillis)}
      </div>

      {isResolved && (
        <div className="banner">
          <div className="banner__title">✅ Resolved</div>
          {closingNote && <div className="banner__body">{closingNote.text}</div>}
        </div>
      )}

      {isResolved && !reopening && mayMove && (
        <button className="button button--ghost" onClick={() => {
          setReopening(true)
          setSelected('OPEN')
        }}>
          Reopen ticket
        </button>
      )}

      {controlsVisible && (
        <>
          <div className="drawer__label">Move to</div>
          {TICKET_STATUSES.map((status) => {
            const current = status === ticket.status
            return (
              <button
                key={status}
                className={[
                  'option',
                  selected === status && !current ? 'option--on' : '',
                  current ? 'option--current' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={current}
                onClick={() => {
                  setSelected(status)
                  setError(null)
                }}
              >
                <span className="option__dot" style={{ background: STATUS_COLOUR[status] }} />
                {STATUS_LABEL[status]}
                {current && <span className="option__tag">Current</span>}
              </button>
            )
          })}

          <div className="drawer__label">
            {selected === 'RESOLVED' ? 'What did you do? (required to resolve)' : 'What did you do?'}
          </div>
          <textarea
            value={comment}
            placeholder="e.g. Payslip regenerated and emailed. Portal refreshes overnight."
            onChange={(event) => {
              setComment(event.target.value)
              setError(null)
            }}
          />
          {error && <div className="error">{error}</div>}

          <button className="button" onClick={apply} disabled={saving}>
            {saving
              ? 'Saving…'
              : selected
                ? `Move to ${STATUS_LABEL[selected]}`
                : 'Update ticket'}
          </button>
        </>
      )}

      {ticket.comments.length > 0 && (
        <>
          <div className="drawer__label">Activity</div>
          {[...ticket.comments].reverse().map((entry) => (
            <div key={entry.atMillis} style={{ padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span
                  className="option__dot"
                  style={{ background: STATUS_COLOUR[entry.status] }}
                />
                <span style={{ fontWeight: 500, fontSize: 12 }}>
                  {STATUS_LABEL[entry.status]}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10.5 }}>
                  {employeeName(entry.authorId)} · {relativeTime(entry.atMillis)}
                </span>
              </div>
              <div
                style={{
                  color: 'var(--text-slate)',
                  fontSize: 12,
                  marginLeft: 18,
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {entry.text}
              </div>
            </div>
          ))}
        </>
      )}

      <p className="note">The employee sees the new status in HR Genie chat.</p>
    </Drawer>
  )
}
