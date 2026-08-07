import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Empty, Loading, formatHours } from '../components/Bits'
import { PeopleDrawer } from '../components/Drawer'
import { fetchMoodDetail, fetchPulseDetail, fetchStats } from '../api/client'
import { isoDate, currentCycle } from '../api/mock'
import {
  MIN_COHORT,
  MOODS,
  MOOD_KEYS,
  type HrStats,
  type PersonEntry,
} from '../api/types'

type DrillDown = { title: string; subtitle: string; entries: PersonEntry[] }

export function Dashboard({ hrName }: { hrName: string }) {
  const [stats, setStats] = useState<HrStats | null>(null)
  const [drill, setDrill] = useState<DrillDown | null>(null)

  useEffect(() => {
    fetchStats().then(setStats)
  }, [])

  async function openMood() {
    const entries = await fetchMoodDetail(isoDate())
    const shared = entries.filter((entry) => entry.tone !== 'MUTED').length
    setDrill({
      title: 'Who shared a mood',
      subtitle: `${shared} of ${entries.length} shared today`,
      entries,
    })
  }

  async function openPulse() {
    const entries = await fetchPulseDetail(currentCycle())
    const done = entries.filter((entry) => entry.tone === 'POSITIVE').length
    setDrill({
      title: 'Monthly pulse',
      subtitle: `${done} of ${entries.length} answered · click a name for their answers`,
      entries,
    })
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
  const flagged = stats.weekMisPunches + stats.weekAbsences

  return (
    <>
      <section className="hero">
        <span className="hero__badge">
          <span className="hero__dot" />
          HRBP view
        </span>
        <h2>Sentiment, {new Date().toLocaleDateString(undefined, { month: 'long' })}</h2>
        <div className="hero__sub">
          {today} · {stats.headcount} on the roll · welcome back, {hrName.split(' ')[0]}
        </div>

        <div className="kpis">
          <button className="kpi" onClick={openMood}>
            <div className="kpi__value">
              {stats.engagementScore === null ? '—' : stats.engagementScore.toFixed(1)}
              {stats.engagementScore !== null && <small>/10</small>}
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
              {stats.pulseCompleted} of {stats.headcount} answered
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
            <button className="tile tile--blue" onClick={openMood}>
              <div className="tile__value" style={{ color: 'var(--blue-deep)' }}>
                {stats.checkedInToday}
              </div>
              <div className="tile__label">Checked in</div>
              <div className="tile__sub">of {stats.headcount}</div>
            </button>
            <div className="tile tile--green">
              <div className="tile__value" style={{ color: 'var(--green-ok)' }}>
                {stats.onTheClock}
              </div>
              <div className="tile__label">On the clock</div>
            </div>
            <button className="tile tile--purple" onClick={openMood}>
              <div className="tile__value" style={{ color: 'var(--purple)' }}>
                {stats.moodResponsesToday}
              </div>
              <div className="tile__label">Mood shared</div>
              <div className="tile__sub">of {stats.headcount}</div>
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
              : `${stats.moodResponsesToday} of ${stats.headcount} shared how they feel`
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

        <Card chip="📊" chipColour="var(--blue-tint-12)" title="Department sentiment">
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

      <div className="grid grid--2" style={{ marginTop: 16 }}>
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

        <Card chip="⚠️" chipColour="rgba(229,72,77,.14)" title="Attention signals">
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, fontSize: 12.5 }}>
            {stats.headcount < MIN_COHORT
              ? `Cohorts report at ${MIN_COHORT} or more. With ${stats.headcount} people on the roll, no signal can be shown without identifying someone — so this stays empty by design.`
              : flagged === 0
                ? 'Nothing needs attention. No cohort is trending low and no missed punches are outstanding.'
                : `${flagged} missed punch${flagged === 1 ? '' : 'es'} or absence${flagged === 1 ? '' : 's'} this week. Follow up as attendance, not as sentiment.`}
          </p>
          <Link className="button button--ghost" to="/trends" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            📈 Mood &amp; pulse history
          </Link>
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
