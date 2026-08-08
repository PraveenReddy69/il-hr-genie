/**
 * Navigation icons.
 *
 * Line icons on `currentColor` rather than emoji: emoji are full-colour, render
 * differently on every platform, and cannot follow the link's active or hover state.
 * These inherit it, so the whole rail lights up as one thing.
 *
 * Drawn on a 24-grid with a 1.75 stroke and round joins, which is the weight that
 * holds up at the 18px they are shown at.
 */

type IconProps = { className?: string }

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Panels — the overview at a glance. */
export const DashboardIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="3" width="7.5" height="9" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.6" />
    <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6" />
  </Svg>
)

/** A ticket stub, with the punch on its edge. */
export const TicketsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 9.2V7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v1.7a2.8 2.8 0 0 0 0 5.6v1.7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-1.7a2.8 2.8 0 0 0 0-5.6Z" />
    <path d="M14.5 6v12" strokeDasharray="1.5 2.5" />
  </Svg>
)

/** Two figures — the directory. */
export const PeopleIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="9.5" cy="8" r="3.2" />
    <path d="M3.5 19.5a6 6 0 0 1 12 0" />
    <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9" />
    <path d="M18 14.4a6 6 0 0 1 2.5 5.1" />
  </Svg>
)

/** A clock — hours worked. */
export const AttendanceIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
)

/** Bars — volumes and rates. */
export const AnalyticsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3.5 20.5h17" />
    <rect x="5.5" y="11" width="3.6" height="6.5" rx="1.2" />
    <rect x="10.7" y="6.5" width="3.6" height="11" rx="1.2" />
    <rect x="15.9" y="14" width="3.6" height="3.5" rx="1.2" />
  </Svg>
)

/** A trend line — how it moved over time. */
export const HistoryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3.5 20.5h17" />
    <path d="M5 16l4.2-4.6 3.3 2.6L20 6.5" />
    <path d="M20 11V6.5h-4.5" />
  </Svg>
)

/** A target with an arrow in it — quota attainment. */
export const SalesIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="13" r="7.5" />
    <circle cx="11" cy="13" r="3.6" />
    <path d="m11 13 8.5-8.5" />
    <path d="M16.8 4.2h3v3" />
  </Svg>
)

/** A calendar with a marked day. */
export const HolidaysIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.4" />
    <path d="M3.5 10h17" />
    <path d="M8 3v4M16 3v4" />
    <circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
)
