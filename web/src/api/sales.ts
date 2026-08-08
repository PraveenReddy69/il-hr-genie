/**
 * Sales performance, banded.
 *
 * The banding is the whole point of this screen, so the rules are here rather than
 * buried in the page — and three of them are judgement calls worth stating plainly:
 *
 * 1. **Only quota-carriers are banded.** Two-thirds of the sales department carry no
 *    target in a given cycle. Scoring them on attainment would file ~690 people under
 *    "very poor" for the crime of not being on a plan. They are reported separately.
 *
 * 2. **New joiners ramp.** A quarter of the bottom band joined within three months.
 *    Judging someone's first fortnight against a full-cycle target says more about the
 *    target than the person, so they get their own status.
 *
 * 3. **Mood never lowers a band.** Wellbeing is shown beside performance, never folded
 *    into it. If a low mood could mark someone a poor performer, employees would stop
 *    answering honestly and the check-in data would be worth nothing — which would cost
 *    far more than this screen is worth. Mood is used only to flag who needs support.
 */

import { fetchEmployees, get } from './client'
import { MOODS, type MoodKey } from './types'

export interface SalesCycle {
  id: string
  name: string
  startDate: string
  endDate: string
}

/** One person's row, straight off the report. */
interface RawSalesRow {
  employee: {
    employeeId: string
    name: string
    department: string
    subDepartment?: string
    designation?: string
    officialEmail?: string
  }
  sales: {
    target: number
    achieved: number
    bookingCount: number
    conductionCount: number
  }
  mood: Record<MoodKey, number>
}

export interface SalesReport {
  totalEmployees: number
  rows: SalesRow[]
}

export type Band = 'HIGH' | 'MEDIUM' | 'LOW' | 'POOR' | 'RAMPING' | 'NO_QUOTA'

export interface SalesRow {
  employeeId: string
  name: string
  subDepartment: string
  designation: string
  /** Months since joining, or null when the directory has no date. */
  tenureMonths: number | null
  /** The joining date itself, so the UI can name a month rather than a duration. */
  dateOfJoining: string | null
  target: number
  achieved: number
  bookingCount: number
  conductionCount: number
  /** achieved / target as a percentage. Null when there is no target to measure against. */
  attainment: number | null
  band: Band
  /** 0..10 from their check-ins this period. Null when they never checked in. */
  moodScore: number | null
  moodResponses: number
}

export const BAND_LABEL: Record<Band, string> = {
  HIGH: 'High performing',
  MEDIUM: 'Medium performing',
  LOW: 'Low performing',
  POOR: 'Very poor performing',
  RAMPING: 'Still ramping',
  NO_QUOTA: 'No target set',
}

/** The four bands that are actually a performance judgement, best first. */
export const RANKED_BANDS: Band[] = ['HIGH', 'MEDIUM', 'LOW', 'POOR']

export const BAND_COLOUR: Record<Band, string> = {
  HIGH: 'var(--green-ok)',
  MEDIUM: 'var(--blue-primary)',
  LOW: 'var(--orange-warn)',
  POOR: 'var(--red-risk)',
  RAMPING: 'var(--purple)',
  NO_QUOTA: 'var(--text-muted)',
}

/** Attainment floors, in the order they are tested. */
const HIGH_FROM = 100
const MEDIUM_FROM = 70
const LOW_FROM = 40

/** Below this many months, a full-cycle target is not a fair measure. */
export const RAMP_MONTHS = 3

/** Mood at or below this reads as someone under strain. */
export const STRAIN_BELOW = 5.5

export function fetchSalesCycles(): Promise<SalesCycle[]> {
  return get<SalesCycle[]>('/api/sales-cycles')
}

/**
 * The report for one or more cycles, joined with the directory.
 *
 * The endpoint takes `salesCycleIds` as a list and returns one row per employee, so
 * selecting several cycles gives combined targets and achievement rather than a row
 * each — which is what makes the banding still mean something across a selection.
 *
 * The date range is the mood window, not the sales window, so it spans the whole
 * selection: earliest start to latest end. Narrowing it would score people on
 * check-ins from only part of the period being judged.
 *
 * The report carries no joining date, so tenure comes from `/api/employees` — which
 * is already memoised for the session, so this costs nothing extra.
 */
