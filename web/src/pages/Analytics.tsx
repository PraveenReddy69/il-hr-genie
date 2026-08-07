import { useEffect, useState } from 'react'
import { Card, Empty, Loading } from '../components/Bits'
import { Donut, PairedBars } from '../components/Chart'
import { fetchChatAnalytics, fetchTicketAnalytics, isLive } from '../api/client'
import {
  POLICY_GAP_RATIO,
  type ChatAnalytics,
  type ChatQuestion,
  type TicketAnalytics,
} from '../api/types'

const CATEGORY_COLOURS = [
  'var(--blue-primary)',
  'var(--purple)',
  'var(--green-ok)',
  'var(--orange-warn)',
  'var(--blue-deep)',
  'var(--text-muted)',
]

export function Analytics() {
  const [tickets, setTickets] = useState<TicketAnalytics | null>(null)
  const [chat, setChat] = useState<ChatAnalytics | null>(null)

  useEffect(() => {
    fetchTicketAnalytics().then(setTickets)
    fetchChatAnalytics().then(setChat)
  }, [])

  if (!tickets || !chat) return <Loading />

  const deflection =
    chat.questionsAsked === 0
      ? 0
      : Math.round((chat.answeredByKb / chat.questionsAsked) * 100)

  const gaps = chat.topQuestions.filter(isPolicyGap)

  // Nothing records what employees ask yet, so in live mode these cards have no
  // source. They show a dash rather than a zero, which would read as "nobody asked".
  const chatLogged = chat.questionsAsked > 0

  return (
    <>
      <div className="page-head">
        <h1>Chat &amp; ticket analytics</h1>
        <p>
          {chatLogged
            ? `${chat.questionsAsked} questions asked · ${tickets.raised} tickets raised · ${deflection}% answered without one`
            : `${tickets.raised} tickets raised · ${tickets.resolved} closed`}
        </p>
      </div>

      <div className="grid grid--3">
        <Card chip="💬" chipColour="var(--blue-tint-12)" title="Answered by HR Genie">
          <div className="tile__value" style={{ color: 'var(--blue-deep)' }}>
            {chatLogged ? deflection : '—'}
            {chatLogged && (
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>%</span>
            )}
          </div>
          <div className="tile__sub">
            {chatLogged
              ? `${chat.answeredByKb} of ${chat.questionsAsked} never needed HR`
              : 'Chat questions are not logged yet'}
          </div>
        </Card>

        <Card chip="🎫" chipColour="var(--orange-tint-14)" title="Became a ticket">
          <div className="tile__value" style={{ color: 'var(--orange-warn)' }}>
            {chatLogged ? chat.escalatedToTickets : tickets.raised}
          </div>
          <div className="tile__sub">
            {chatLogged
              ? 'Questions the library could not close'
              : 'Tickets raised from chat'}
          </div>
        </Card>

        <Card chip="⏳" chipColour="var(--green-tint-14)" title="Median time to resolve">
          <div className="tile__value" style={{ color: 'var(--green-ok)' }}>
            {tickets.medianResolutionMillis === null
              ? '—'
              : formatDuration(tickets.medianResolutionMillis)}
          </div>
          <div className="tile__sub">
            {tickets.resolved} of {tickets.raised} closed
          </div>
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          chip="📈"
          chipColour="var(--blue-tint-12)"
          title="Volume by week"
          subtitle="Raised against closed, last six weeks"
        >
          <PairedBars
            series={[
              { label: 'Raised', colour: 'var(--orange-warn)' },
              { label: 'Resolved', colour: 'var(--green-ok)' },
            ]}
            groups={tickets.volume.map((week) => ({
              key: week.weekStartIso,
              label: weekLabel(week.weekStartIso),
              values: [week.raised, week.resolved],
            }))}
          />
        </Card>

        <Card
          chip="🗂️"
          chipColour="var(--purple-tint-12)"
          title="Where tickets come from"
          subtitle={`${tickets.byCategory.length} categories in play`}
        >
          <Donut
            total={tickets.raised}
            caption={tickets.raised === 1 ? 'ticket' : 'tickets'}
            slices={tickets.byCategory.map((category, index) => ({
              label: category.category,
              value: category.raised,
              colour: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length],
            }))}
          />
        </Card>
      </div>

      <Card
        chip="⏱️"
        chipColour="var(--green-tint-14)"
        title="How long each category takes"
        subtitle="Median from raised to closed"
      >
        {tickets.byCategory.map((category, index) => (
          <div className="row" key={category.category}>
            <span
              className="option__dot"
              style={{ background: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length] }}
            />
            <div className="row__main">
              <div className="row__title">{category.category}</div>
              <div className="row__meta">
                {category.raised} raised
                {category.open > 0 && ` · ${category.open} still open`}
              </div>
            </div>
            <strong
              style={{
                color:
                  category.medianResolutionMillis === null
                    ? 'var(--text-muted)'
                    : 'var(--text-slate)',
              }}
            >
              {category.medianResolutionMillis === null
                ? 'None closed yet'
                : formatDuration(category.medianResolutionMillis)}
            </strong>
          </div>
        ))}
      </Card>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          chip="❓"
          chipColour="var(--blue-tint-12)"
          title="What employees keep asking"
          subtitle="Most asked first"
        >
          {!chatLogged && (
            <Empty>
              Nothing is recorded yet. HR Genie answers a question and forgets it, so
              there is no log to rank.
            </Empty>
          )}
          {chat.topQuestions.map((question) => {
            const share = Math.round((question.answered / question.asks) * 100)
            return (
              <div key={question.question} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 12.5 }}>
                    {question.question}
                  </span>
                  <strong style={{ fontSize: 12.5 }}>{question.asks}</strong>
                </div>
                <div className="track">
                  {/* Answered fills from the left; what remains is what HR had to
                      handle, so the gap is the story. */}
                  <div
                    className="track__fill"
                    style={{
                      width: `${share}%`,
                      background: isPolicyGap(question)
                        ? 'var(--orange-warn)'
                        : 'var(--blue-primary)',
                    }}
                  />
                </div>
                <div
                  style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}
                >
                  {question.answered} answered · {question.escalated}{' '}
                  {question.escalated === 1 ? 'became a ticket' : 'became tickets'}
                </div>
              </div>
            )
          })}
        </Card>

        <Card
          chip="🕳️"
          chipColour="var(--orange-tint-14)"
          title="Policy gaps"
          subtitle="Asked often, answered rarely"
        >
          {gaps.length === 0 ? (
            <Empty>
              {chatLogged
                ? 'Nothing stands out. Every common question is being answered from the policy library.'
                : 'Cannot be judged yet — a gap is a question asked often and answered rarely, and neither half is being recorded.'}
            </Empty>
          ) : (
            <>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  margin: '0 0 12px',
                }}
              >
                These end up as tickets more than{' '}
                {Math.round(POLICY_GAP_RATIO * 100)}% of the time. That is usually the
                handbook missing an answer, not the assistant failing.
              </p>
              {gaps.map((question) => (
                <div className="row" key={question.question}>
                  <span className="accent" style={{ background: 'var(--orange-warn)' }} />
                  <div className="row__main">
                    <div className="row__title">{question.question}</div>
                    <div className="row__meta">
                      {question.escalated} of {question.asks} asks became tickets
                    </div>
                  </div>
                  <span className="pill pill--open">
                    {Math.round((question.escalated / question.asks) * 100)}%
                  </span>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      <p className="note">
        {isLive
          ? '⚠️ Ticket figures are live. Chat analytics are blank because nothing records what employees ask HR Genie — the backend has to log each query, and whether it ended in a ticket, before this section can say anything.'
          : '⚠️ Ticket figures are computed from real tickets. The question log is illustrative — nothing records what employees ask HR Genie yet, so chat analytics need the backend to start logging queries before these numbers mean anything.'}
      </p>
    </>
  )
}

function isPolicyGap(question: ChatQuestion): boolean {
  return question.asks > 0 && question.escalated / question.asks >= POLICY_GAP_RATIO
}

function formatDuration(millis: number): string {
  const hours = millis / 3600_000
  if (hours < 1) return `${Math.round(millis / 60_000)}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

function weekLabel(mondayIso: string): string {
  return new Date(`${mondayIso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}
