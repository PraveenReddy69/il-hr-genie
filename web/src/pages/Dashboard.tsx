import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Empty, Loading } from '../components/Bits'
import { PeopleDrawer } from '../components/Drawer'
import {
  AnalyticsIcon,
  CelebrationsIcon,
  HolidaysIcon,
  OpenIcon,
  ProgressIcon,
  PulseIcon,
  TickIcon,
  TicketsIcon,
} from '../components/Icons'
import {
  fetchMoodDetail,
  fetchMoodHistory,
  fetchPulseDetail,
  fetchPulseHistory,
  fetchStats,
  fetchTickets,
} from '../api/client'
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
   * The two trend lines behind the headline figures.
   *
   * Loaded separately from the figures themselves and allowed to fail on their own: a
   * sparkline is context, and losing it should not cost anybody the number it sits
   * beside. Empty means the line is simply not drawn.
   */
  const [moodTrend, setMoodTrend] = useState<number[]>([])
  const [pulseTrend, setPulseTrend] = useState<number[]>([])

  /**
   * How many tickets were raised today, counted rather than fetched.
   *
   * `/api/stats` has no figure for it, and the ticket list already carries
   * `createdAtMillis` — so this is counted from the rows this account can see, which
   * also makes it the right number per viewer: an HRBP sees their own people's, an
   * Admin sees the organisation's.
   *
   * null until it is known. Zero and not-yet-counted look identical on a tile and mean
   * very different things on a quiet morning.
   */
  const [raisedToday, setRaisedToday] = useState<number | null>(null)

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

  // The trends move by the day and the cycle, so they are read once rather than on the
  // minute timer above.
  useEffect(() => {
    let cancelled = false

    fetchMoodHistory(14)
      .then((days) => {
        if (cancelled) return
        setMoodTrend(days.map((day) => day.score).filter((s): s is number => s !== null))
      })
      .catch(() => {})

    fetchPulseHistory(6)
      .then((cycles) => {
        if (cancelled) return
        setPulseTrend(
          cycles.map((c) => (c.headcount === 0 ? 0 : (c.completed * 100) / c.headcount)),
        )
      })
      .catch(() => {})

    fetchTickets()
      .then((tickets) => {
        if (cancelled) return
        // Midnight local, because "today" is the reader's day rather than UTC's.
        const midnight = new Date()
        midnight.setHours(0, 0, 0, 0)
        const from = midnight.getTime()
        setRaisedToday(tickets.filter((t) => t.createdAtMillis >= from).length)
      })
      .catch(() => {})

    return () => {
      cancelled = true
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
  const pulseRate =
    stats.headcount === 0 ? 0 : Math.round((stats.pulseCompleted * 100) / stats.headcount)
  const live = stats.ticketsOpen + stats.ticketsInProgress

  return (
    <>
      <header className="dash__head">
        <div>
          <h1 className="dash__hello">
            Welcome back, {hrName.split(' ')[0]} <span aria-hidden="true">👋</span>
          </h1>
          <p className="dash__date">{today}</p>
        </div>

        {/*
          Badged with the live queue, not with a notion of "notifications" this console
          does not have. It is a real number and it goes somewhere real; a bell that
          counts nothing is furniture.
        */}
        <Link
          className="bell"
          to="/tickets"
          title={`${live} ticket${live === 1 ? '' : 's'} still live — open the queue`}
        >
          <BellIcon />
          {live > 0 && <span className="bell__badge">{live > 99 ? '99+' : live}</span>}
        </Link>
      </header>

      <section className="scoreband">
        {/*
          `Live` and `Reconnecting…` sit here rather than in the old badge above: the
          band is the thing whose numbers go stale, so that is where it should say so.
        */}
        <span className={`scoreband__state ${loadFailed ? 'scoreband__state--stale' : ''}`}>
          <span className="scoreband__dot" />
          {loadFailed ? 'Reconnecting…' : 'Live'}
        </span>

        <button className="scoreband__metric" onClick={openMood}>
          <span className="scoreband__icon">
            <AnalyticsIcon />
          </span>
          <span className="scoreband__body">
            <span className="scoreband__value">
              {stats.engagementScore === null ? '—' : stats.engagementScore.toFixed(1)}
              <small>/10</small>
            </span>
            <span className="scoreband__label">Engagement score</span>
            <span
              className={`scoreband__foot ${stats.moodResponsesToday > 0 ? 'scoreband__foot--up' : ''}`}
            >
              {stats.moodResponsesToday === 0
                ? 'No check-ins yet today'
                : `↑ from ${stats.moodResponsesToday} check-in${stats.moodResponsesToday === 1 ? '' : 's'} today`}
            </span>
          </span>
          <Spark values={moodTrend} colour="#6ec5ff" id="mood" />
        </button>

        <span className="scoreband__split" aria-hidden="true" />

        <button className="scoreband__metric" onClick={openPulse}>
          <span className="scoreband__icon scoreband__icon--violet">
            <PulseIcon />
          </span>
          <span className="scoreband__body">
            <span className="scoreband__value">
              {pulseRate}
              <small>%</small>
            </span>
            <span className="scoreband__label">Pulse completion</span>
            <span className="scoreband__foot">
              {stats.pulseCompleted} of {stats.headcount} employees answered
            </span>
          </span>
          <Spark values={pulseTrend} colour="#b39cff" id="pulse" />
        </button>
      </section>

      <div className="grid grid--2">
        <Card
          chip={<TicketsIcon />}
          chipColour="var(--orange-tint-14)"
          title="Tickets"
          subtitle={`${live} still live`}
          action={
            <Link className="card__action" to="/tickets">
              Open queue →
            </Link>
          }
        >
          <div className="metrics">
            <Metric
              label="Open"
              sub="needs attention"
              value={stats.ticketsOpen}
              tone="amber"
              icon={<OpenIcon />}
            />
            <Metric
              label="In progress"
              sub="being worked on"
              value={stats.ticketsInProgress}
              tone="blue"
              icon={<ProgressIcon />}
            />
            <Metric
              label="Resolved"
              sub="no action needed"
              value={stats.ticketsResolved}
              tone="green"
              icon={<TickIcon />}
            />
          </div>
        </Card>

        <Card chip={<HolidaysIcon />} chipColour="var(--blue-tint-12)" title="Today at a glance">
          {/*
            Checked in and On the clock are gone with the Attendance tab — the data
            behind them is not flowing, and two figures reading nought all day say
            nothing except that something is broken.
          */}
          <div className="metrics">
            <Metric
              label="Tickets raised"
              sub="so far today"
              value={raisedToday}
              tone="amber"
              icon={<TicketsIcon />}
            />
            <Metric
              label="Mood shared"
              sub={`of ${stats.headcount} employees`}
              value={stats.moodResponsesToday}
              tone="purple"
              icon={<CelebrationsIcon />}
              onClick={openMood}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          chip={<CelebrationsIcon />}
          chipColour="var(--purple-tint-12)"
          title="How the team feels today"
          subtitle={
            stats.moodResponsesToday === 0
              ? 'Nobody has checked in yet today'
              : `${stats.moodResponsesToday} of ${stats.headcount} employees shared how they feel`
          }
          action={
            <button className="card__action" onClick={openMood}>
              Who →
            </button>
          }
        >
          {stats.moodResponsesToday === 0 ? (
            <Empty>Figures appear here as people check in.</Empty>
          ) : (
            <>
              {MOOD_KEYS.filter((key) => stats.moodBreakdown[key] > 0).map((key) => {
                const count = stats.moodBreakdown[key]
                const mood = MOODS[key]
                const share = (count / stats.moodResponsesToday) * 100
                return (
                  <div key={key} style={{ marginBottom: 13 }}>
                    <div style={{ display: 'flex', marginBottom: 6 }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>
                        {mood.emoji} {mood.label}
                      </span>
                      <strong>
                        {count} ({Math.round(share)}%)
                      </strong>
                    </div>
                    <div className="track">
                      <div
                        className="track__fill"
                        style={{ width: `${share}%`, background: moodColour(mood.value) }}
                      />
                    </div>
                  </div>
                )
              })}

              {/*
                Every mood, including the ones nobody chose. A breakdown that lists only
                what was picked cannot be read as a shape — "Great 1" alone says nothing
                about whether anybody was having a bad day.
              */}
              <div className="feels">
                {MOOD_KEYS.map((key) => {
                  const count = stats.moodBreakdown[key]
                  const share = Math.round((count / stats.moodResponsesToday) * 100)
                  return (
                    <div className={`feel feel--${key.toLowerCase()}`} key={key}>
                      <div className="feel__face">
                        {MOODS[key].emoji} {MOODS[key].label}
                      </div>
                      <div className="feel__count">
                        {count} <small>({share}%)</small>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </Card>

        <Card
          chip={<AnalyticsIcon />}
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
              <div style={{ display: 'flex', marginBottom: 6, gap: 12 }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{department.name}</span>
                <span className="dept__need">
                  {department.score === null &&
                    (department.responses === 0
                      ? 'No check-in yet'
                      : `${department.responses} of ${MIN_COHORT} needed`)}
                </span>
                {department.score !== null && (
                  <strong>
                    {department.score.toFixed(1)}
                    <small className="dept__outof">/10</small>
                  </strong>
                )}
              </div>
              <div className="track">
                <div
                  className="track__fill"
                  style={{
                    width: `${((department.score ?? 0) / 10) * 100}%`,
                    background: moodColour(department.score ?? 0),
                  }}
                />
              </div>
            </div>
          ))}
        </Card>
      </div>

      <p className="note">
        <ShieldIcon />
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

/** One figure in a card, with the glyph that says which figure it is. */
function Metric({
  label,
  sub,
  value,
  tone,
  icon,
  onClick,
}: {
  label: string
  sub?: string
  /** null while the figure is still being counted — an em dash, never a nought. */
  value: number | null
  tone: 'amber' | 'blue' | 'green' | 'purple'
  icon: React.ReactNode
  onClick?: () => void
}) {
  const inside = (
    <>
      <span className="metric__head">
        <span className="metric__value">{value === null ? '—' : value}</span>
        <span className="metric__icon">{icon}</span>
      </span>
      <span className="metric__label">{label}</span>
      {sub && <span className="metric__sub">{sub}</span>}
    </>
  )

  // A button only where there is something behind it. A tile that looks pressable and
  // is not is the same lie as a disabled control with no reason given.
  return onClick ? (
    <button className={`metric metric--${tone}`} onClick={onClick}>
      {inside}
    </button>
  ) : (
    <div className={`metric metric--${tone}`}>{inside}</div>
  )
}

/**
 * A trend line, drawn only when there is a trend.
 *
 * One point is a dot, not a line, and two are a straight segment that implies more than
 * it knows — so below three readings nothing is drawn at all. The alternative is a
 * shape that looks like history and is not. The space stays reserved either way, so the
 * two halves of the band do not sit at different widths while one is waiting for data.
 *
 * There is no figure printed on it. It used to carry a badge of the latest value, which
 * was the number already set in 30px type six centimetres to its left — and on the
 * right-hand metric that badge landed on top of the Live chip.
 */
function Spark({ values, colour, id }: { values: number[]; colour: string; id: string }) {
  if (values.length < 3) return <span className="spark spark--none" />

  const W = 150
  const H = 54
  const top = Math.max(...values, 0)
  const bottom = Math.min(...values, top)
  // A flat series would divide by zero; it draws down the middle instead.
  const span = top - bottom || 1

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - 8 - ((v - bottom) / span) * (H - 18)
    return [x, y] as const
  })

  const line = points.map(([x, y]) => `${x},${y}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]

  return (
    <span className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          {/* Per-instance, because two gradients sharing an id is one gradient. */}
          <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity="0.35" />
            <stop offset="100%" stopColor={colour} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The fill is what makes it read as a quantity rather than a squiggle. */}
        <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#spark-${id})`} />

        <polyline
          points={line}
          fill="none"
          stroke={colour}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Only the latest reading is marked. A dot on every point turned fourteen
            days of scores into a dotted line and hid the shape. */}
        <circle cx={lastX} cy={lastY} r="6" fill={colour} opacity="0.22" />
        <circle cx={lastX} cy={lastY} r="2.8" fill={colour} />
      </svg>
    </span>
  )
}

/** Green, blue, amber — the same three the rest of the console uses for a score. */
function moodColour(score: number): string {
  if (score >= 7.5) return 'var(--green-ok)'
  if (score >= 6) return 'var(--blue-primary)'
  return 'var(--orange-warn)'
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8.5a6 6 0 10-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5z" />
      <path d="M13.7 19a2 2 0 01-3.4 0" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className="note__shield">
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </svg>
  )
}
