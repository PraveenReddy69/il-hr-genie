import { useEffect, useMemo, useState } from 'react'
import { Avatar, Empty, Loading } from '../components/Bits'
import { fetchCelebrations, fetchEmployees } from '../api/client'
import { isoDate } from '../api/mock'
import {
  EMPTY_CELEBRATIONS,
  KIND_LABEL,
  LOOKAHEAD_DAYS,
  NEW_JOINER_DAYS,
  inViewerScope,
  totalToday,
  upcoming,
  wishHref,
  withDepartments,
  type CelebrationKind,
  type Celebrant,
  type Celebrations as TodaysCelebrations,
  type UpcomingEntry,
} from '../api/celebrations'
import type { Employee } from '../api/types'

/**
 * Birthdays, work anniversaries and new joiners.
 *
 * Today comes from the one endpoint that knows; the month ahead is computed from the
 * directory's joining dates. That split is why the two halves of this page hold
 * different kinds — see src/api/celebrations.ts — and the page says so rather than
 * letting somebody assume the month ahead is complete.
 */
export function Celebrations({ viewer }: { viewer: Employee }) {
  const today = isoDate()
  const [todays, setTodays] = useState<TodaysCelebrations | null>(null)
  const [people, setPeople] = useState<Employee[] | null>(null)

  useEffect(() => {
    // A failed celebrations call is an empty day, not a broken page: the month ahead
    // comes from the directory and renders either way.
    fetchCelebrations()
      .then(setTodays)
      .catch(() => setTodays(EMPTY_CELEBRATIONS))
    fetchEmployees()
      .then(setPeople)
      .catch(() => setPeople([]))
  }, [])

  const scoped = useMemo(() => {
    if (!todays || !people) return null
    const fill = (rows: Celebrant[]) => inViewerScope(withDepartments(rows, people), viewer)
    return {
      birthdays: fill(todays.birthdays),
      anniversaries: fill(todays.anniversaries),
      newJoiners: fill(todays.newJoiners),
    }
  }, [todays, people, viewer])

  /*
   * Two lists, because they point in opposite directions.
   *
   * `upcoming` returns both, and a joiner's `inDays` is negative on purpose: somebody
   * who started three weeks ago started three weeks ago. Both were being drawn under
   * one heading reading "in the next 30 days", so the card was mostly people who had
   * already arrived, each labelled "30d ago" directly underneath a promise about the
   * future.
   *
   * Splitting them is the whole fix. A new joiner is still worth showing — it is the
   * list you check before saying hello to somebody in the lift — it just is not
   * something coming up.
   */
  const { ahead, arrived } = useMemo(() => {
    if (!people) return { ahead: [], arrived: [] }
    // Scoped on the person's department, then dropped for today — today has its own
    // section above, and a name in both reads as two separate events.
    const rows = inViewerScope(
      upcoming(people, today).map((entry) => ({ ...entry, department: entry.person.department })),
      viewer,
    ).filter((entry) => entry.inDays !== 0)
    return {
      ahead: rows.filter((entry) => entry.inDays > 0),
      // Most recent arrival first: "who joined lately" is read from the top down.
      arrived: rows
        .filter((entry) => entry.inDays < 0)
        .sort((a, b) => b.inDays - a.inDays),
    }
  }, [people, today, viewer])

  if (!scoped || !people) return <Loading />

  const count = totalToday(scoped)

  return (
    <>
      <header className="celebhead">
        <span className="celebhead__mark">
          <PartyIcon />
        </span>
        <div>
          <h1>Celebrations</h1>
          <p>
            {count === 0
              ? 'Nothing today'
              : `${count} ${count === 1 ? 'person' : 'people'} to congratulate today`}
            {ahead.length > 0 && (
              <>
                {' · '}
                <strong>
                  {ahead.length} in the next {LOOKAHEAD_DAYS} days
                </strong>
              </>
            )}
            {arrived.length > 0 && ` · ${arrived.length} just joined`}
          </p>
        </div>
        {/* Drawn, not an image: a handful of positioned shapes costs nothing and scales
            with the header, where a PNG of confetti would not. */}
        <Confetti />
      </header>

      {/* ------------------------------------------------------------ today */}

      <section className="card">
        <div className="todayband">
          <span className="todayband__icon">
            <CalendarIcon />
          </span>
          <div>
            <div className="todayband__title">Today</div>
            <div className="todayband__date">
              {new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
          </div>
          <GiftIcon />
        </div>

        {count === 0 ? (
          <Empty>
            Nobody is celebrating today. The next one is
            {ahead.length > 0
              ? ` ${ahead[0].person.name}, in ${ahead[0].inDays} ${ahead[0].inDays === 1 ? 'day' : 'days'}.`
              : ' further out than a month.'}
          </Empty>
        ) : (
          <>
            <Group kind="BIRTHDAY" people={scoped.birthdays} viewer={viewer} />
            <Group kind="ANNIVERSARY" people={scoped.anniversaries} viewer={viewer} />
            <Group kind="JOINER" people={scoped.newJoiners} viewer={viewer} />
          </>
        )}
      </section>

      {/* -------------------------------------------------------- coming up */}

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <span className="card__chip" style={{ background: 'var(--blue-tint-12)' }}>
            📅
          </span>
          <div>
            <div className="card__title">Coming up</div>
            <div className="card__subtitle">
              Work anniversaries in the next {LOOKAHEAD_DAYS} days
            </div>
          </div>
        </div>

        {ahead.length === 0 ? (
          <Empty>No anniversaries in the next {LOOKAHEAD_DAYS} days.</Empty>
        ) : (
          ahead.map((entry) => <AheadRow key={`${entry.kind}-${entry.person.employeeId}`} entry={entry} />)
        )}

        {/*
          The gap, named on the page rather than left to be discovered.

          Birthdays cannot appear in this list: the directory carries no date of birth,
          and the endpoint answers only for today. Somebody planning a week ahead needs
          to know that what they are looking at is two thirds of the picture.
        */}
        <p className="note" style={{ textAlign: 'left', marginTop: 14 }}>
          Birthdays are not in this list. The directory holds no date of birth, so they
          can only be known on the day — see <code>docs/CELEBRATIONS_BACKEND.md</code>.
        </p>
      </section>

      {/* --------------------------------------------------- recently arrived */}

      {arrived.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card__head">
            <span className="card__chip" style={{ background: 'var(--green-tint-14)' }}>
              <SproutIcon />
            </span>
            <div>
              <div className="card__title">Recently joined</div>
              <div className="card__subtitle">Started in the last {NEW_JOINER_DAYS} days</div>
            </div>
          </div>

          {arrived.map((entry) => (
            <AheadRow key={`${entry.kind}-${entry.person.employeeId}`} entry={entry} />
          ))}
        </section>
      )}
    </>
  )
}