export async function fetchSalesReport(cycles: SalesCycle[]): Promise<SalesReport> {
  if (cycles.length === 0) return { totalEmployees: 0, rows: [] }

  const ids = cycles.map((one) => one.id).join(',')
  const startDate = cycles.reduce(
    (earliest, one) => (one.startDate < earliest ? one.startDate : earliest),
    cycles[0].startDate,
  )
  const endDate = cycles.reduce(
    (latest, one) => (one.endDate > latest ? one.endDate : latest),
    cycles[0].endDate,
  )

  const [raw, employees] = await Promise.all([
    get<{ totalEmployees: number; employees: RawSalesRow[] }>(
      `/api/sales-reports/report?salesCycleIds=${encodeURIComponent(ids)}` +
        `&startDate=${startDate}&endDate=${endDate}`,
    ),
    fetchEmployees(),
  ])

  const joined = new Map(employees.map((one) => [one.employeeId, one.dateOfJoining]))

  return {
    totalEmployees: raw.totalEmployees,
    rows: raw.employees.map((row) => toRow(row, joined.get(row.employee.employeeId))),
  }
}

function toRow(raw: RawSalesRow, dateOfJoining: string | undefined): SalesRow {
  const { target, achieved } = raw.sales
  const attainment = target > 0 ? (achieved / target) * 100 : null
  const tenureMonths = monthsSince(dateOfJoining)

  return {
    employeeId: raw.employee.employeeId,
    name: raw.employee.name,
    subDepartment: raw.employee.subDepartment ?? raw.employee.department,
    designation: raw.employee.designation ?? '',
    tenureMonths,
    dateOfJoining: dateOfJoining ?? null,
    target,
    achieved,
    bookingCount: raw.sales.bookingCount,
    conductionCount: raw.sales.conductionCount,
    attainment,
    band: bandFor(attainment, tenureMonths),
    moodScore: moodScoreOf(raw.mood),
    moodResponses: Object.values(raw.mood).reduce((total, n) => total + n, 0),
  }
}

/**
 * Ramping beats a poor band, but never a good one.
 *
 * A new joiner already over target has plainly earned it, and hiding that behind
 * "still ramping" would be the same unfairness in the other direction.
 */
function bandFor(attainment: number | null, tenureMonths: number | null): Band {
  if (attainment === null) return 'NO_QUOTA'
  if (attainment >= HIGH_FROM) return 'HIGH'
  if (tenureMonths !== null && tenureMonths < RAMP_MONTHS) return 'RAMPING'
  if (attainment >= MEDIUM_FROM) return 'MEDIUM'
  if (attainment >= LOW_FROM) return 'LOW'
  return 'POOR'
}

/** The same 0..10 scale the rest of the console uses, weighted by how often each mood was picked. */
function moodScoreOf(counts: Record<MoodKey, number>): number | null {
  let total = 0
  let weighted = 0
  ;(Object.keys(counts) as MoodKey[]).forEach((key) => {
    const n = counts[key]
    const value = MOODS[key]?.value
    if (!n || typeof value !== 'number') return
    total += n
    weighted += n * value
  })
  return total === 0 ? null : weighted / total
}

function monthsSince(dateOfJoining: string | undefined): number | null {
  if (!dateOfJoining) return null
  const joined = new Date(`${dateOfJoining}T00:00:00`)
  if (Number.isNaN(joined.getTime())) return null
  return (Date.now() - joined.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}

/**
 * People worth a conversation, and why.
 *
 * Deliberately two different lists: someone hitting target while burning out needs
 * retaining, someone missing target while struggling needs support. Collapsing them
 * into one "problem" list would lose the only thing that makes them actionable.
 */
export function attentionLists(rows: SalesRow[]) {
  const strained = (row: SalesRow) =>
    row.moodScore !== null && row.moodScore < STRAIN_BELOW && row.moodResponses > 0

  return {
    /** Delivering, but not okay. The retention risk. */
    atRisk: rows
      .filter((row) => row.band === 'HIGH' && strained(row))
      .sort((a, b) => (a.moodScore ?? 0) - (b.moodScore ?? 0)),
    /** Behind and under strain. Coaching alone will not fix this. */
    struggling: rows
      .filter((row) => (row.band === 'POOR' || row.band === 'LOW') && strained(row))
      .sort((a, b) => (a.moodScore ?? 0) - (b.moodScore ?? 0)),
  }
}
