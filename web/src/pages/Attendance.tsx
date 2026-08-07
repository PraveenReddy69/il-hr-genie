import { useEffect, useMemo, useState } from 'react'
import { Avatar, Card, Empty, Loading, formatHours } from '../components/Bits'
import { Drawer } from '../components/Drawer'
import { fetchAttendanceWeek } from '../api/client'
import { weekDates, weekStart } from '../api/mock'
import {
  ATTENDANCE_CODE,
  ATTENDANCE_LABEL,
  FULL_WEEK_MILLIS,
  type AttendanceDay,
  type AttendanceStatus,
  type EmployeeWeek,
} from '../api/types'

/** Colour per status, reusing the app's reserved palette. */
const TONE: Record<AttendanceStatus, { fg: string; bg: string }> = {
  PRESENT: { fg: 'var(--green-ok)', bg: 'var(--green-tint-14)' },
  HALF_DAY: { fg: 'var(--blue-deep)', bg: 'var(--blue-tint-12)' },
  MIS_PUNCH: { fg: 'var(--orange-warn)', bg: 'var(--orange-tint-14)' },
  ABSENT: { fg: 'var(--red-risk)', bg: 'rgba(229,72,77,.12)' },
  WEEK_OFF: { fg: 'var(--text-muted)', bg: 'var(--ink-05)' },
  HOLIDAY: { fg: 'var(--purple)', bg: 'var(--purple-tint-12)' },
  IN_PROGRESS: { fg: 'var(--blue-deep)', bg: 'var(--blue-tint-12)' },
  PENDING: { fg: 'var(--text-muted)', bg: 'transparent' },
}

/** Only these two are worth chasing; the rest are just what happened. */
const NEEDS_FOLLOW_UP: AttendanceStatus[] = ['MIS_PUNCH', 'ABSENT']

