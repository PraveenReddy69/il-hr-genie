/**
 * Mirrors docs/API_SCHEMA.md field for field.
 *
 * When the backend lands, only src/api/client.ts changes — these shapes are the
 * contract both the Android app and this console are written against.
 */

import type { Permission } from './access'

/**
 * Ordered, not a set of flags — see docs/ACCESS_CONTROL.md.
 *
 * HR is an HRBP scoped to their own departments; HR_ADMIN and HR_HEAD read the whole
 * organisation. Every check is a rank comparison, which is what keeps three tiers from
 * becoming fifteen booleans nobody can reason about.
 */
export type Role = 'EMPLOYEE' | 'HR' | 'HR_ADMIN' | 'HR_HEAD'

export interface Employee {
  employeeId: string
  name: string
  title: string
  department: string
  officialEmail: string
  role: Role
  /**
   * The departments this account may read. Empty on HR_ADMIN and HR_HEAD, meaning the
   * whole organisation; empty on an HR account means no access at all, which is the
   * correct failure for an HRBP nobody has assigned yet.
   */
  departments?: string[]
  /**
   * Effective permissions, already resolved by the server from the role bundle plus any
   * per-person grants. Absent while the backend predates access control, in which case
   * the bundle in access.ts stands in — see permissionsOf.
   */
  permissions?: Permission[]
  /** ISO-8601. Optional so a thin directory response still satisfies the type. */
  dateOfJoining?: string
  /** People reporting to them; drives the manager badge. */
  reportees?: number
  /**
   * The HR account tagged as this employee's HRBP, if the directory names one.
   *
   * Not populated today — the directory has no such field. Read where it exists so
   * that assignment can suggest the right person the day it does, rather than needing
   * a second pass then.
   */
  hrbpId?: string
}

/**
 * One employee with their HR Genie activity attached.
 *
 * Deliberately work-facing: check-in, pulse and tickets. Personal fields the HRMS
 * holds — mobile, date of birth, marital status — are not fetched here. This console
 * is for running the sentiment programme, not for browsing personnel records.
 */
export interface EmployeeSummary {
  employee: Employee
  /** Today's check-in, or null if they have not shared. */
  moodToday: MoodKey | null
  pulseCompleted: boolean
  ticketsOpen: number
  ticketsTotal: number
  /** Days they checked in over the trend window. */
  checkInDays: number
  trendDays: number
}

// ------------------------------------------------------------------- tickets

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'

export interface TicketComment {
  status: TicketStatus
  text: string
  authorId: string
  atMillis: number
}

export interface Ticket {
  id: string
  employeeId: string
  subject: string
  category: string
  status: TicketStatus
  createdAtMillis: number
  updatedAtMillis: number
  comments: TicketComment[]
  /**
   * The HR account dealing with this, if anyone.
   *
   * Null or absent means nobody has picked it up, and it sits in the queue of every
   * HRBP covering the raiser's department. Set, it belongs to one person — see
   * visibleTo in ticketQueue.ts, where that narrowing is the whole point.
   */
  assigneeId?: string | null
}

export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED']

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
}

// ---------------------------------------------------------------------- mood

export type MoodKey = 'GREAT' | 'GOOD' | 'OKAY' | 'STRESSED' | 'BURNT_OUT'

/** Emoji, label and the 0..10 value the engagement score averages. */
export const MOODS: Record<MoodKey, { emoji: string; label: string; value: number }> = {
  GREAT: { emoji: '😊', label: 'Great', value: 9 },
  GOOD: { emoji: '🙂', label: 'Good', value: 8 },
  OKAY: { emoji: '😐', label: 'Okay', value: 6 },
  STRESSED: { emoji: '😔', label: 'Stressed', value: 4 },
  BURNT_OUT: { emoji: '😣', label: 'Burnt out', value: 3 },
}

export const MOOD_KEYS: MoodKey[] = ['GREAT', 'GOOD', 'OKAY', 'STRESSED', 'BURNT_OUT']

// ------------------------------------------------------------------ HR stats

export interface DepartmentMood {
  name: string
  headcount: number
  responses: number
  /** 0..10, null when nobody in the department has checked in. */
  score: number | null
}

export interface HrStats {
  headcount: number
  checkedInToday: number
  onTheClock: number
  moodResponsesToday: number
  /** null until someone checks in — the console renders an em dash, never a zero. */
  engagementScore: number | null
  moodBreakdown: Record<MoodKey, number>
  pulseCompleted: number
  departments: DepartmentMood[]
  weekPresent: number
  weekHalfDays: number
  weekMisPunches: number
  weekAbsences: number
  weekHoursMillis: number
  ticketsOpen: number
  ticketsInProgress: number
  ticketsResolved: number
}

