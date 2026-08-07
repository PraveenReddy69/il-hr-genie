/**
 * The two charts the console needs, hand-drawn in SVG.
 *
 * Colours are the app's reserved status palette, which was validated for
 * colourblind separation — and every slice is named in the legend beside it, so the
 * ring is never read by colour alone.
 */

interface Slice {
  label: string
  value: number
  colour: string
}

export function Donut({
  slices,
  total,
  caption,
}: {
  slices: Slice[]
  total: number
  caption: string
}) {
  const size = 128
  const stroke = 15
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const plotted = slices.filter((slice) => slice.value > 0)
  // A lone slice has no neighbour to separate it from, so it stays whole.
  const gap = plotted.length > 1 ? 5 : 0

  let offset = 0

  return (
    <div className="donut">
      <div className="donut__hole">
        <svg width={size} height={size} role="presentation">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--ink-08)"
              strokeWidth={stroke}
            />
            {total > 0 &&
              plotted.map((slice) => {
                const length = (slice.value / total) * circumference
                const dash = Math.max(0, length - gap)
                const element = (
                  <circle
                    key={slice.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={slice.colour}
                    strokeWidth={stroke}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset - gap / 2}
                  />
                )
                offset += length
                return element
              })}
          </g>
        </svg>
        <div className="donut__centre">
          <div>
            <div className="donut__total">{total}</div>
            <div className="donut__caption">{caption}</div>
          </div>
        </div>
      </div>

      <div className="legend">
        {slices.map((slice) => (
          <div
            className="legend__row"
            key={slice.label}
            // A status with none of the queue stays listed, just recessive: the
            // legend is the key to the ring, not a filtered list.
            style={{ opacity: slice.value === 0 ? 0.45 : 1 }}
          >
            <span className="legend__swatch" style={{ background: slice.colour }} />
            <span className="legend__label">{slice.label}</span>
            <span className="legend__value">{slice.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Two counts per period, side by side.
 *
 * Both series are the same unit on one scale — never two axes, which would let the
 * shapes be scaled into any story you like.
 */
export function PairedBars({
  groups,
  series,
}: {
  groups: { key: string; label: string; values: number[] }[]
  series: { label: string; colour: string }[]
}) {
  const max = Math.max(1, ...groups.flatMap((group) => group.values))

  return (
    <>
      <div className="legend" style={{ display: 'flex', gap: 16, marginBottom: 4 }}>
        {series.map((entry) => (
          <span className="legend__row" key={entry.label} style={{ gap: 7 }}>
            <span className="legend__swatch" style={{ background: entry.colour }} />
            <span className="legend__label" style={{ flex: 'none' }}>
              {entry.label}
            </span>
          </span>
        ))}
      </div>

      <div className="trend" style={{ height: 150, gap: 12 }}>
        {groups.map((group) => (
          <div className="trend__col" key={group.key} style={{ gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 3,
                width: '100%',
                height: '100%',
                justifyContent: 'center',
              }}
            >
              {group.values.map((value, index) => (
                <span
                  key={series[index].label}
                  title={`${group.label} · ${series[index].label} ${value}`}
                  className="trend__bar"
                  style={{
                    // A zero still shows a sliver, so an empty week reads as
                    // measured-and-none rather than missing.
                    height: `${Math.max(3, (value / max) * 100)}%`,
                    width: 16,
                    background: series[index].colour,
                  }}
                />
              ))}
            </div>
            <span className="trend__label">{group.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

interface Column {
  key: string
  label: string
  /** null means nobody answered that day — drawn as a stub, never as a zero. */
  value: number | null
  title: string
}

export function TrendBars({
  columns,
  max,
  onSelect,
}: {
  columns: Column[]
  max: number
  onSelect?: (key: string) => void
}) {
  return (
    <div className="trend">
      {columns.map((column, index) => {
        const hasData = column.value !== null
        const ratio = hasData ? Math.min(1, (column.value ?? 0) / max) : 0
        const height = hasData ? 16 + ratio * 78 : 6
        const isLast = index === columns.length - 1
        const colour = !hasData
          ? 'var(--ink-08)'
          : isLast
            ? 'var(--blue-primary)'
            : (column.value ?? 0) < 5
              ? 'var(--orange-warn)'
              : 'var(--blue-tint-12)'

        return (
          <button
            type="button"
            className="trend__col"
            key={column.key}
            title={column.title}
            disabled={!hasData}
            onClick={() => hasData && onSelect?.(column.key)}
            style={{ cursor: hasData && onSelect ? 'pointer' : 'default' }}
          >
            <span
              className="trend__bar"
              style={{ height: `${height}px`, background: colour }}
            />
            <span className="trend__label">{column.label}</span>
          </button>
        )
      })}
    </div>
  )
}
