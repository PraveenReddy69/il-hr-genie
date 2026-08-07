import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Empty, Loading, formatHours } from '../components/Bits'
import { PeopleDrawer } from '../components/Drawer'
import { fetchAttendanceDetail, fetchMoodDetail, fetchPulseDetail, fetchStats } from '../api/client'
import { isoDate, currentCycle } from '../api/mock'
import {
  MIN_COHORT,
  MOODS,
  MOOD_KEYS,
  type HrStats,
  type PersonEntry,
} from '../api/types'

type DrillDown = { title: string; subtitle: string; entries: PersonEntry[] }

/** How often the dashboard re-reads the figures while it is open. */
const REFRESH_MS = 60_000

export function Dashboard({ hrName }: { hrName: string }) {
  const [stats, setStats] = useState<HrStats | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [drill, setDrill] = useState<DrillDown | null>(null)

  /**
   * Keeps the figures current.
   *
   * These change on other people's devices — someone checks in, shares a mood, raises
   * a ticket — so a dashboard fetched once at mount goes quietly stale. That is how a
   * tile could read "1 checked in" while its own drill-down listed two people: the
   * tile was from page load, the drawer fetched on click.
   *
   * Refetched on a timer and whenever the tab is brought back to the front, which is
   * when someone is actually looking at it.
   */
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchStats()
        .then((fresh) => {
          if (cancelled) return
          setStats(fresh)
          setLoadFailed(false)
        })
        .catch(() => {
          // A failed refresh keeps whatever is already on screen — stale figures beat
          // blank ones. But a failed *first* load has nothing to keep, and silently
          // sitting on the skeleton forever tells the reader nothing.
          if (!cancelled) setLoadFailed(true)
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

  /**
   * Opens a drawer, or says why it could not.
   *
   * A rejected fetch used to leave the handler without ever calling setDrill, so the
   * tile simply did nothing — indistinguishable from a dead control. Now the drawer
   * always opens and reports the failure.
   */
  async function drillInto(
    title: string,
    load: () => Promise<{ subtitle: string; entries: PersonEntry[] }>,
  ) {
    try {
      const { subtitle, entries } = await load()
      setDrill({ title, subtitle, entries })
    } catch {
      setDrill({
        title,
        subtitle: 'Could not reach HR Genie — this list could not be loaded.',
        entries: [],
      })
    }
  }

  function openMood() {
    return drillInto('Who shared a mood', async () => {
      const entries = await fetchMoodDetail(isoDate())
      const shared = entries.filter((entry) => entry.tone !== 'MUTED').length
      return {
        subtitle: `${shared} of ${stats?.headcount ?? entries.length} employees shared today`,
        entries,
      }
    })
  }

  function openAttendance() {
    return drillInto('Who checked in today', async () => {
      const entries = await fetchAttendanceDetail(isoDate())
      const onTheClock = entries.filter((entry) => entry.tone === 'POSITIVE').length
      return {
        subtitle: `${entries.length} checked in · ${onTheClock} still on the clock`,
        entries,
      }
    })
  }

  function openPulse() {
    return drillInto('Monthly pulse', async () => {
      const entries = await fetchPulseDetail(currentCycle())
      const done = entries.filter((entry) => entry.tone === 'POSITIVE').length
      return {
        subtitle: `${done} of ${stats?.headcount ?? entries.length} employees answered · click a name for their answers`,
        entries,
      }
    })
  }

  if (!stats && loadFailed) {
    return (
      <>
        <div className="page-head">
          <h1>Dashboard</h1>
          <p>Couldn&apos;t load the figures</p>
        </div>
        <section className="card">
          <Empty>
            HR Genie is not reachable right now, so nothing can be shown. This retries
            on its own every minute — or reload the page.
          </Empty>
        </section>
      </>
    )
  }

  if (!stats) {
    return (
      <div className="grid" style={{ gap: 16 }}>
        <Loading />
        <Loading />
      </div>
    )
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const pulseRate = stats.headcount === 0 ? 0 : Math.round((stats.pulseCompleted * 100) / stats.headcount)

  return (
    <>
      <section className="hero">
        <span className="hero__badge">
          <span className={`hero__dot ${loadFailed ? 'hero__dot--stale' : ''}`} />
          {loadFailed ? 'Reconnecting…' : 'Live'}
        </span>
        <h2>Welcome back, {hrName.split(' ')[0]}</h2>
        <div className="hero__sub">{today}</div>

        <div className="kpis">
          <button className="kpi" onClick={openMood}>
            <div className="kpi__value">
              {stats.engagementScore === null ? '0' : stats.engagementScore.toFixed(1)}
              <small>/10</small>
            </div>
            <div className="kpi__label">Engagement score</div>
            <div
              className="kpi__foot"
              style={{
                color: stats.engagementScore === null ? 'rgba(255,255,255,.45)' : '#5be08f',
              }}
            >
              {stats.moodResponsesToday === 0
                ? 'No check-ins yet today'
                : `from ${stats.moodResponsesToday} check-in${stats.moodResponsesToday === 1 ? '' : 's'} today`}
            </div>
          </button>

          <button className="kpi" onClick={openPulse}>
            <div className="kpi__value">
              {pulseRate}
              <small>%</small>
            </div>
            <div className="kpi__label">Pulse completion</div>
            <div className="kpi__foot" style={{ color: 'rgba(255,255,255,.62)' }}>
              {stats.pulseCompleted} of {stats.headcount} employees answered
            </div>
          </button>
        </div>
      </section>

      <div className="grid grid--2">
        <Card chip="🎫" chipColour="var(--orange-tint-14)" title="Tickets"
          subtitle={`${stats.ticketsOpen + stats.ticketsInProgress} still live`}
          action={<Link className="card__action" to="/tickets">Open queue</Link>}>
          <div className="grid grid--3">
            {([
              ['Open', stats.ticketsOpen, 'tile--amber', 'var(--orange-warn)'],
              ['In progress', stats.ticketsInProgress, 'tile--blue', 'var(--blue-deep)'],
              ['Resolved', stats.ticketsResolved, 'tile--green', 'var(--green-ok)'],
            ] as const).map(([label, value, tile, colour]) => (
              <div className={`tile ${tile}`} key={label}>
                <div className="tile__value" style={{ color: colour }}>{value}</div>
                <div className="tile__label">{label}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card chip="🗓️" chipColour="var(--blue-tint-12)" title="Today at a glance">
          <div className="grid grid--3">
            <button className="tile tile--blue" onClick={openAttendance}>
              <div className="tile__value" style={{ color: 'var(--blue-deep)' }}>
                {stats.checkedInToday}
              </div>
              <div className="tile__label">Checked in</div>
              <div className="tile__sub">of {stats.headcount} employees</div>
            </button>
            <button className="tile tile--green" onClick={openAttendance}>
              <div className="tile__value" style={{ color: 'var(--green-ok)' }}>
                {stats.onTheClock}
              </div>
              <div className="tile__label">On the clock</div>
              <div className="tile__sub">still working</div>
            </button>
            <button className="tile tile--purple" onClick={openMood}>
              <div className="tile__value" style={{ color: 'var(--purple)' }}>
                {stats.moodResponsesToday}
              </div>
              <div className="tile__label">Mood shared</div>
              <div className="tile__sub">of {stats.headcount} employees</div>
            </button>
          </div>
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          chip="💜"
          chipColour="var(--purple-tint-12)"
          title="How the team feels today"
          subtitle={
            stats.moodResponsesToday === 0
              ? 'Nobody has checked in yet today'
              : `${stats.moodResponsesToday} of ${stats.headcount} employees shared how they feel`
          }
          action={<button className="card__action" onClick={openMood}>Who</button>}
        >
          {stats.moodResponsesToday === 0 ? (
            <Empty>Figures appear here as people check in.</Empty>
          ) : (
            MOOD_KEYS.filter((key) => stats.moodBreakdown[key] > 0).map((key) => {
              const count = stats.moodBreakdown[key]
              const mood = MOODS[key]
              const share = (count / stats.moodResponsesToday) * 100
              return (
                <div key={key} style={{ marginBottom: 13 }}>
                  <div style={{ display: 'flex', marginBottom: 6 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>
                      {mood.emoji} {mood.label}
                    </span>
                    <strong>{count}</strong>
                  </div>
                  <div className="track">
                    <div
                      className="track__fill"
                      style={{
                        width: `${share}%`,
                        background:
                          mood.value >= 8
                            ? 'var(--green-ok)'
                            : mood.value >= 6
                              ? 'var(--blue-primary)'
                              : 'var(--orange-warn)',
                      }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </Card>

        <Card
          chip="📊"
          chipColour="var(--blue-tint-12)"
          title="Mood by department"
          subtitle="Today's average mood, out of 10"
        >
          {/* Two different silences, and they mean different things: nobody has
              checked in at all, or people have but no department has reached the
              cohort floor. Saying which is what makes the card useful when empty. */}
          {stats.departments.length === 0 && (
            <Empty>
              {stats.moodResponsesToday === 0
                ? 'No check-ins yet today. Department scores appear here as people share how they feel.'
                : `Not enough responses to report by department yet. A score needs at least ${MIN_COHORT} people so that no individual can be identified from it.`}
            </Empty>
          )}
          {stats.departments.map((department) => (
            <div key={department.name} style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', marginBottom: 6 }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{department.name}</span>
                <strong style={{ color: department.score === null ? 'var(--text-muted)' : 'inherit' }}>
                  {department.score !== null
                    ? department.score.toFixed(1)
                    : department.responses === 0
                      ? 'No check-in yet'
                      : `${department.responses} of ${MIN_COHORT} needed`}
                </strong>
              </div>
              <div className="track">
                <div
                  className="track__fill"
                  style={{
                    width: `${((department.score ?? 0) / 10) * 100}%`,
                    background:
                      (department.score ?? 0) >= 7.5
                        ? 'var(--green-ok)'
                        : (department.score ?? 0) >= 6
                          ? 'var(--blue-primary)'
                          : 'var(--orange-warn)',
                  }}
                />
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <Card
          chip="⏱️"
          chipColour="var(--green-tint-14)"
          title="Attendance this week"
          subtitle={`${formatHours(stats.weekHoursMillis)} logged across the team so far`}
        >
          {([
            ['Full days', stats.weekPresent, 'var(--green-ok)'],
            ['Half days', stats.weekHalfDays, 'var(--blue-primary)'],
            ['Missed punches', stats.weekMisPunches, 'var(--orange-warn)'],
            ['Absences', stats.weekAbsences, 'var(--orange-warn)'],
          ] as const).map(([label, value, colour]) => (
            <div className="row" key={label}>
              <span className="option__dot" style={{ background: colour }} />
              <span className="row__main" style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </Card>
      </div>

      <p className="note">
        Individual records, under Infinity Learn&apos;s employee data policy. Written
        check-in notes are not exposed.
      </p>

      {drill && (
        <PeopleDrawer
          title={drill.title}
          subtitle={drill.subtitle}
          entries={drill.entries}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  )
}