export function Attendance() {
  const [offset, setOffset] = useState(0)
  const [weeks, setWeeks] = useState<EmployeeWeek[] | null>(null)
  const [open, setOpen] = useState<{ week: EmployeeWeek; day: AttendanceDay } | null>(null)

  const monday = weekStart(offset)
  const dates = useMemo(() => weekDates(monday), [monday])

  useEffect(() => {
    setWeeks(null)
    fetchAttendanceWeek(monday).then(setWeeks)
  }, [monday])

  const totals = useMemo(() => {
    const all = (weeks ?? []).flatMap((week) => week.days)
    const count = (status: AttendanceStatus) =>
      all.filter((day) => day.status === status).length
    return {
      present: count('PRESENT'),
      half: count('HALF_DAY'),
      missed: count('MIS_PUNCH'),
      absent: count('ABSENT'),
      hours: (weeks ?? []).reduce((sum, week) => sum + week.totalMillis, 0),
    }
  }, [weeks])

  if (!weeks) return <Loading />

  const flagged = weeks.flatMap((week) =>
    week.days
      .filter((day) => NEEDS_FOLLOW_UP.includes(day.status))
      .map((day) => ({ week, day })),
  )

  return (
    <>
      <div className="page-head">
        <h1>Attendance</h1>
        <p>
          {rangeLabel(dates)} · {formatHours(totals.hours)} logged across{' '}
          {weeks.length} people
        </p>
      </div>

      <section className="card">
        <div className="chips">
          <button className="chip" onClick={() => setOffset(offset - 1)}>
            ‹ Previous
          </button>
          <button
            className={`chip ${offset === 0 ? 'chip--on' : ''}`}
            onClick={() => setOffset(0)}
          >
            This week
          </button>
          <button
            className="chip"
            onClick={() => setOffset(offset + 1)}
            disabled={offset >= 0}
            style={{ opacity: offset >= 0 ? 0.4 : 1 }}
          >
            Next ›
          </button>
        </div>

        <div className="sheet" style={{ marginTop: 16 }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th className="grid-table__name">Employee</th>
                {dates.map((date) => (
                  <th key={date}>
                    <div>{weekdayInitial(date)}</div>
                    <div className="grid-table__date">{date.slice(8)}</div>
                  </th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, index) => (
                <tr key={week.employeeId}>
                  <td className="grid-table__name">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={week.name} index={index} />
                      <div style={{ minWidth: 0 }}>
                        <div className="row__title">{week.name}</div>
                        <div className="row__meta">{week.department}</div>
                      </div>
                    </div>
                  </td>

                  {week.days.map((day) => (
                    <td key={day.dateIso}>
                      <button
                        className="daycell"
                        title={`${ATTENDANCE_LABEL[day.status]} · ${day.dateIso}`}
                        style={{
                          color: TONE[day.status].fg,
                          background: TONE[day.status].bg,
                        }}
                        onClick={() => setOpen({ week, day })}
                      >
                        {ATTENDANCE_CODE[day.status]}
                      </button>
                    </td>
                  ))}

                  <td>
                    <strong
                      style={{
                        color:
                          week.totalMillis >= FULL_WEEK_MILLIS
                            ? 'var(--green-ok)'
                            : 'var(--text-slate)',
                      }}
                    >
                      {formatHours(week.totalMillis)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="legend-row">
          {(Object.keys(ATTENDANCE_CODE) as AttendanceStatus[]).map((status) => (
            <span className="legend-row__item" key={status}>
              <span
                className="legend-row__code"
                style={{ color: TONE[status].fg, background: TONE[status].bg }}
              >
                {ATTENDANCE_CODE[status]}
              </span>
              {ATTENDANCE_LABEL[status]}
            </span>
          ))}
        </div>
      </section>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card chip="⏱️" chipColour="var(--green-tint-14)" title="This week">
          {(
            [
              ['Full days', totals.present, 'var(--green-ok)'],
              ['Half days', totals.half, 'var(--blue-primary)'],
              ['Missed punches', totals.missed, 'var(--orange-warn)'],
              ['Absences', totals.absent, 'var(--red-risk)'],
            ] as const
          ).map(([label, value, colour]) => (
            <div className="row" key={label}>
              <span className="option__dot" style={{ background: colour }} />
              <span className="row__main" style={{ color: 'var(--text-secondary)' }}>
                {label}
              </span>
              <strong>{value}</strong>
            </div>
          ))}
        </Card>

        <Card
          chip="⚠️"
          chipColour="var(--orange-tint-14)"
          title="To follow up"
          subtitle={
            flagged.length === 0
              ? 'Nothing outstanding this week'
              : `${flagged.length} day${flagged.length === 1 ? '' : 's'} to chase`
          }
        >
          {flagged.length === 0 ? (
            <Empty>Every day this week is accounted for.</Empty>
          ) : (
            flagged.map(({ week, day }) => (
              <div
                className="row"
                key={`${week.employeeId}-${day.dateIso}`}
                onClick={() => setOpen({ week, day })}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setOpen({ week, day })
                }}
                style={{ cursor: 'pointer' }}
              >
                <span
                  className="accent"
                  style={{ background: TONE[day.status].fg }}
                />
                <div className="row__main">
                  <div className="row__title">{week.name}</div>
                  <div className="row__meta">{longDate(day.dateIso)}</div>
                </div>
                <span
                  className="pill"
                  style={{ color: TONE[day.status].fg, background: TONE[day.status].bg }}
                >
                  {ATTENDANCE_LABEL[day.status]}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <p className="note">
        A shift left open past midnight is a missed punch, not an endless day. Full day
        is eight hours; anything short of it and checked out is a half day.
      </p>

      {open && (
        <Drawer
          title={open.week.name}
          subtitle={longDate(open.day.dateIso)}
          onClose={() => setOpen(null)}
        >
          <div style={{ marginTop: 18 }}>
            <span
              className="pill"
              style={{
                color: TONE[open.day.status].fg,
                background: TONE[open.day.status].bg,
              }}
            >
              {ATTENDANCE_LABEL[open.day.status]}
            </span>
          </div>

          {open.day.holidayName && (
            <div className="banner" style={{ background: 'var(--purple-tint-12)' }}>
              <div className="banner__title" style={{ color: 'var(--purple)' }}>
                🌴 {open.day.holidayName}
              </div>
            </div>
          )}

          <div className="grid grid--2" style={{ marginTop: 20 }}>
            <Punch label="Checked in" millis={open.day.checkInMillis} />
            <Punch label="Checked out" millis={open.day.checkOutMillis} />
          </div>

          <div className="drawer__label">Worked</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {open.day.status === 'MIS_PUNCH' ? '—' : formatHours(open.day.workedMillis)}
          </div>

          {open.day.status === 'MIS_PUNCH' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.6 }}>
              They checked in but never checked out, and the day has ended. Nothing is
              counted for it — the employee can raise a regularisation from the app.
            </p>
          )}

          <div className="drawer__label">This week</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {formatHours(open.week.totalMillis)}{' '}
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
              of {formatHours(FULL_WEEK_MILLIS)}
            </span>
          </div>
        </Drawer>
      )}
    </>
  )
}

function Punch({ label, millis }: { label: string; millis: number | null }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 3, fontWeight: 600 }}>
        {millis === null
          ? '—'
          : new Date(millis).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
      </div>
    </div>
  )
}

function weekdayInitial(isoDateValue: string): string {
  return new Date(`${isoDateValue}T00:00:00`)
    .toLocaleDateString(undefined, { weekday: 'short' })
    .slice(0, 1)
}

function longDate(isoDateValue: string): string {
  return new Date(`${isoDateValue}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function rangeLabel(dates: string[]): string {
  const start = new Date(`${dates[0]}T00:00:00`)
  const end = new Date(`${dates[dates.length - 1]}T00:00:00`)
  const startLabel = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const endLabel = end.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${startLabel} – ${endLabel}`
}
