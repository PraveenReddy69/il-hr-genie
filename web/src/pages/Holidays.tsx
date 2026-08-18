import { useEffect, useMemo, useState } from 'react'
import { Card, Empty, Loading } from '../components/Bits'
import { isoDate } from '../api/mock'
import {
  ANY_REGION,
  REGIONS,
  currentCalendar,
  discardLocal,
  inRegion,
  inYear,
  isClosedYear,
  refusalFor,
  saveCalendar,
  sortCalendar,
  validate,
  yearsCovered,
  type HolidayDraft,
} from '../api/holidayStore'
import type { Holiday, HolidayKind } from '../api/types'

/**
 * The holiday calendar.
 *
 * `editable` is `holidays.edit`, which only Admin and above hold. HRBPs read the same
 * calendar and use the same filters — knowing which days their region observes is part
 * of the job; deciding them is not.
 *
 * Editing controls are removed rather than disabled for a reader, but a **settled**
 * holiday keeps its row and says why it cannot be changed. Those are different cases:
 * one is "not your job", which needs no explanation, and the other is "nobody can
 * change this now", which does.
 */
export function Holidays({ editable = false }: { editable?: boolean }) {
  const today = isoDate()
  const [calendar, setCalendar] = useState<{ holidays: Holiday[]; unsaved: boolean } | null>(null)
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [region, setRegion] = useState<string>(ANY_REGION)
  const [editing, setEditing] = useState<{ draft: HolidayDraft; original: Holiday | null } | null>(
    null,
  )
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setCalendar(currentCalendar())
  }, [])

  const all = calendar?.holidays ?? []
  const years = yearsCovered(all, today)
  const closed = isClosedYear(year, today)

  const { shown, byMonth, next, fixed, optional } = useMemo(() => {
    const list = inRegion(inYear(all, year), region)
    const ahead = list.filter((one) => one.isoDate >= today)
    const grouped = new Map<string, Holiday[]>()
    list.forEach((one) => {
      const month = one.isoDate.slice(0, 7)
      grouped.set(month, [...(grouped.get(month) ?? []), one])
    })
    return {
      shown: list,
      byMonth: [...grouped.entries()],
      next: ahead[0] ?? null,
      fixed: list.filter((one) => one.kind === 'FIXED').length,
      optional: list.filter((one) => one.kind === 'OPTIONAL').length,
    }
  }, [all, year, region, today])

  if (!calendar) return <Loading />

  /**
   * Every write goes through here.
   *
   * The rules are checked again on the way in rather than trusted from whichever
   * control was pressed — a row that should have been locked but was not is a bug
   * worth catching before it reaches storage, not after.
   */
  function commit(holidays: Holiday[]) {
    // Sorted here as well as on the way to storage. Without it a newly added holiday
    // sits at the bottom of the list until the next reload, which reads as the add
    // having gone somewhere odd rather than into November.
    setCalendar({ holidays: sortCalendar(holidays), unsaved: true })
    try {
      saveCalendar(holidays)
      setProblem(null)
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'Could not save that change.')
    }
  }

  function save() {
    if (!editing) return
    const others = all.filter((one) => one !== editing.original)
    const wrong = validate(editing.draft, others, today)
    if (wrong) {
      setProblem(wrong)
      return
    }
    // The original is dropped and the edited record added, rather than mutated in
    // place: changing a date moves it in the list, and an in-place edit leaves it
    // sorted where it used to be until the next reload.
    commit([...others, { ...editing.draft }])
    setEditing(null)
  }

  function remove(holiday: Holiday) {
    const refusal = refusalFor(holiday.isoDate, today)
    if (refusal) {
      setProblem(refusal)
      return
    }
    commit(all.filter((one) => one !== holiday))
    setConfirmRemove(null)
  }

  return (
    <>
      <div className="page-head">
        <h1>Holiday calendar</h1>
        <p>
          {shown.length} published for {year}
          {region !== ANY_REGION && ` in ${region}`}
        </p>
      </div>

      <div className="banner banner--info">
        <div className="banner__title">Not on the server yet</div>
        <div className="banner__body">
          The calendar is hard-coded in this console, the Teams bot and the Android app,
          and no endpoint writes to it. Changes here are kept in this browser so the
          dates and regions can be agreed now; they reach employees once the routes in{' '}
          <code>docs/HOLIDAYS_BACKEND.md</code> exist.
          {calendar.unsaved && (
            <>
              {' '}
              <button
                className="linkish"
                onClick={() => {
                  discardLocal()
                  setCalendar(currentCalendar())
                  setEditing(null)
                }}
              >
                Discard local edits
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid--3">
        <Card chip="🌴" chipColour="var(--green-tint-14)" title="Next holiday">
          {next ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {next.name}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 4 }}>
                {longDate(next.isoDate)} · {countdown(next.isoDate, today)}
              </div>
            </>
          ) : (
            <Empty>Nothing left this year.</Empty>
          )}
        </Card>

        <Card chip="📌" chipColour="var(--blue-tint-12)" title="Fixed">
          <div className="tile__value" style={{ color: 'var(--blue-deep)' }}>
            {fixed}
          </div>
          <div className="tile__sub">Paid, set under the Act</div>
        </Card>

        <Card chip="🎈" chipColour="var(--purple-tint-12)" title="Optional">
          <div className="tile__value" style={{ color: 'var(--purple)' }}>
            {optional}
          </div>
          <div className="tile__sub">Employees pick from these</div>
        </Card>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="chips">
          {years.map((option) => (
            <button
              key={option}
              className={`chip ${option === year ? 'chip--on' : ''}`}
              onClick={() => {
                setYear(option)
                setEditing(null)
                setProblem(null)
              }}
            >
              {option}
            </button>
          ))}

          <select
            className="search"
            style={{ marginLeft: 'auto', width: 'auto' }}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            <option value={ANY_REGION}>{ANY_REGION}</option>
            {REGIONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>

          {editable && !closed && (
            <button
              className="chip"
              onClick={() => {
                setProblem(null)
                setEditing({
                  draft: {
                    name: '',
                    // Somewhere inside the year being viewed, not today — an Admin
                    // filling in next year should not have to correct the year on
                    // every single entry.
                    isoDate: startingDateFor(year, today),
                    kind: 'FIXED',
                    region: region === ANY_REGION ? 'All India' : region,
                  },
                  original: null,
                })
              }}
            >
              + Add holiday
            </button>
          )}
        </div>

        {closed && (
          <p className="note" style={{ marginTop: 12 }}>
            {year} is closed. Past calendars are kept as a record and cannot be changed.
          </p>
        )}

        {problem && (
          <div className="error" style={{ marginTop: 12 }}>
            {problem}
          </div>
        )}

        {editing && (
          <Editor
            draft={editing.draft}
            isNew={editing.original === null}
            onChange={(draft) => setEditing({ ...editing, draft })}
            onSave={save}
            onCancel={() => {
              setEditing(null)
              setProblem(null)
            }}
          />
        )}

        {shown.length === 0 ? (
          <Empty style={{ marginTop: 14 }}>
            {region === ANY_REGION
              ? `No calendar published for ${year} yet.`
              : `Nothing published for ${region} in ${year}.`}
          </Empty>
        ) : (
          <div style={{ marginTop: 8 }}>
            {byMonth.map(([month, entries]) => (
              <div key={month}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    marginTop: 18,
                    marginBottom: 2,
                  }}
                >
                  {monthLabel(month)}
                </div>
                {entries.map((holiday) => {
                  // Days already gone stay listed but recede — the calendar is a
                  // record of the year, not just what is left of it.
                  const settled = refusalFor(holiday.isoDate, today) !== null
                  const isToday = holiday.isoDate === today
                  const key = `${holiday.isoDate}-${holiday.region}`
                  return (
                    <div className="row" key={key} style={{ opacity: settled ? 0.45 : 1 }}>
                      <span className="datechip">
                        <span className="datechip__day">{holiday.isoDate.slice(8)}</span>
                        <span className="datechip__month">{shortMonth(holiday.isoDate)}</span>
                      </span>
                      <div className="row__main">
                        <div className="row__title">
                          {holiday.name}
                          {isToday && (
                            <span className="pill pill--resolved" style={{ marginLeft: 8 }}>
                              Today
                            </span>
                          )}
                        </div>
                        <div className="row__meta">
                          {weekday(holiday.isoDate)} · {holiday.region}
                        </div>
                      </div>

                      <span
                        className={`pill ${holiday.kind === 'OPTIONAL' ? 'pill--optional' : 'pill--neutral'}`}
                      >
                        {holiday.kind === 'OPTIONAL' ? 'Optional' : 'Fixed'}
                      </span>

                      {editable && !settled && (
                        <span className="qrow__acts" style={{ marginLeft: 8 }}>
                          <button
                            className="qrow__act"
                            onClick={() => {
                              setProblem(null)
                              setConfirmRemove(null)
                              setEditing({ draft: { ...holiday }, original: holiday })
                            }}
                          >
                            Edit
                          </button>
                          {confirmRemove === key ? (
                            <span className="qrow__confirm">
                              <button
                                className="qrow__act qrow__act--danger"
                                onClick={() => remove(holiday)}
                              >
                                Remove
                              </button>
                              <button className="qrow__act" onClick={() => setConfirmRemove(null)}>
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button className="qrow__act" onClick={() => setConfirmRemove(key)}>
                              Remove
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="note">
        The published calendar. Employees see the same list in the app; optional days
        are the ones they choose between.
      </p>
    </>
  )
}

/** The add and edit form. One shape for both, because they differ only in the title. */
function Editor({
  draft,
  isNew,
  onChange,
  onSave,
  onCancel,
}: {
  draft: HolidayDraft
  isNew: boolean
  onChange: (draft: HolidayDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const set = (patch: Partial<HolidayDraft>) => onChange({ ...draft, ...patch })

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--surface-2, transparent)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 10 }}>
        {isNew ? 'New holiday' : `Editing ${draft.name || 'holiday'}`}
      </div>

      <div className="drawer__label">Name</div>
      <input
        className="search"
        value={draft.name}
        placeholder="Diwali"
        onChange={(event) => set({ name: event.target.value })}
      />

      <div className="drawer__label">Date</div>
      <input
        className="search"
        type="date"
        value={draft.isoDate}
        onChange={(event) => set({ isoDate: event.target.value })}
      />

      <div className="drawer__label">Region</div>
      <select
        className="search"
        value={draft.region}
        onChange={(event) => set({ region: event.target.value })}
      >
        {REGIONS.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>

      <div className="drawer__label">Kind</div>
      <select
        className="search"
        value={draft.kind}
        onChange={(event) => set({ kind: event.target.value as HolidayKind })}
      >
        <option value="FIXED">Fixed — everyone gets it</option>
        <option value="OPTIONAL">Optional — employees choose</option>
      </select>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="button" onClick={onSave}>
          {isNew ? 'Add holiday' : 'Save changes'}
        </button>
        <button className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Where a new entry starts.
 *
 * Today when the current year is showing, otherwise the first of the year being looked
 * at — an Admin filling in next year in December should not have to fix the year on
 * every entry, and the date picker refuses a past one anyway.
 */
function startingDateFor(year: number, today: string): string {
  return year === Number(today.slice(0, 4)) ? today : `${year}-01-01`
}

function longDate(isoDateValue: string): string {
  return new Date(`${isoDateValue}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function weekday(isoDateValue: string): string {
  return new Date(`${isoDateValue}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' })
}

function shortMonth(isoDateValue: string): string {
  return new Date(`${isoDateValue}T00:00:00`)
    .toLocaleDateString(undefined, { month: 'short' })
    .toUpperCase()
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function countdown(isoDateValue: string, today: string): string {
  const days = Math.round(
    (new Date(`${isoDateValue}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
      86_400_000,
  )
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 30) return `in ${days} days`
  const weeks = Math.round(days / 7)
  return `in ${weeks} weeks`
}
