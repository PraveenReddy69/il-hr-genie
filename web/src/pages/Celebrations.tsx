import { useEffect, useMemo, useState } from 'react'
import { Avatar, Empty, Loading } from '../components/Bits'
import { fetchCelebrations, fetchEmployees } from '../api/client'
import { isoDate } from '../api/mock'
import {
  EMPTY_CELEBRATIONS,
  KIND_LABEL,
  LOOKAHEAD_DAYS,
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

  const ahead = useMemo(() => {
    if (!people) return []
    // Scoped on the person's department, then dropped for today — today has its own
    // section above, and a name in both reads as two separate events.
    return inViewerScope(
      upcoming(people, today).map((entry) => ({ ...entry, department: entry.person.department })),
      viewer,
    ).filter((entry) => entry.inDays !== 0)
  }, [people, today, viewer])

  if (!scoped || !people) return <Loading />

  const count = totalToday(scoped)

  return (
    <>
      <div className="page-head">
        <h1>Celebrations</h1>
        <p>
          {count === 0
            ? 'Nothing today'
            : `${count} ${count === 1 ? 'person' : 'people'} to congratulate today`}
          {ahead.length > 0 && ` · ${ahead.length} in the next ${LOOKAHEAD_DAYS} days`}
        </p>
      </div>

      {/* ------------------------------------------------------------ today */}

      <section className="card">
        <div className="card__head">
          <span className="card__chip" style={{ background: 'var(--purple-tint-12)' }}>
            🎉
          </span>
          <div>
            <div className="card__title">Today</div>
            <div className="card__subtitle">
              {new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
          </div>
        </div>

        {count === 0 ? (
          <Empty>
            Nobody is celebrating today. The next one is
            {ahead.length > 0 ? ` ${ahead[0].person.name}, in ${ahead[0].inDays} days.` : ' further out than a month.'}
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
              Anniversaries and joiners in the next {LOOKAHEAD_DAYS} days
            </div>
          </div>
        </div>

        {ahead.length === 0 ? (
          <Empty>Nothing in the next {LOOKAHEAD_DAYS} days.</Empty>
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
      <div className="qgroup">
        {KIND_LABEL[kind]}
        <span className="qgroup__count">{people.length}</span>
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
      {href && !isSelf ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="chip"
          style={{ textDecoration: 'none', flex: 'none' }}
        >
          Wish them
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
