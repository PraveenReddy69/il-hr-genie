import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, Loading } from '../components/Bits'
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

      {/*
        Three cards, and the first is a different shape from the other two on purpose.

        "Next holiday" answers a question people actually ask — when is the next day
        off — so it carries a name and a date. The other two are counts, and a count of
        fixed days beside a count of optional ones is the shape of the year: how much is
        given and how much is chosen.
      */}
      <div className="holstats">
        <div className="holstat holstat--next">
          <span className="holstat__mark">
            <PalmIcon />
          </span>
          <div className="holstat__label">Next holiday</div>
          {next ? (
            <>
              <div className="holstat__name">{next.name}</div>
              <div className="holstat__when">
                {longDate(next.isoDate)} · {countdown(next.isoDate, today)}
              </div>
            </>
          ) : (
            <div className="holstat__none">Nothing left this year.</div>
          )}
          <CalendarWatermark />
        </div>

        <div className="holstat holstat--fixed">
          <span className="holstat__mark">
            <PinIcon />
          </span>
          <div className="holstat__label">Fixed</div>
          <div className="holstat__value">{fixed}</div>
          <div className="holstat__sub">Paid, set under the Act</div>
          <DocWatermark />
        </div>

        <div className="holstat holstat--optional">
          <span className="holstat__mark">
            <BalloonIcon />
          </span>
          <div className="holstat__label">Optional</div>
          <div className="holstat__value">{optional}</div>
          <div className="holstat__sub">Employees pick from these</div>
          <PeopleWatermark />
        </div>
      </div>

      {/* The form stands beside the calendar rather than on top of it: the date you
          are typing usually depends on what is already there. */}
      <div className={`hollayout ${editing ? 'hollayout--split' : ''}`}>
      <section className="card">
        <div className="holbar">
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
          </div>

          <div className="regionpick">
            <GlobeIcon />
            <select
              className="regionpick__select"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              aria-label="Filter by region"
            >
              <option value={ANY_REGION}>{ANY_REGION}</option>
              {regionOptions.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>

          {editable && !closed && (
            <button
              className="button holbar__add"
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
              <PlusIcon />
              Add holiday
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

        {shown.length === 0 ? (
          <Empty style={{ marginTop: 14 }}>
            {region === ANY_REGION
              ? `No calendar published for ${year} yet.`
              : `Nothing published for ${region} in ${year}.`}
          </Empty>
        ) : (
          <div className="holyear">
            {byMonth.map(([month, entries]) => (
              <div key={month}>
                <div className="monthhead">{monthLabel(month)}</div>
                {entries.map((holiday) => {
                  // Days already gone stay listed but recede — the calendar is a
                  // record of the year, not just what is left of it.
                  const settled = refusalFor(holiday.isoDate, today) !== null
                  const isToday = holiday.isoDate === today
                  const key = `${holiday.isoDate}-${holiday.region}`
                  const editingThis = editing?.original === holiday
                  return (
                    <div
                      className={`holrow ${settled ? 'holrow--settled' : ''} ${
                        editingThis ? 'holrow--editing' : ''
                      } ${confirmRemove === key ? 'holrow--confirming' : ''}`}
                      key={key}
                    >
                      {/* Which kind, before you read a word. The pill on the right says
                          it too, but the dot is what makes a month scannable. */}
                      <span
                        className={`holrow__dot holrow__dot--${holiday.kind.toLowerCase()}`}
                        aria-hidden="true"
                      />

                      <span className="datechip">
                        <span className="datechip__day">{holiday.isoDate.slice(8)}</span>
                        <span className="datechip__month">{shortMonth(holiday.isoDate)}</span>
                      </span>

                      <div className="holrow__main">
                        <div className="holrow__name">
                          {holiday.name}
                          {isToday && <span className="pill pill--resolved">Today</span>}
                        </div>
                        <div className="holrow__meta">
                          {weekday(holiday.isoDate)} · {holiday.region}
                        </div>
                      </div>

                      <span className={`kindpill kindpill--${holiday.kind.toLowerCase()}`}>
                        {holiday.kind === 'OPTIONAL' ? 'Optional' : 'Fixed'}
                      </span>

                      {editable && !settled && (
                        <span className="holrow__acts">
                          {confirmRemove === key ? (
                            <>
                              {/* Spelled out rather than a second icon. Two icon buttons
                                  side by side, one of which deletes, is a coin toss. */}
                              <button
                                className="holrow__confirm holrow__confirm--go"
                                onClick={() => remove(holiday)}
                                disabled={busy}
                              >
                                Remove
                              </button>
                              <button
                                className="holrow__confirm"
                                onClick={() => setConfirmRemove(null)}
                              >
                                Keep
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="iconbtn"
                                aria-label={`Edit ${holiday.name}`}
                                onClick={() => {
                                  setProblem(null)
                                  setConfirmRemove(null)
                                  setEditing({ draft: { ...holiday }, original: holiday })
                                }}
                              >
                                <PencilIcon />
                              </button>
                              <button
                                className="iconbtn iconbtn--danger"
                                aria-label={`Remove ${holiday.name}`}
                                onClick={() => setConfirmRemove(key)}
                              >
                                <TrashIcon />
                              </button>
                            </>
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
      </div>

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
    <aside className="card holpanel">
      <header className="holpanel__head">
        <span className="holpanel__mark">
          <CalendarIcon />
        </span>
        <div className="holpanel__title">{isNew ? 'Add new holiday' : 'Edit holiday'}</div>
        <button className="holpanel__close" onClick={onCancel} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <label className="holfield">
        <span className="holfield__label">Name</span>
        <input
          className="search"
          value={draft.name}
          placeholder="Enter holiday name"
          onChange={(event) => set({ name: event.target.value })}
        />
      </label>

      <label className="holfield">
        <span className="holfield__label">Date</span>
        <input
          className="search"
          type="date"
          value={draft.isoDate}
          onChange={(event) => set({ isoDate: event.target.value })}
        />
      </label>

      <label className="holfield">
        <span className="holfield__label">Region</span>
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
      </label>

      <label className="holfield">
        <span className="holfield__label">Kind</span>
        <select
          className="search"
          value={draft.kind}
          onChange={(event) => set({ kind: event.target.value as HolidayKind })}
        >
          <option value="FIXED">Fixed — everyone gets it</option>
          <option value="OPTIONAL">Optional — employees choose</option>
        </select>
      </label>

      {/*
        What the choice above actually does, said where the choice is made.

        Fixed and Optional are not two labels for the same thing — one is a day off
        everybody gets and the other is a day somebody has to spend a choice on — and
        the difference is invisible from the words alone.
      */}
      <div className="holnote">
        <InfoIcon />
        {draft.kind === 'FIXED'
          ? 'Fixed holidays are marked for all employees automatically.'
          : 'Optional holidays are offered to employees, who pick from them.'}
      </div>

      <button className="button holpanel__save" disabled={saving} onClick={onSave}>
        {isNew ? 'Add holiday' : 'Save changes'}
      </button>
      <button className="holpanel__cancel" onClick={onCancel}>
        Cancel
      </button>
    </aside>
  )
}

// ------------------------------------------------------------------ the glyphs

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function PalmIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 21V10.5" />
      <path d="M12 10.5C9.6 8.3 6.6 8 4.4 9.8M12 10.5c2.4-2.2 5.4-2.5 7.6-.7" />
      <path d="M12 10.5C11 7.4 8.7 5.4 6 5.2M12 10.5c1-3.1 3.3-5.1 6-5.3" />
      <circle cx="12" cy="10.2" r="1.1" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 13.8V21" />
      <path d="M8.2 3.6h7.6l-1 5.2 2.4 2.2a1 1 0 01-.7 1.8H7.5a1 1 0 01-.7-1.8l2.4-2.2z" />
    </svg>
  )
}

function BalloonIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 15.6c2.9 0 5.2-2.9 5.2-6.3S14.9 3 12 3 6.8 5.9 6.8 9.3s2.3 6.3 5.2 6.3z" />
      <path d="M10.8 15.4l1.2 1.8 1.2-1.8" />
      <path d="M12 17.2c0 1.5 1.6 1.5 1.6 3" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <rect x="3.6" y="5.4" width="16.8" height="15" rx="2.4" />
      <path d="M3.6 10h16.8M8.4 3.4v4M15.6 3.4v4" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg className="regionpick__glyph" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.6c2.1 2.3 3.2 5.3 3.2 8.4s-1.1 6.1-3.2 8.4c-2.1-2.3-3.2-5.3-3.2-8.4S9.9 5.9 12 3.6z" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg className="regionpick__chev" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 5.8v12.4M5.8 12h12.4" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M4.5 19.5l.9-3.6L15.3 6a1.8 1.8 0 012.5 0l.6.6a1.8 1.8 0 010 2.5L8.5 18.9z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M5.5 7h13M10 7V5.6a1 1 0 011-1h2a1 1 0 011 1V7" />
      <path d="M7 7l.8 11.4a1.6 1.6 0 001.6 1.5h5.2a1.6 1.6 0 001.6-1.5L17 7" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg className="holnote__glyph" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11.2v5M12 8.1v.1" />
    </svg>
  )
}

/*
 * The pale drawings in the corner of each card.
 *
 * Decoration, and kept faint enough to read as texture rather than content — they are
 * behind the number, and a number is the one thing on those cards that must not be
 * competed with.
 */
function CalendarWatermark() {
  return (
    <svg className="holstat__art" viewBox="0 0 64 64" {...S} strokeWidth={2} aria-hidden="true">
      <rect x="8" y="14" width="48" height="42" rx="6" />
      <path d="M8 26h48M22 8v12M42 8v12" />
      <path d="M20 38h8M36 38h8M20 48h8" />
    </svg>
  )
}

function DocWatermark() {
  return (
    <svg className="holstat__art" viewBox="0 0 64 64" {...S} strokeWidth={2} aria-hidden="true">
      <path d="M16 6h20l14 14v38a4 4 0 01-4 4H16a4 4 0 01-4-4V10a4 4 0 014-4z" />
      <path d="M36 6v14h14" />
      <path d="M20 34h24M20 44h16" />
    </svg>
  )
}

function PeopleWatermark() {
  return (
    <svg className="holstat__art" viewBox="0 0 64 64" {...S} strokeWidth={2} aria-hidden="true">
      <circle cx="24" cy="22" r="9" />
      <path d="M8 52a16 16 0 0132 0" />
      <circle cx="44" cy="26" r="7" />
      <path d="M40 52a13 13 0 0120-11" />
    </svg>
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
