import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Empty, Loading } from '../components/Bits'
import { isoDate } from '../api/mock'
import {
  ANY_REGION,
  inRegion,
  inYear,
  isClosedYear,
  refusalFor,
  sortCalendar,
  validate,
  yearsCovered,
  type HolidayDraft,
} from '../api/holidayStore'
import {
  createHoliday,
  deleteHoliday,
  fetchHolidayCalendar,
  fetchHolidayRegions,
  updateHoliday,
} from '../api/client'
import { REGIONS as FALLBACK_REGIONS } from '../api/holidayStore'
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
  const [calendar, setCalendar] = useState<Holiday[] | null>(null)
  const [regions, setRegions] = useState<string[]>([])
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [region, setRegion] = useState<string>(ANY_REGION)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ draft: HolidayDraft; original: Holiday | null } | null>(
    null,
  )
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /**
   * Reloads the whole year rather than patching the row in place.
   *
   * The server owns ids, sort order and whatever it decides to normalise, so guessing
   * the result of a write is how a list drifts from what was actually saved. One extra
   * request per edit, on a page edited a handful of times a year.
   */
  const reload = useCallback(
    (forYear: number) =>
      fetchHolidayCalendar(forYear)
        .then(({ holidays }) => setCalendar(sortCalendar(holidays)))
        .catch((failure: unknown) => {
          setCalendar([])
          setProblem(failure instanceof Error ? failure.message : 'Could not load the calendar.')
        }),
    [],
  )

  useEffect(() => {
    void reload(year)
  }, [reload, year])

  useEffect(() => {
    // A failed region list is not worth blocking the page: fetchHolidayRegions falls
    // back to the console's own copy.
    fetchHolidayRegions().then(setRegions).catch(() => setRegions([]))
  }, [])

  const all = calendar ?? []
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

  // The server's list where there is one; the console's own only until it answers.
  const regionOptions: string[] = regions.length > 0 ? regions : [...FALLBACK_REGIONS]

  /**
   * One place every write passes through.
   *
   * The server's own message is shown rather than a rewritten one: it is the side that
   * knows which rule was hit — a closed year answers 409 with a sentence, and second
   * -guessing it here would show the console's opinion of a refusal it did not make.
   */
  async function attempt(work: () => Promise<unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      await work()
      await reload(year)
      return true
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'Could not save that change.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!editing) return
    const others = all.filter((one) => one !== editing.original)
    const wrong = validate(editing.draft, others, today, regions.length ? regions : undefined)
    if (wrong) {
      setProblem(wrong)
      return
    }

    const original = editing.original
    const draft = { ...editing.draft }
    const ok = await attempt(() =>
      // An edit without an id would have to be a delete and a create, which the audit
      // log reads as two unrelated events. The endpoint sends one; if it ever does not,
      // failing loudly beats silently splitting a correction in two.
      original?.id ? updateHoliday(original.id, draft) : createHoliday(draft),
    )
    if (ok) setEditing(null)
  }

  async function remove(holiday: Holiday) {
    const refusal = refusalFor(holiday.isoDate, today)
    if (refusal) {
      setProblem(refusal)
      return
    }
    if (!holiday.id) {
      setProblem('That holiday has no id, so it cannot be removed. Reload and try again.')
      return
    }
    const ok = await attempt(() => deleteHoliday(holiday.id!))
    if (ok) setConfirmRemove(null)
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
            {regionOptions.map((one) => (
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
            regions={regionOptions}
            saving={busy}
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
  regions,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: HolidayDraft
  isNew: boolean
  regions: string[]
  saving: boolean
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
        {regions.map((one) => (
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
        <button className="button" disabled={saving} onClick={onSave}>
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