/** One kind, with its heading, or nothing at all when nobody qualifies. */
function Group({
  kind,
  people,
  viewer,
}: {
  kind: CelebrationKind
  people: Celebrant[]
  viewer: Employee
}) {
  if (people.length === 0) return null

  return (
    <>
      <div className="celebgroup">
        <KindIcon kind={kind} />
        {KIND_LABEL[kind]}
        <span className="celebgroup__count">{people.length}</span>
      </div>
      {people.map((person, index) => (
        <PersonRow key={`${kind}-${person.employeeId || person.name}`} person={person} index={index} kind={kind} viewer={viewer} />
      ))}
    </>
  )
}

function PersonRow({
  person,
  index,
  kind,
  viewer,
}: {
  person: Celebrant
  index: number
  kind: CelebrationKind
  viewer: Employee
}) {
  const href = wishHref(person)
  const isSelf = person.employeeId === viewer.employeeId

  return (
    <div className="row">
      <Avatar name={person.name} index={index} />
      <div className="row__main">
        <div className="row__title">
          {person.name}
          {kind === 'ANNIVERSARY' && person.years !== undefined && (
            <span className="tag tag--dept" style={{ marginLeft: 8 }}>
              {person.years} {person.years === 1 ? 'year' : 'years'}
            </span>
          )}
        </div>
        <div className="row__meta">
          {[person.designation, person.department].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      {/*
        No address, no button.

        The endpoint sends no email yet, so this is the common case rather than the
        edge one. A button that opened an empty chat — or worse, one addressed to
        whoever happened to be nearest in the directory — is not better than nothing.
      */}
      <span className="kindchip" aria-hidden="true">
        <KindIcon kind={kind} />
      </span>

      {href && !isSelf ? (
        <a href={href} target="_blank" rel="noreferrer" className="wish">
          Wish them
          <ChevronIcon />
        </a>
      ) : (
        <span className="row__meta" style={{ flex: 'none' }}>
          {isSelf ? 'That is you' : 'No work address'}
        </span>
      )}
    </div>
  )
}

function AheadRow({ entry }: { entry: UpcomingEntry }) {
  const date = new Date(`${entry.isoDate}T00:00:00`)

  return (
    <div className="row">
      <span className="datechip">
        <span className="datechip__day">{entry.isoDate.slice(8)}</span>
        <span className="datechip__month">
          {date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
        </span>
      </span>

      <div className="row__main">
        <div className="row__title">{entry.person.name}</div>
        <div className="row__meta">
          {KIND_LABEL[entry.kind]}
          {entry.kind === 'ANNIVERSARY' && entry.person.years !== undefined && (
            <> · {entry.person.years} years</>
          )}
          {entry.person.department && <> · {entry.person.department}</>}
        </div>
      </div>

      <span
        className={`pill ${entry.kind === 'JOINER' ? 'pill--neutral' : 'pill--optional'}`}
        style={{ flex: 'none' }}
      >
        {/* A joiner's date has already been and gone; an anniversary is ahead. */}
        {entry.inDays < 0
          ? `${-entry.inDays}d ago`
          : entry.inDays === 1
            ? 'tomorrow'
            : `in ${entry.inDays}d`}
      </span>
    </div>
  )
}

/*
 * The glyphs.
 *
 * Drawn here rather than pulled from the shared icon set: these three say *which kind
 * of thing is being celebrated*, and that vocabulary exists nowhere else in the
 * console. Stroked at 1.6 so they hold at the 14px they are mostly used at.
 */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function KindIcon({ kind }: { kind: CelebrationKind }) {
  if (kind === 'BIRTHDAY') return <CakeIcon />
  if (kind === 'ANNIVERSARY') return <MedalIcon />
  return <SproutIcon />
}

/** The page's own mark: a popper, which is the one shape that means all three kinds. */
function PartyIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M3.2 20.8l4.4-11.6 7.2 7.2z" />
      <path d="M7.6 9.2a4 4 0 015.6 0 4 4 0 001.9 1l1.7.4" />
      <path d="M17.5 4.2v1.6M20.6 7.4h-1.6M19.9 4.9l-1.1 1.1" />
      <path d="M13.4 4.6l.5 1M20.3 12.2l-1 -.5" />
    </svg>
  )
}

function CakeIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M4 20.5h16v-5a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
      <path d="M4 16.5c1.6 1.2 3.2 1.2 4.8 0s3.2-1.2 4.8 0 3.2 1.2 4.8 0" />
      <path d="M12 10.5V8M12 5.6a1 1 0 00-1.2 1.1c.1.7.6 1.3 1.2 1.3s1.1-.6 1.2-1.3A1 1 0 0012 5.6z" />
    </svg>
  )
}

function MedalIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="12" cy="14.5" r="5" />
      <path d="M12 12.6l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" />
      <path d="M8.6 9.4L6.4 3.5M15.4 9.4l2.2-5.9" />
    </svg>
  )
}

function SproutIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 20.5v-7" />
      <path d="M12 13.5C12 10.7 9.8 8.5 7 8.5c0 2.8 2.2 5 5 5z" />
      <path d="M12 13.5c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.4" />
      <path d="M3.5 10h17M8.5 3.5v4M15.5 3.5v4" />
    </svg>
  )
}

function GiftIcon() {
  return (
    <svg className="todayband__gift" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <rect x="3.5" y="10.5" width="17" height="10" rx="1.8" />
      <path d="M2.5 7.5h19v3h-19zM12 7.5v13" />
      <path d="M12 7.5S10.8 3.5 8.6 3.5a2 2 0 100 4zM12 7.5s1.2-4 3.4-4a2 2 0 110 4z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} className="wish__chev" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

/** Eight shapes, fixed rather than random, so the header does not reshuffle on render. */
function Confetti() {
  const bits = [
    { x: 4, y: 18, r: 18, c: '#f0a500' },
    { x: 16, y: 62, r: -12, c: '#2b8cff' },
    { x: 27, y: 12, r: 40, c: '#42c07a' },
    { x: 39, y: 48, r: 8, c: '#f2683c' },
    { x: 52, y: 22, r: -30, c: '#7a5af8' },
    { x: 66, y: 66, r: 24, c: '#2b8cff' },
    { x: 78, y: 30, r: -16, c: '#f0a500' },
    { x: 92, y: 54, r: 34, c: '#42c07a' },
  ]
  return (
    <span className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            background: b.c,
            transform: `rotate(${b.r}deg)`,
          }}
        />
      ))}
    </span>
  )
}
