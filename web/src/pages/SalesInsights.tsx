import { useEffect, useMemo, useState } from 'react'
import { Avatar, Card, Empty, Loading } from '../components/Bits'
import { Donut } from '../components/Chart'
import { PeopleDrawer } from '../components/Drawer'
import {
  BAND_COLOUR,
  BAND_LABEL,
  RAMP_MONTHS,
  RANKED_BANDS,
  STRAIN_BELOW,
  attentionLists,
  fetchSalesCycles,
  fetchSalesReport,
  type Band,
  type SalesCycle,
  type SalesRow,
} from '../api/sales'
import type { PersonEntry } from '../api/types'

type Sort = 'attainment' | 'mood' | 'shortfall'

export function SalesInsights() {
  const [cycles, setCycles] = useState<SalesCycle[] | null>(null)
  const [selected, setSelected] = useState<SalesCycle[]>([])
  const [rows, setRows] = useState<SalesRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [band, setBand] = useState<Band | null>(null)
  const [sort, setSort] = useState<Sort>('attainment')
  const [query, setQuery] = useState('')
  const [drill, setDrill] = useState<{ title: string; entries: PersonEntry[] } | null>(null)

  useEffect(() => {
    fetchSalesCycles()
      .then((all) => {
        setCycles(all)
        // Opens on the latest cycle. Everything at once would be a slower first paint
        // and a blend nobody asked for.
        setSelected(all.slice(0, 1))
      })
      .catch(() => setFailed(true))
  }, [])

  // Identity, not the array: a new array of the same cycles must not refetch.
  const selectedKey = selected.map((one) => one.id).join(',')

  useEffect(() => {
    if (selected.length === 0) return
    let cancelled = false
    setRows(null)
    fetchSalesReport(selected)
      .then((report) => {
        if (!cancelled) {
          setRows(report.rows)
          setFailed(false)
        }
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  /**
   * One cycle must always stay picked.
   *
   * Turning the last one off would leave the page with nothing to report and no
   * obvious way back, so the click is simply ignored — a disabled-looking chip that
   * silently does nothing is better than an empty screen.
   */
  function toggleCycle(one: SalesCycle) {
    const on = selected.some((pick) => pick.id === one.id)
    if (on && selected.length === 1) return
    const next = on
      ? selected.filter((pick) => pick.id !== one.id)
      : [...selected, one]
    // Keep the server's order so the summary line reads chronologically.
    setSelected((cycles ?? []).filter((cycle) => next.some((pick) => pick.id === cycle.id)))
    setBand(null)
  }

  const counts = useMemo(() => {
    const tally = {} as Record<Band, number>
    ;(rows ?? []).forEach((row) => {
      tally[row.band] = (tally[row.band] ?? 0) + 1
    })
    return tally
  }, [rows])

  const attention = useMemo(() => attentionLists(rows ?? []), [rows])

  // Only quota-carriers are a performance judgement; the rest are context.
  const judged = RANKED_BANDS.reduce((total, key) => total + (counts[key] ?? 0), 0)

  /**
   * Both figures cover quota-carriers only, matching the ring above them.
   *
   * The pair is deliberate: the total is money-weighted, so a handful of large
   * territories can carry it while most of the team misses, and the median says
   * where the middle person actually sits. Either alone tells half the story.
   */
  const headline = useMemo(() => {
    const carriers = (rows ?? []).filter((row) => row.attainment !== null)
    if (carriers.length === 0) return { overall: 0, median: 0 }
    const target = carriers.reduce((sum, row) => sum + row.target, 0)
    const achieved = carriers.reduce((sum, row) => sum + row.achieved, 0)
    const sorted = carriers.map((row) => row.attainment as number).sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return {
      overall: target === 0 ? 0 : (achieved / target) * 100,
      median:
        sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    }
  }, [rows])

  const listed = useMemo(() => {
    // Name, id, sub-department and designation all match, because HR searches by
    // whatever they happen to have to hand. There is no search endpoint — the whole
    // directory is already loaded for the tenure join, so this is instant anyway.
    const needle = query.trim().toLowerCase()
    const pool = (rows ?? [])
      .filter((row) => (band ? row.band === band : row.attainment !== null))
      .filter(
        (row) =>
          needle === '' ||
          row.name.toLowerCase().includes(needle) ||
          row.employeeId.toLowerCase().includes(needle) ||
          row.subDepartment.toLowerCase().includes(needle) ||
          row.designation.toLowerCase().includes(needle),
      )
    const by: Record<Sort, (a: SalesRow, b: SalesRow) => number> = {
      attainment: (a, b) => (b.attainment ?? 0) - (a.attainment ?? 0),
      mood: (a, b) => (a.moodScore ?? 99) - (b.moodScore ?? 99),
      shortfall: (a, b) => a.target - a.achieved - (b.target - b.achieved),
    }
    return [...pool].sort(by[sort]).slice(0, PAGE_SIZE)
  }, [rows, band, sort, query])

  if (failed && !rows) {
    return (
      <>
        <div className="page-head">
          <h1>Sales insights</h1>
          <p>Couldn&apos;t load the report</p>
        </div>
        <section className="card">
          <Empty>HR Genie is not reachable right now, so the report can&apos;t be built.</Empty>
        </section>
      </>
    )
  }

  if (!cycles || !rows) return <Loading />

  const total = rows.length

  return (
    <>
      <div className="page-head">
        <h1>Sales insights</h1>
        <p>
          {total} in Sales · {judged} carrying a target
          {selected.length === 1 ? ' this cycle' : ` across ${selected.length} cycles`}
        </p>
      </div>

      <section className="card">
        <div className="chips">
          {cycles.map((one) => {
            const on = selected.some((pick) => pick.id === one.id)
            return (
              <button
                key={one.id}
                className={`chip ${on ? 'chip--on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleCycle(one)}
              >
                {on && <span className="chip__tick">✓</span>}
                {one.name}
              </button>
            )
          })}
          {cycles.length > 1 && (
            <button
              className="chip chip--ghost"
              onClick={() => {
                setSelected(selected.length === cycles.length ? cycles.slice(0, 1) : cycles)
                setBand(null)
              }}
            >
              {selected.length === cycles.length ? 'Latest only' : 'All cycles'}
            </button>
          )}
        </div>
        {selected.length > 1 && (
          <p className="note note--left">
            Combining {selected.length} cycles: targets and achievement are summed per
            person, so the bands describe the whole selection rather than any one cycle.
          </p>
        )}
      </section>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          chip="🏆"
          chipColour="var(--green-tint-14)"
          title="How the quota-carriers landed"
          subtitle={`${judged} people measured against a target`}
        >
          <Donut
            total={judged}
            caption="on quota"
            slices={RANKED_BANDS.map((key) => ({
              label: BAND_LABEL[key],
              value: counts[key] ?? 0,
              colour: BAND_COLOUR[key],
            }))}
          />

          {/* The ring shows how people are spread; these show how the cycle is
              actually going, which is the first thing anyone asks next. */}
          <div className="stat-strip">
            <div className="stat-strip__item">
              <span className="stat-strip__value">{Math.round(headline.overall)}%</span>
              <span className="stat-strip__label">Of total target booked</span>
            </div>
            <div className="stat-strip__item">
              <span className="stat-strip__value">{Math.round(headline.median)}%</span>
              <span className="stat-strip__label">Median attainment</span>
            </div>
            <div className="stat-strip__item">
              <span className="stat-strip__value">{counts.HIGH ?? 0}</span>
              <span className="stat-strip__label">Hit their target</span>
            </div>
          </div>
        </Card>

        <Card
          chip="🎯"
          chipColour="var(--blue-tint-12)"
          title="Bands"
          subtitle="Click a band to filter the roster below"
        >
          <div className="bands">
            {RANKED_BANDS.map((key) => {
              const n = counts[key] ?? 0
              const share = judged === 0 ? 0 : (n / judged) * 100
              const on = band === key
              return (
                <button
                  key={key}
                  type="button"
                  className={`band ${on ? 'band--on' : ''} ${band && !on ? 'band--off' : ''}`}
                  style={{ '--band': BAND_COLOUR[key] } as React.CSSProperties}
                  aria-pressed={on}
                  onClick={() => setBand(on ? null : key)}
                >
                  <span className="band__name">
                    <span className="band__swatch" />
                    {BAND_LABEL[key]}
                  </span>
                  <span className="band__count">{n}</span>
                  <span className="band__rule">{RULE[key]}</span>
                  <span className="band__share">{Math.round(share)}%</span>
                  <span className="band__track">
                    <span className="band__fill" style={{ width: `${share}%` }} />
                  </span>
                </button>
              )
            })}
          </div>

          {/* Not bands — stating them keeps the percentages above honest. */}
          <p className="band-aside">
            <strong>{counts.RAMPING ?? 0}</strong> still ramping (under {RAMP_MONTHS} months,
            so a full-cycle target is not a fair measure) and{' '}
            <strong>{counts.NO_QUOTA ?? 0}</strong> with no target set this cycle. Neither is
            counted as under-performing.
          </p>
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          chip="⚠️"
          chipColour="rgba(229,72,77,.14)"
          title="Delivering, but not okay"
          subtitle="Hitting target with a low mood — the retention risk"
        >
          {attention.atRisk.length === 0 ? (
            <Empty>Nobody hitting target is checking in low. </Empty>
          ) : (
            attention.atRisk.slice(0, 6).map((row, index) => (
              <PersonRow key={row.employeeId} row={row} index={index} />
            ))
          )}
        </Card>

        <Card
          chip="🤝"
          chipColour="var(--orange-tint-14)"
          title="Behind and under strain"
          subtitle="Missing target and checking in low — coaching alone won't fix it"
        >
          {attention.struggling.length === 0 ? (
            <Empty>Nobody behind target is checking in low.</Empty>
          ) : (
            attention.struggling.slice(0, 6).map((row, index) => (
              <PersonRow key={row.employeeId} row={row} index={index} />
            ))
          )}
        </Card>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, ID, role or sub-department…"
          aria-label="Search the sales roster"
        />

        <div className="chips" style={{ marginTop: 14 }}>
          <button
            className={`chip ${band === null ? 'chip--on' : ''}`}
            onClick={() => setBand(null)}
          >
            All on quota {judged}
          </button>
          {RANKED_BANDS.map((key) => (
            <button
              key={key}
              className={`chip ${band === key ? 'chip--on' : ''}`}
              onClick={() => setBand(key)}
            >
              {BAND_LABEL[key]} {counts[key] ?? 0}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {(['attainment', 'shortfall', 'mood'] as Sort[]).map((key) => (
            <button
              key={key}
              className={`chip ${sort === key ? 'chip--on' : ''}`}
              onClick={() => setSort(key)}
            >
              {SORT_LABEL[key]}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          {listed.length === 0 && (
            <Empty>
              {query.trim()
                ? `Nobody matches “${query.trim()}”. Try an ID, or clear the search.`
                : 'Nobody in this band.'}
            </Empty>
          )}
          {listed.map((row, index) => (
            <PersonRow key={row.employeeId} row={row} index={index} wide />
          ))}
        </div>

        {listed.length === PAGE_SIZE && (
          <p className="note">
            Showing the first {PAGE_SIZE}. Search, or pick a band, to narrow it down.
          </p>
        )}
      </section>

      <p className="note">
        Mood is shown beside performance, never folded into it — a low check-in never
        moves someone into a worse band. Individual records, under Infinity Learn&apos;s
        employee data policy.
      </p>

      {drill && (
        <PeopleDrawer
          title={drill.title}
          subtitle=""
          entries={drill.entries}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  )
}

function PersonRow({ row, index, wide }: { row: SalesRow; index: number; wide?: boolean }) {
  const attainment = row.attainment ?? 0
  const joined = joinedLabel(row.dateOfJoining)
  // Worth calling out: it is the reason this person is not in a performance band.
  const ramping = row.tenureMonths !== null && row.tenureMonths < RAMP_MONTHS
  return (
    <div className="row">
      <Avatar name={row.name} index={index} />
      <div className="row__main">
        <div className="row__title">{row.name}</div>
        <div className="row__meta">
          {row.subDepartment}
          {row.designation ? ` · ${row.designation}` : ''}
          {joined && ` · ${joined}`}
        </div>
        {ramping && (
          <div className="row__tags">
            <span className="tag tag--ramp">Ramping</span>
          </div>
        )}
        {wide && (
          <div className="track" style={{ marginTop: 6 }}>
            <div
              className="track__fill"
              style={{
                width: `${Math.min(attainment, 100)}%`,
                background: BAND_COLOUR[row.band],
              }}
            />
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', minWidth: 92 }}>
        <strong style={{ color: BAND_COLOUR[row.band] }}>
          {row.attainment === null ? '—' : `${Math.round(row.attainment)}%`}
        </strong>
        <div className="row__meta">
          {money(row.achieved)} of {money(row.target)}
        </div>
      </div>

      <MoodPill score={row.moodScore} responses={row.moodResponses} />
    </div>
  )
}

/**
 * How someone has been checking in, beside their numbers.
 *
 * Only two states are coloured, and neither is a verdict on the person: below
 * [STRAIN_BELOW] is marked because it is the threshold the attention cards above
 * already act on, and everything else is left neutral. A green-to-red ramp would
 * turn wellbeing into a second scoreboard, which is the one thing this screen must
 * not do — people stop answering honestly the moment their answers score them.
 */
function MoodPill({ score, responses }: { score: number | null; responses: number }) {
  if (score === null) {
    return (
      <span className="mood mood--none" title="No check-ins this period">
        <span className="mood__dot" />
        no data
      </span>
    )
  }
  const strained = score < STRAIN_BELOW
  return (
    <span
      className={`mood ${strained ? 'mood--low' : ''}`}
      title={`${responses} check-in${responses === 1 ? '' : 's'} this period`}
    >
      <span className="mood__dot" />
      {score.toFixed(1)}
      <span className="mood__scale">/10</span>
    </span>
  )
}

/** What each band actually means, so the number is not taken on faith. */
const RULE: Record<Band, string> = {
  HIGH: 'At or above target',
  MEDIUM: '70–99% of target',
  LOW: '40–69% of target',
  POOR: 'Under 40% of target',
  RAMPING: `Under ${RAMP_MONTHS} months in`,
  NO_QUOTA: 'No target this cycle',
}

const SORT_LABEL: Record<Sort, string> = {
  attainment: 'Best first',
  shortfall: 'Biggest gap',
  mood: 'Lowest mood',
}

const PAGE_SIZE = 40

/**
 * "Joined Feb 2026".
 *
 * A month anchors: "6 months in" makes the reader work out when that was, and gives
 * no sense of whether it covers the cycle being looked at. Ramping is called out
 * separately, so the duration itself no longer has to be read off this line.
 */
function joinedLabel(dateOfJoining: string | null): string {
  if (!dateOfJoining) return ''
  const date = new Date(`${dateOfJoining}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return `Joined ${date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
}

/** Indian grouping, which is what these figures are quoted in. */
function money(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