/** The cohort floor from the handoff: below this, nothing is reported. */
export const MIN_COHORT = 5

// ------------------------------------------------------------------- history

export interface DayMood {
  dateIso: string
  responses: number
  score: number | null
}

export interface CycleSummary {
  cycle: string
  completed: number
  headcount: number
}

export interface QuestionBreakdown {
  questionId: string
  question: string
  /** Option to how many chose it, in the order the options are offered. */
  answers: { option: string; count: number }[]
}

// ----------------------------------------------------------------- analytics

/** One thing employees keep asking HR Genie. */
export interface ChatQuestion {
  question: string
  asks: number
  /** Answered from the policy library without a ticket. */
  answered: number
  /** Ended up raised with HR instead. */
  escalated: number
}

/**
 * A question the handbook cannot answer: most of the time it is asked, it ends up
 * as a ticket. That is a policy gap, not a chatbot failure.
 */
export const POLICY_GAP_RATIO = 0.4

export interface ChatAnalytics {
  questionsAsked: number
  answeredByKb: number
  escalatedToTickets: number
  topQuestions: ChatQuestion[]
}

export interface CategoryVolume {
  category: string
  raised: number
  open: number
  /** null when nothing in the category has been resolved yet. */
  medianResolutionMillis: number | null
}

export interface WeekVolume {
  weekStartIso: string
  raised: number
  resolved: number
}

export interface TicketAnalytics {
  raised: number
  resolved: number
  medianResolutionMillis: number | null
  byCategory: CategoryVolume[]
  volume: WeekVolume[]
}

// ---------------------------------------------------------------- attendance

/** Mirrors the Android app's AttendanceStatus, codes and all. */
export type AttendanceStatus =
  | 'PRESENT'
  | 'HALF_DAY'
  | 'MIS_PUNCH'
  | 'ABSENT'
  | 'WEEK_OFF'
  | 'HOLIDAY'
  | 'IN_PROGRESS'
  | 'PENDING'

export const ATTENDANCE_CODE: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  HALF_DAY: 'HD',
  MIS_PUNCH: 'MIS',
  ABSENT: 'A',
  WEEK_OFF: 'WO',
  HOLIDAY: 'H',
  IN_PROGRESS: 'IN',
  PENDING: '--',
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Full day',
  HALF_DAY: 'Half day',
  MIS_PUNCH: 'Missed punch',
  ABSENT: 'Absent',
  WEEK_OFF: 'Week off',
  HOLIDAY: 'Holiday',
  IN_PROGRESS: 'On the clock',
  PENDING: 'Pending',
}

export interface AttendanceDay {
  dateIso: string
  status: AttendanceStatus
  checkInMillis: number | null
  checkOutMillis: number | null
  workedMillis: number
  holidayName?: string
}

/** One employee's week, in the order the days fall (Monday first). */
export interface EmployeeWeek {
  employeeId: string
  name: string
  department: string
  days: AttendanceDay[]
  totalMillis: number
}

/** A full day is eight hours; a full week is five of them. */
export const FULL_DAY_MILLIS = 8 * 3600_000
export const FULL_WEEK_MILLIS = FULL_DAY_MILLIS * 5

// ------------------------------------------------------------------ holidays

/**
 * Per the leave policy: eight fixed paid holidays a year, plus a small number of
 * optional ones the employee chooses from a published list.
 */
export type HolidayKind = 'FIXED' | 'OPTIONAL'

export interface Holiday {
  /**
   * The server's own id, absent on the built-in list the mock serves.
   *
   * Editing needs one: date plus region is unique but is also exactly what an edit
   * changes, so moving a holiday by a day without an id is a delete and a create, and
   * the audit trail shows two unrelated events instead of one correction.
   */
  id?: string
  name: string
  isoDate: string
  kind: HolidayKind
  /** Where it applies. Fixed holidays are set by state under the Act. */
  region: string
}

// ---------------------------------------------------------------- drill-downs

export type EntryTone = 'NEUTRAL' | 'POSITIVE' | 'WARNING' | 'MUTED'

/** One person behind a headline figure. */
export interface PersonEntry {
  employeeId: string
  name: string
  department: string
  subtitle: string
  value: string
  tone: EntryTone
  /** Label/value pairs revealed when the row is expanded, e.g. pulse answers. */
  breakdown?: { label: string; value: string }[]
}
