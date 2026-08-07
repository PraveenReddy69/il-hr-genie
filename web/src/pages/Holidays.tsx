import { useEffect, useMemo, useState } from 'react'
import { Card, Empty, Loading } from '../components/Bits'
import { fetchHolidays } from '../api/client'
import { holidayYears } from '../api/holidays'
import { isoDate } from '../api/mock'
import type { Holiday } from '../api/types'

export function Holidays() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [holidays, setHolidays] = useState<Holiday[] | null>(null)

  useEffect(() => {
    setHolidays(null)
    fetchHolidays(year).then(setHolidays)
  }, [year])

  const today = isoDate()
  // Only years the calendar actually covers — offering a neighbouring year that
  // leads to an empty page is a dead end, not a choice.
  const years = holidayYears()

  const { upcoming, next, byMonth, fixed, optional } = useMemo(() => {
    const list = holidays ?? []
    const ahead = list.filter((holiday) => holiday.isoDate >= today)
    const grouped = new Map<string, Holiday[]>()
    list.forEach((holiday) => {
      const month = holiday.isoDate.slice(0, 7)
      grouped.set(month, [...(grouped.get(month) ?? []), holiday])
    })
    return {
      upcoming: ahead.length,
      next: ahead[0] ?? null,
      byMonth: [...grouped.entries()],
      fixed: list.filter((holiday) => holiday.kind === 'FIXED').length,
      optional: list.filter((holiday) => holiday.kind === 'OPTIONAL').length,
    }
  }, [holidays, today])

  if (!holidays) return <Loading />

  return (
    <>
      <div className="page-head">
        <h1>Holiday calendar</h1>
        <p>
          {holidays.length} published for {year} · {upcoming} still ahead
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
              onClick={() => setYear(option)}
            >
              {option}
            </button>
          ))}
        </div>

        {holidays.length === 0 ? (
          <Empty style={{ marginTop: 14 }}>
            No calendar published for {year} yet.
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
                  const past = holiday.isoDate < today
                  const isToday = holiday.isoDate === today
                  return (
                    <div className="row" key={holiday.isoDate} style={{ opacity: past ? 0.45 : 1 }}>
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
