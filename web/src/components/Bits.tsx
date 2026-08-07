import type { ReactNode } from 'react'
import type { EntryTone, PersonEntry, TicketStatus } from '../api/types'
import { STATUS_LABEL } from '../api/types'

export const STATUS_COLOUR: Record<TicketStatus, string> = {
  OPEN: 'var(--orange-warn)',
  IN_PROGRESS: 'var(--blue-primary)',
  RESOLVED: 'var(--green-ok)',
}

const STATUS_PILL: Record<TicketStatus, string> = {
  OPEN: 'pill--open',
  IN_PROGRESS: 'pill--progress',
  RESOLVED: 'pill--resolved',
}

const TONE_PILL: Record<EntryTone, string> = {
  POSITIVE: 'pill--resolved',
  WARNING: 'pill--open',
  NEUTRAL: 'pill--neutral',
  MUTED: 'pill--muted',
}

export function Card({
  chip,
  chipColour,
  title,
  subtitle,
  action,
  children,
}: {
  chip: string
  chipColour: string
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card">
      <header className="card__head">
        <span className="card__chip" style={{ background: chipColour }}>
          {chip}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="card__title">{title}</div>
          {subtitle && <div className="card__subtitle">{subtitle}</div>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function StatusPill({ status }: { status: TicketStatus }) {
  return <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>
}

const AVATAR_COLOURS = ['#2b8cff', '#f2683c', '#42c07a', '#7a5af8']

export function Avatar({ name, index }: { name: string; index: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <span
      className="avatar"
      style={{ background: AVATAR_COLOURS[index % AVATAR_COLOURS.length] }}
    >
      {initials}
    </span>
  )
}

/**
 * One person behind a figure. Rows carrying a breakdown (pulse answers) expand in
 * place; rows without one are not clickable, so the affordance never lies.
 */
export function PersonRow({
  entry,
  index,
  expanded,
  onToggle,
}: {
  entry: PersonEntry
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const canExpand = (entry.breakdown?.length ?? 0) > 0
  return (
    <div>
      <div className="row" {...(canExpand ? clickable(onToggle) : {})}>
        <Avatar name={entry.name} index={index} />
        <div className="row__main">
          <div className="row__title">{entry.name}</div>
          <div className="row__meta">{entry.subtitle}</div>
        </div>
        <span className={`pill ${TONE_PILL[entry.tone]}`}>{entry.value}</span>
        {canExpand && (
          <span style={{ color: 'var(--blue-deep)', fontSize: 11 }}>
            {expanded ? '▴' : '▾'}
          </span>
        )}
      </div>

      {canExpand && expanded && (
        <div
          style={{
            margin: '0 0 12px 50px',
            padding: '4px 14px',
            background: 'var(--bg-cell)',
            border: '1px solid var(--ink-06)',
            borderRadius: 'var(--radius-tile)',
          }}
        >
          {entry.breakdown?.map((line) => (
            <div key={line.label} style={{ padding: '9px 0' }}>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{line.label}</div>
              <div style={{ fontWeight: 500, marginTop: 3 }}>{line.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Props that make a clickable row behave like the button it is: reachable by tab,
 * activated by Enter or Space. A bare onClick on a div is invisible to a keyboard.
 */
export function clickable(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate()
      }
    },
    style: { cursor: 'pointer' },
  }
}

export function Empty({
  children,
  style,
}: {
  children: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div className="empty" style={style}>
      {children}
    </div>
  )
}

export function Loading() {
  return <div className="skeleton" />
}

export function relativeTime(millis: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - millis) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function formatHours(millis: number): string {
  const minutes = Math.max(0, Math.floor(millis / 60000))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
