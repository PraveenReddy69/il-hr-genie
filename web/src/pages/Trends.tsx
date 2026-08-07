import { useEffect, useState } from 'react'
import { Card, Empty, Loading, clickable } from '../components/Bits'
import { TrendBars } from '../components/Chart'
import { PeopleDrawer } from '../components/Drawer'
import {
  fetchMoodDetail,
  fetchMoodHistory,
  fetchPulseBreakdown,
  fetchPulseDetail,
  fetchPulseHistory,
} from '../api/client'
import { currentCycle } from '../api/mock'
import type { CycleSummary, DayMood, PersonEntry, QuestionBreakdown } from '../api/types'

type DrillDown = { title: string; subtitle: string; entries: PersonEntry[] }

export function Trends() {
  const [days, setDays] = useState<DayMood[] | null>(null)
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null)
  const [selected, setSelected] = useState(currentCycle())
  const [breakdown, setBreakdown] = useState<QuestionBreakdown[]>([])
  const [drill, setDrill] = useState<DrillDown | null>(null)

  useEffect(() => {
    fetchMoodHistory().then(setDays)
    fetchPulseHistory().then(setCycles)
  }, [])

  useEffect(() => {
    fetchPulseBreakdown(selected).then(setBreakdown)
  }, [selected])

  if (!days || !cycles) return <Loading />

  const answered = days.filter((day) => day.score !== null)
  const mean =
    answered.length === 0
      ? null
      : answered.reduce((sum, day) => sum + (day.score ?? 0), 0) / answered.length

  async function openDay(dateIso: string) {
    const entries = await fetchMoodDetail(dateIso)
    const shared = entries.filter((entry) => entry.tone !== 'MUTED').length
    setDrill({
      title: new Date(`${dateIso}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
      subtitle: `${shared} of ${entries.length} shared that day`,
      entries,
    })
  }

  async function openCycle() {
    const entries = await fetchPulseDetail(selected)
    const done = entries.filter((entry) => entry.tone === 'POSITIVE').length
    setDrill({
      title: monthLabel(selected),
      subtitle: `${done} of ${entries.length} answered · click a name for their answers`,
      entries,
    })
  }

  const summary = cycles.find((cycle) => cycle.cycle === selected)
  const anyAnswers = breakdown.some((question) =>
    question.answers.some((answer) => answer.count > 0),
  )

  return (
    <>
      <div className="page-head">
        <h1>Mood &amp; pulse history</h1>
        <p>
          Last {days.length} days · {cycles.length} pulse cycles
        </p>
      </div>

      <Card
        chip="💜"
        chipColour="var(--purple-tint-12)"
        title="Mood, day by day"
        subtitle={
          mean === null
            ? 'No check-ins recorded in this window yet.'
            : `Averaging ${mean.toFixed(1)} across ${answered.length} days with answers`
        }
        action={<span className="card__action">Click a day</span>}
      >
        {answered.length === 0 ? (
          <Empty>Nothing to chart yet. Days appear here as people check in.</Empty>
        ) : (
          <TrendBars
            max={10}
            onSelect={openDay}
            columns={days.map((day) => ({
              key: day.dateIso,
              label: new Date(`${day.dateIso}T00:00:00`)
                .toLocaleDateString(undefined, { weekday: 'short' })
                .charAt(0),
              value: day.score,
              title:
                day.score === null
                  ? `${day.dateIso} · no check-ins`
                  : `${day.dateIso} · ${day.score.toFixed(1)} from ${day.responses}`,
            }))}
          />
        )}
      </Card>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card chip="📊" chipColour="var(--blue-tint-12)" title="Pulse completion by month">
          {[...cycles].reverse().map((cycle) => (
            <div
              key={cycle.cycle}
              {...clickable(() => setSelected(cycle.cycle))}
              style={{ cursor: 'pointer', padding: '8px 0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{monthLabel(cycle.cycle)}</span>
                {cycle.cycle === currentCycle() && (
                  <span className="pill pill--neutral" style={{ marginRight: 8 }}>
                    This month
                  </span>
                )}
                <strong style={{ color: 'var(--text-slate)' }}>
                  {cycle.completed} / {cycle.headcount}
                </strong>
              </div>
              <div className="track">
                <div
                  className="track__fill"
                  style={{
                    width: `${cycle.headcount === 0 ? 0 : (cycle.completed / cycle.headcount) * 100}%`,
                    background:
                      cycle.cycle === selected ? 'var(--blue-primary)' : 'var(--ink-12)',
                  }}
                />
              </div>
            </div>
          ))}
        </Card>

        <Card
          chip="💡"
          chipColour="var(--green-tint-14)"
          title="How they answered"
          subtitle={`${monthLabel(selected)} · ${summary?.completed ?? 0} of ${summary?.headcount ?? 0} answered`}
          action={<button className="card__action" onClick={openCycle}>Who</button>}
        >
          {!anyAnswers ? (
            <Empty>Nobody answered this cycle.</Empty>
          ) : (
            breakdown.map((question) => {
              const highest = Math.max(...question.answers.map((answer) => answer.count))
              return (
                <div key={question.questionId} style={{ marginBottom: 18 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>
                    {question.question}
                  </div>
                  {question.answers.map((answer) => (
                    <div
                      key={answer.option}
                      style={{ marginBottom: 8, opacity: answer.count === 0 ? 0.45 : 1 }}
                    >
                      <div style={{ display: 'flex', marginBottom: 4 }}>
                        <span style={{ flex: 1, color: 'var(--text-slate)', fontSize: 12.5 }}>
                          {answer.option}
                        </span>
                        <strong style={{ fontSize: 12.5 }}>{answer.count}</strong>
                      </div>
                      <div className="track" style={{ height: 5 }}>
                        <div
                          className="track__fill"
                          style={{
                            width: `${highest === 0 ? 0 : (answer.count / highest) * 100}%`,
                            background:
                              answer.count > 0 && answer.count === highest
                                ? 'var(--blue-primary)'
                                : 'var(--ink-12)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </Card>
      </div>

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

function monthLabel(cycle: string): string {
  return new Date(`${cycle}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}
