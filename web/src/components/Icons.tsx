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

/** A pulse trace over a rounded card — the monthly check, not a heartbeat monitor. */
export const PulseIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.6" />
    <path d="M6.5 12.5h2.2l1.6-3.4 2.4 6 1.6-2.6h2.8" />
  </Svg>
)

/**
 * A gift, for celebrations.
 *
 * A cake was the obvious choice and reads as a birthday alone — this page is also
 * anniversaries and joiners, and a cake would quietly mislabel two thirds of it.
 */
export const CelebrationsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" />
    <path d="M3 8h18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <path d="M12 8v13" />
    <path d="M12 8H7.5a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8Z" />
    <path d="M12 8h4.5a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8Z" />
  </Svg>
)

/* ------------------------------------------------- the ticket queue's glyphs */

/**
 * One glyph per ticket category, and one per stat.
 *
 * A queue is read by scanning, and a shape is faster to scan than a word. These sit in
 * a tinted square at the head of each row, so they carry the category and free the
 * meta line to carry the reference and the person instead.
 *
 * Same 24-grid and 1.75 stroke as the navigation set — at 18px inside a 38px tile they
 * hold up, and a heavier weight would fight the row title.
 */
export const PayrollIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2" y="5" width="20" height="14" rx="2.5" />
    <path d="M2 10h20" />
    <path d="M6 15h4" />
  </Svg>
)

export const LeaveIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 21c-4-2-7-5.5-7-10a7 7 0 0 1 14 0c0 4.5-3 8-7 10Z" />
    <path d="M12 21V8" />
    <path d="M12 12c-1.6 0-3-1.2-3-2.6" />
  </Svg>
)

export const AccessIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M12 14v2" />
  </Svg>
)

export const InsuranceIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3Z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </Svg>
)

export const FacilitiesIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="2" />
    <path d="M12 10c0-3 1-5 3-5s2.5 2 1 3.5S12 10 12 10Z" />
    <path d="M14 12c3 0 5 1 5 3s-2 2.5-3.5 1S14 12 14 12Z" />
    <path d="M12 14c0 3-1 5-3 5s-2.5-2-1-3.5S12 14 12 14Z" />
    <path d="M10 12c-3 0-5-1-5-3s2-2.5 3.5-1S10 12 10 12Z" />
  </Svg>
)

export const SomethingElseIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.4" />
    <path d="M12 17h.01" />
  </Svg>
)

/** Stat-strip glyphs. Each says what the number is about, not what it counts. */
export const OpenIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </Svg>
)

export const ProgressIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Svg>
)

export const UnownedIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
)

export const WaitingIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M7 3h10" />
    <path d="M7 21h10" />
    <path d="M8 3v3.5c0 2 4 3.4 4 5.5s-4 3.5-4 5.5V21" />
    <path d="M16 3v3.5c0 2-4 3.4-4 5.5s4 3.5 4 5.5V21" />
  </Svg>
)

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)

export const TickIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 13 4 4 10-10" />
  </Svg>
)

export const HintIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .9 1.6h5.2c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3Z" />
  </Svg>
)

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)
