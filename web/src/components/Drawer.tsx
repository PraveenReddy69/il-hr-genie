import { useEffect, useState, type ReactNode } from 'react'
import { PersonRow } from './Bits'
import type { PersonEntry } from '../api/types'

/** Closes on Escape and on a click outside, like every other panel of its kind. */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h3>{title}</h3>
            {subtitle && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 4 }}>
                {subtitle}
              </div>
            )}
          </div>
          <button className="drawer__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </aside>
    </div>
  )
}

/** The people behind a figure. */
export function PeopleDrawer({
  title,
  subtitle,
  entries,
  onClose,
}: {
  title: string
  subtitle: string
  entries: PersonEntry[]
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}>
      <div style={{ marginTop: 18 }}>
        {entries.length === 0 && <div className="empty">Nothing recorded yet.</div>}
        {entries.map((entry, index) => (
          <PersonRow
            key={entry.employeeId}
            entry={entry}
            index={index}
            expanded={expanded === entry.employeeId}
            onToggle={() =>
              setExpanded(expanded === entry.employeeId ? null : entry.employeeId)
            }
          />
        ))}
      </div>
      <p className="note">
        Individual records, under Infinity Learn&apos;s employee data policy. Written
        check-in notes are not exposed.
      </p>
    </Drawer>
  )
}
