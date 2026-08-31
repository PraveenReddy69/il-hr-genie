import { useState } from 'react'
import { Avatar } from './Bits'
import { Drawer } from './Drawer'
import { assignTicket } from '../api/client'
import { assignmentSuggestion } from '../api/ticketQueue'
import { RANK } from '../api/access'
import type { Employee, Ticket } from '../api/types'

/**
 * Who deals with this ticket.
 *
 * Reached by pressing "Needs an owner" on a row, which used to open the whole ticket.
 * Assigning was three steps behind a drawer built for resolving — open the ticket, find
 * the picker at the top, choose — when the row had already said what was wrong and who
 * was pressing it knew the answer.
 *
 * Radios rather than a select. Eight HR accounts is a list you read, and a native
 * select hides every option but one behind a second click, including the suggestion
 * that is the point of the screen.
 */
export function AssignPicker({
  ticket,
  viewer,
  hrAccounts,
  raiser,
  onClose,
  onUpdated,
}: {
  ticket: Ticket
  viewer: Employee
  hrAccounts: Employee[]
  /** The person who raised it, for the suggestion. Absent if the directory has not loaded. */
  raiser: Employee | undefined
  onClose: () => void
  onUpdated: (ticket: Ticket) => void
}) {
  const suggestion = assignmentSuggestion(hrAccounts, raiser)
  const [chosen, setChosen] = useState<string>(ticket.assigneeId ?? suggestion?.who.employeeId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const picked = hrAccounts.find((one) => one.employeeId === chosen) ?? null
  const unchanged = (ticket.assigneeId ?? '') === chosen

  async function assign() {
    /*
     * Only the assignee is checked here. Whether *this* account may assign is the
     * server's call, and the console asks rather than deciding.
     *
     * `refusalFor` also answers "may this actor assign at all", and using that answer
     * here would put the console's copy of the rule in front of the API's — the same
     * mistake the ticket queue made with department scope, where a stale client rule
     * quietly deleted rows the server had correctly returned.
     *
     * Handing a ticket to a non-HR account stays a client check: it is a property of
     * the choice rather than of the person choosing, and there is no reason to spend a
     * round trip finding out.
     */
    const wrongAssignee = picked && RANK[picked.role] < RANK.HR
    if (wrongAssignee) {
      setError(`${picked.name} is not an HR account.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      onUpdated(await assignTicket(ticket.id, chosen || null))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not assign the ticket.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer title="Assign this ticket" subtitle={`${ticket.id} · ${ticket.subject}`} onClose={onClose}>
      <div className="drawer__label">Hand it to</div>

      <div className="picklist">
        {hrAccounts.map((one) => {
          const on = chosen === one.employeeId
          return (
            <button
              key={one.employeeId}
              type="button"
              className={`pick ${on ? 'pick--on' : ''}`}
              aria-pressed={on}
              onClick={() => {
                setChosen(one.employeeId)
                setError(null)
              }}
            >
              <span className="pick__mark" aria-hidden="true" />
              <Avatar name={one.name} index={0} />
              <span className="pick__who">
                <span className="pick__name">
                  {one.employeeId === viewer.employeeId ? `${one.name} (you)` : one.name}
                </span>
                {/*
                  Why this one is suggested, not just that it is. A tag is a decision
                  somebody made about this employee; department cover is an inference we
                  drew, and an Admin overruling either should know which.
                */}
                {suggestion?.who.employeeId === one.employeeId && (
                  <span className="pick__why">
                    {suggestion.reason === 'TAGGED'
                      ? 'Their HRBP'
                      : `Covers ${raiser?.department ?? 'this department'}`}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* Only where there is something to take back. */}
      {ticket.assigneeId && (
        <button
          type="button"
          className={`pick pick--clear ${chosen === '' ? 'pick--on' : ''}`}
          aria-pressed={chosen === ''}
          onClick={() => {
            setChosen('')
            setError(null)
          }}
        >
          <span className="pick__mark" aria-hidden="true" />
          <span className="pick__who">
            <span className="pick__name">Nobody — put it back in the queue</span>
          </span>
        </button>
      )}

      {error && <div className="error">{error}</div>}

      <button className="button" onClick={assign} disabled={saving || unchanged}>
        {saving ? 'Assigning…' : unchanged && ticket.assigneeId ? 'Already assigned' : 'Assign'}
      </button>

      <div className="field-foot">
        Once assigned, only they and an Admin see this ticket.
      </div>
    </Drawer>
  )
}
