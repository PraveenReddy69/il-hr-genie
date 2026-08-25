/**
 * Stand-in data until the backend is ready.
 *
 * Shaped like the real thing rather than prettied up: mood has gaps on days nobody
 * answered, one department has no responses at all, and the current pulse cycle is
 * half done. A console tuned on flawless data falls apart on the first real payload.
 *
 * Everything is derived from a fixed seed, so a reload shows the same fortnight.
 */

import { isConsoleRole } from './access'
import type { Celebrant, Celebrations } from './celebrations'
import { HOLIDAY_CALENDAR } from './holidays'
import type { PulseSelection } from './pulseProgramme'
import {
  FULL_DAY_MILLIS,
  MOODS,
  MOOD_KEYS,
  type AttendanceDay,
  type AttendanceStatus,
  type CategoryVolume,
  type ChatAnalytics,
  type ChatQuestion,
  type CycleSummary,
  type DayMood,
  type Employee,
  type EmployeeSummary,
  type EmployeeWeek,
  type Holiday,
  type HrStats,
  type MoodKey,
  type PersonEntry,
  type QuestionBreakdown,
  type Ticket,
  type TicketAnalytics,
  type TicketStatus,
  type WeekVolume,
} from './types'

// ------------------------------------------------------------------ directory

export const EMPLOYEES: Employee[] = [
  {
    employeeId: 'HYD609552',
    name: 'Aamy C P',
    title: 'Assistant Manager - HRBP',
    department: 'Human Resource & Administration',
    officialEmail: 'aamy.cp@example.com',
    role: 'EMPLOYEE',
    dateOfJoining: '2026-04-15',
    reportees: 0,
  },
  {
    employeeId: 'EMP3801',
    name: 'Gunapati Praveen Reddy',
    title: 'Tech Lead-2-Software Engineering',
    department: 'Experience',
    officialEmail: 'praveen.reddy@example.com',
    role: 'EMPLOYEE',
    dateOfJoining: '2025-10-27',
    reportees: 0,
  },
  {
    employeeId: 'HYD600902',
    name: 'Manikanteswar Patnaikuni',
    title: 'Tech Lead-1-Software Engineering',
    department: 'Experience',
    officialEmail: 'manikanteswar@example.com',
    role: 'EMPLOYEE',
    // Dated so a work anniversary falls inside the month-ahead window and the
    // Coming up list has something in it. Mock data exists to exercise the page.
    dateOfJoining: '2022-08-25',
    reportees: 0,
  },
  {
    employeeId: 'HYD600071',
    name: 'Mohd Faiyaz',
    title: 'Assistant Manager - Graphic Designer',
    department: 'Brand Marketing',
    officialEmail: 'faiyaz.md@example.com',
    role: 'EMPLOYEE',
    dateOfJoining: '2021-02-01',
    reportees: 2,
  },
  /*
   * Three console accounts, one per tier.
   *
   * The mock is the only place the Access page and the escalation rules can be
   * exercised before the backend lands, and none of them mean anything with a single
   * account: rule 2 needs somebody to outrank, rule 4 needs a Head who is the last one.
   *
   * HR000 is scoped to two departments deliberately. Organisation-wide is the easy case,
   * and it is the one both accounts below already cover.
   */
  {
    employeeId: 'HR000',
    name: 'Aamy C P',
    title: 'HR Business Partner',
    department: 'Human Resource & Administration',
    officialEmail: 'hr@infinitylearn.com',
    role: 'HR',
    departments: ['Experience', 'Brand Marketing'],
    dateOfJoining: '2019-06-01',
    reportees: 4,
  },
  {
    employeeId: 'HR001',
    name: 'Sneha Rao',
    title: 'HR Operations Admin',
    department: 'Human Resource & Administration',
    officialEmail: 'sneha.rao@infinitylearn.com',
    role: 'HR_ADMIN',
    dateOfJoining: '2018-03-12',
    reportees: 6,
  },
  {
    employeeId: 'HR002',
    name: 'Vikram Iyer',
    title: 'Head of People',
    department: 'Human Resource & Administration',
    officialEmail: 'vikram.iyer@infinitylearn.com',
    role: 'HR_HEAD',
    dateOfJoining: '2016-01-04',
    reportees: 12,
  },
]

/** HR accounts are not their own subject — they are excluded from every figure. */
export const WORKFORCE = EMPLOYEES.filter((e) => !isConsoleRole(e.role))

// -------------------------------------------------------------------- helpers

/** Mulberry32 — small, seeded, and identical across reloads. */
function seededRandom(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The local date, not the UTC one.
 *
 * `toISOString()` reports the previous day for any local time past the UTC offset —
 * every evening in IST — which made "today" a day early everywhere this is used: the
 * holiday countdown, today's check-in, the current pulse cycle.
 */
export function isoDate(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function currentCycle(offsetMonths = 0): string {
  const date = new Date()
  date.setMonth(date.getMonth() + offsetMonths)
  return date.toISOString().slice(0, 7)
}

function isWeekend(dateIso: string): boolean {
  const day = new Date(`${dateIso}T00:00:00`).getDay()
  return day === 0 || day === 6
}

// ------------------------------------------------------------- generated data

const TREND_DAYS = 14

/** employeeId -> dateIso -> mood, generated once so every view agrees. */
const moodLog: Record<string, Record<string, MoodKey>> = (() => {
  // Chosen, not arbitrary: this seed lands today on a spread of moods across
  // departments. A dashboard where every department reads the same score looks
  // broken rather than calm.
  const random = seededRandom(2026)
  const log: Record<string, Record<string, MoodKey>> = {}

  for (let ago = TREND_DAYS - 1; ago >= 0; ago--) {
    const date = isoDate(-ago)
    if (isWeekend(date)) continue

    WORKFORCE.forEach((employee, index) => {
      // Not everyone answers every day. The gaps are the honest part.
      if (random() < 0.28) return

      // A dip six to nine days back, recovering towards today, so the trend has a
      // shape worth reading rather than noise around a mean.
      const dip = ago >= 6 && ago <= 9
      const roll = random() * 100 - (dip ? 35 : 0)
      const mood: MoodKey =
        roll >= 70 ? 'GREAT'
        : roll >= 45 ? 'GOOD'
        : roll >= 20 ? 'OKAY'
        : roll >= 0 ? 'STRESSED'
        : index === 0 ? 'BURNT_OUT'
        : 'STRESSED'

      log[employee.employeeId] ??= {}
      log[employee.employeeId][date] = mood
    })
  }
  return log
})()

const PULSE_QUESTIONS = [
  {
    id: 'experience',
    text: 'How has your work experience been this month?',
    options: ['Genuinely good', 'Mostly fine', 'Up and down', 'Rough, honestly'],
  },
  {
    id: 'workload',
    text: 'Is your workload manageable right now?',
    options: ['Comfortable', 'Busy but okay', 'Stretched', 'Not sustainable'],
  },
  {
    id: 'manager',
    text: 'Do you feel supported by your manager?',
    options: ['Always', 'Usually', 'Sometimes', 'Rarely'],
  },
  {
    id: 'attrition',
    text: 'Have you thought about looking elsewhere recently?',
    options: ['Not at all', 'Passing thought', 'Somewhat', 'Actively looking'],
  },
]

/** cycle -> employeeId -> questionId -> answer */
const pulseLog: Record<string, Record<string, Record<string, string>>> = (() => {
  const random = seededRandom(9152026)
  const log: Record<string, Record<string, Record<string, string>>> = {}

  for (let back = 4; back >= 0; back--) {
    const cycle = currentCycle(-back)
    log[cycle] = {}
    WORKFORCE.forEach((employee, index) => {
      // The current cycle is deliberately half done — it is still running.
      if (back === 0 && index % 2 === 1) return
      if (back > 0 && random() < 0.2) return

      const answers: Record<string, string> = {}
      PULSE_QUESTIONS.forEach((question) => {
        answers[question.id] =
          question.options[Math.floor(random() * question.options.length)]
      })
      log[cycle][employee.employeeId] = answers
    })
  }
  return log
})()

let tickets: Ticket[] = (() => {
  const now = Date.now()
  const hour = 3600_000
  const seed: Array<[string, string, string, TicketStatus, number]> = [
    ['My salary got deducted without a reason', 'Payroll', 'EMP3801', 'IN_PROGRESS', 26],
    ['Can I carry forward unused earned leave?', 'Leave', 'HYD600902', 'OPEN', 20],
    ['No access to the design drive', 'IT & access', 'HYD600071', 'RESOLVED', 52],
    ['Add my spouse to the insurance policy', 'Insurance', 'HYD609552', 'OPEN', 8],
    ['Desk fan in the Hyderabad office is broken', 'Facilities', 'EMP3801', 'RESOLVED', 96],
  ]

  return seed.map(([subject, category, employeeId, status, agoHours], index) => {
    const createdAtMillis = now - agoHours * hour
    const comments =
      status === 'OPEN'
        ? []
        : [
            {
              status,
              text:
                status === 'RESOLVED'
                  ? 'Sorted and confirmed with the employee.'
                  : 'Picked this up — chasing the owning team today.',
              authorId: 'HR000',
              atMillis: createdAtMillis + 4 * hour,
            },
          ]
    return {
      id: `HRG-${String(index + 1).padStart(4, '0')}`,
      employeeId,
      subject,
      category,
      status,
      createdAtMillis,
      updatedAtMillis: comments.at(-1)?.atMillis ?? createdAtMillis,
      comments,
    }
  })
})()

// --------------------------------------------------------------------- reads

export function mockTickets(): Ticket[] {
  return [...tickets].sort((a, b) => b.createdAtMillis - a.createdAtMillis)
}

export function mockUpdateTicket(
  id: string,
  status: TicketStatus,
  comment: string,
  authorId: string,
): Ticket | null {
  const now = Date.now()
  let updated: Ticket | null = null

  tickets = tickets.map((ticket) => {
    if (ticket.id !== id) return ticket
    const note = comment.trim()
    updated = {
      ...ticket,
      status,
      updatedAtMillis: now,
      comments: note
        ? [...ticket.comments, { status, text: note, authorId, atMillis: now }]
        : ticket.comments,
    }
    return updated
  })
  return updated
}

/**
 * Hand a ticket to somebody, or take it back with null.
 *
 * Deliberately does not touch updatedAtMillis: handing a ticket over is not progress on
 * it, and letting an assignment reset the clock would make an ageing queue look fresh
 * every time somebody shuffled it.
 */
export function mockAssignTicket(id: string, assigneeId: string | null): Ticket | null {
  let updated: Ticket | null = null
  tickets = tickets.map((ticket) => {
    if (ticket.id !== id) return ticket
    updated = { ...ticket, assigneeId }
    return updated
  })
  return updated
}

/**
 * Today's celebrations, derived from the same directory the rest of the mock uses.
 *
 * Anniversaries and joiners come out of `dateOfJoining` so they stay consistent with
 * the month-ahead list. Birthdays are invented here because nothing in the directory
 * could produce them — which is exactly the gap the real endpoint fills.
 */
export function mockCelebrations(): Celebrations {
  const today = isoDate()

  const asCelebrant = (employee: Employee, years?: number): Celebrant => ({
    name: employee.name,
    employeeId: employee.employeeId,
    designation: employee.title,
    email: employee.officialEmail,
    department: employee.department,
    ...(years === undefined ? {} : { years }),
  })

  const anniversaries: Celebrant[] = []
  const newJoiners: Celebrant[] = []

  for (const employee of WORKFORCE) {
    const joined = employee.dateOfJoining
    if (!joined) continue
    if (joined.slice(5) === today.slice(5) && joined < today) {
      anniversaries.push(
        asCelebrant(employee, Number(today.slice(0, 4)) - Number(joined.slice(0, 4))),
      )
    }
    const ago = Math.round(
      (new Date(`${today}T00:00:00`).getTime() - new Date(`${joined}T00:00:00`).getTime()) /
        86_400_000,
    )
    if (ago >= 0 && ago <= 30) newJoiners.push(asCelebrant(employee))
  }

  // One birthday, so the page has all three kinds to lay out. The real endpoint is the
  // only thing that can know this.
  const birthdays = WORKFORCE.length > 0 ? [asCelebrant(WORKFORCE[0])] : []

  return { birthdays, anniversaries, newJoiners }
}

/*
 * Holidays and the pulse, held in memory for the mock.
 *
 * The console writes through the API now, so without these the mock is read-only and
 * the whole offline path — demos, and every check made without a token — stops being
 * able to exercise the pages it exists to exercise.
 *
 * Deliberately not localStorage. That is what these pages used to be, and a store that
 * outlives a reload would quietly become a second source of truth again.
 */
let holidayRows: Holiday[] = HOLIDAY_CALENDAR.map((one, index) => ({
  ...one,
  id: `h${index + 1}`,
}))
let nextHolidayId = holidayRows.length + 1

export function mockHolidayList(year: number): Holiday[] {
  return holidayRows.filter((one) => one.isoDate.startsWith(String(year)))
}

export function mockHolidayYears(): number[] {
  return [...new Set(holidayRows.map((one) => Number(one.isoDate.slice(0, 4))))].sort(
    (a, b) => a - b,
  )
}

export function mockCreateHoliday(draft: Omit<Holiday, 'id'>): Holiday {
  const created = { ...draft, id: `h${nextHolidayId++}` }
  holidayRows = [...holidayRows, created]
  return created
}

export function mockUpdateHoliday(id: string, patch: Partial<Holiday>): Holiday {
  let updated: Holiday | null = null
  holidayRows = holidayRows.map((one) => {
    if (one.id !== id) return one
    updated = { ...one, ...patch, id }
    return updated
  })
  if (!updated) throw new Error(`No holiday ${id}`)
  return updated
}

export function mockDeleteHoliday(id: string): void {
  if (!holidayRows.some((one) => one.id === id)) throw new Error(`No holiday ${id}`)
  holidayRows = holidayRows.filter((one) => one.id !== id)
}

let mockSelections: PulseSelection[] = []
let nextSelectionId = 1

export function mockSelectionList(): PulseSelection[] {
  return mockSelections
}

export function mockCreateSelection(selection: PulseSelection): PulseSelection {
  const created = { ...selection, id: `sel-${nextSelectionId++}` }
  mockSelections = [...mockSelections, created]
  return created
}

export function mockUpdateSelection(id: string, selection: PulseSelection): PulseSelection {
  const updated = { ...selection, id }
  mockSelections = mockSelections.map((one) => (one.id === id ? updated : one))
  return updated
}

export function mockDeleteSelection(id: string): void {
  mockSelections = mockSelections.filter((one) => one.id !== id)
}

function moodsOn(dateIso: string): { employee: Employee; mood: MoodKey }[] {
  return WORKFORCE.flatMap((employee) => {
    const mood = moodLog[employee.employeeId]?.[dateIso]
    return mood ? [{ employee, mood }] : []
  })
}

function averageScore(entries: { mood: MoodKey }[]): number | null {
  if (entries.length === 0) return null
  const total = entries.reduce((sum, entry) => sum + MOODS[entry.mood].value, 0)
  return total / entries.length
}

export function mockStats(): HrStats {
  const today = isoDate()
  const todays = moodsOn(today)
  const cycle = currentCycle()

  const breakdown = Object.fromEntries(
    MOOD_KEYS.map((key) => [key, todays.filter((entry) => entry.mood === key).length]),
  ) as Record<MoodKey, number>

  const departments = [...new Set(WORKFORCE.map((e) => e.department))].map((name) => {
    const members = WORKFORCE.filter((e) => e.department === name)
    const answered = todays.filter((entry) => entry.employee.department === name)
    return {
      name,
      headcount: members.length,
      responses: answered.length,
      score: averageScore(answered),
    }
  })

  const live = mockTickets()
  return {
    headcount: WORKFORCE.length,
    checkedInToday: Math.min(WORKFORCE.length, todays.length + 1),
    onTheClock: Math.max(0, todays.length - 1),
    moodResponsesToday: todays.length,
    engagementScore: averageScore(todays),
    moodBreakdown: breakdown,
    pulseCompleted: Object.keys(pulseLog[cycle] ?? {}).length,
    departments: departments.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    weekPresent: 14,
    weekHalfDays: 1,
    weekMisPunches: 1,
    weekAbsences: 2,
    weekHoursMillis: 118 * 3600_000,
    ticketsOpen: live.filter((t) => t.status === 'OPEN').length,
    ticketsInProgress: live.filter((t) => t.status === 'IN_PROGRESS').length,
    ticketsResolved: live.filter((t) => t.status === 'RESOLVED').length,
  }
}

export function mockMoodHistory(): DayMood[] {
  return Array.from({ length: TREND_DAYS }, (_, index) => {
    const date = isoDate(-(TREND_DAYS - 1 - index))
    const entries = moodsOn(date)
    return { dateIso: date, responses: entries.length, score: averageScore(entries) }
  })
}

export function mockPulseHistory(): CycleSummary[] {
  return Array.from({ length: 6 }, (_, index) => {
    const cycle = currentCycle(-(5 - index))
    return {
      cycle,
      completed: Object.keys(pulseLog[cycle] ?? {}).length,
      headcount: WORKFORCE.length,
    }
  })
}

export function mockPulseBreakdown(cycle: string): QuestionBreakdown[] {
  const entries = Object.values(pulseLog[cycle] ?? {})
  return PULSE_QUESTIONS.map((question) => ({
    questionId: question.id,
    question: question.text,
    answers: question.options.map((option) => ({
      option,
      count: entries.filter((answers) => answers[question.id] === option).length,
    })),
  }))
}

// --------------------------------------------------------------- drill-downs

export function mockMoodDetail(dateIso: string): PersonEntry[] {
  return WORKFORCE.map((employee) => {
    const mood = moodLog[employee.employeeId]?.[dateIso]
    const detail = mood ? MOODS[mood] : null
    return {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      subtitle: detail ? employee.title : 'Has not checked in',
      value: detail ? `${detail.emoji} ${detail.label}` : '—',
      tone: !detail
        ? ('MUTED' as const)
        : detail.value >= 8
          ? ('POSITIVE' as const)
          : detail.value <= 4
            ? ('WARNING' as const)
            : ('NEUTRAL' as const),
    }
  }).sort((a, b) => Number(a.tone === 'MUTED') - Number(b.tone === 'MUTED'))
}

export function mockPulseDetail(cycle: string): PersonEntry[] {
  return WORKFORCE.map((employee) => {
    const answers = pulseLog[cycle]?.[employee.employeeId]
    return {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      subtitle: answers
        ? `${Object.keys(answers).length} of ${PULSE_QUESTIONS.length} answered`
        : employee.department,
      value: answers ? 'Done' : 'Pending',
      tone: answers ? ('POSITIVE' as const) : ('MUTED' as const),
      breakdown: answers
        ? PULSE_QUESTIONS.map((question) => ({
            label: question.text,
            value: answers[question.id] ?? 'Skipped',
          }))
        : undefined,
    }
  }).sort((a, b) => Number(a.tone === 'MUTED') - Number(b.tone === 'MUTED'))
}

export function employeeName(employeeId: string): string {
  return EMPLOYEES.find((e) => e.employeeId === employeeId)?.name ?? employeeId
}

// ----------------------------------------------------------------- analytics

/**
 * ⚠️ The chat half of this has no real source yet.
 *
 * Ticket figures below are computed from the actual ticket list, so they are true.
 * The question log is invented: nothing in the app records what employees ask HR
 * Genie, so until the backend starts logging queries this card is illustrative.
 * See the note on the analytics page — it says so on screen rather than passing
 * these off as measured.
 */
const CHAT_LOG: ChatQuestion[] = [
  { question: 'How many leaves do I have left?', asks: 34, answered: 32, escalated: 2 },
  { question: 'When does my reimbursement land?', asks: 21, answered: 12, escalated: 9 },
  { question: 'What does my insurance cover?', asks: 19, answered: 18, escalated: 1 },
  { question: 'Can I carry forward unused earned leave?', asks: 14, answered: 5, escalated: 9 },
  { question: 'Explain the WFH policy', asks: 12, answered: 11, escalated: 1 },
  { question: 'How do I claim relocation expenses?', asks: 9, answered: 2, escalated: 7 },
  { question: 'When is the next appraisal cycle?', asks: 8, answered: 3, escalated: 5 },
]

export function mockChatAnalytics(): ChatAnalytics {
  const sum = (pick: (question: ChatQuestion) => number) =>
    CHAT_LOG.reduce((total, question) => total + pick(question), 0)

  return {
    questionsAsked: sum((question) => question.asks),
    answeredByKb: sum((question) => question.answered),
    escalatedToTickets: sum((question) => question.escalated),
    topQuestions: [...CHAT_LOG].sort((a, b) => b.asks - a.asks),
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/** Time from raised to the note that closed it. */
function resolutionMillis(ticket: Ticket): number | null {
  const closed = [...ticket.comments].reverse().find((entry) => entry.status === 'RESOLVED')
  return closed ? closed.atMillis - ticket.createdAtMillis : null
}

export function mockTicketAnalytics(): TicketAnalytics {
  const all = mockTickets()
  const resolutions = all.map(resolutionMillis).filter((value): value is number => value !== null)

  const categories = [...new Set(all.map((ticket) => ticket.category))]
  const byCategory: CategoryVolume[] = categories
    .map((category) => {
      const inCategory = all.filter((ticket) => ticket.category === category)
      return {
        category,
        raised: inCategory.length,
        open: inCategory.filter((ticket) => ticket.status !== 'RESOLVED').length,
        medianResolutionMillis: median(
          inCategory.map(resolutionMillis).filter((value): value is number => value !== null),
        ),
      }
    })
    .sort((a, b) => b.raised - a.raised)

  // Six weeks back, oldest first, so the trend reads left to right.
  const volume: WeekVolume[] = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(`${weekStart(-(5 - index))}T00:00:00`).getTime()
    const end = start + 7 * 86_400_000
    return {
      weekStartIso: weekStart(-(5 - index)),
      raised: all.filter(
        (ticket) => ticket.createdAtMillis >= start && ticket.createdAtMillis < end,
      ).length,
      resolved: all.filter((ticket) => {
        const at = resolutionMillis(ticket)
        return at !== null && ticket.createdAtMillis + at >= start &&
          ticket.createdAtMillis + at < end
      }).length,
    }
  })

  return {
    raised: all.length,
    resolved: all.filter((ticket) => ticket.status === 'RESOLVED').length,
    medianResolutionMillis: median(resolutions),
    byCategory,
    volume,
  }
}

// ---------------------------------------------------------------- attendance

/** employeeId -> dateIso -> punches. A null checkOut is a shift left open. */
const attendanceLog: Record<string, Record<string, { in: number; out: number | null }>> =
  (() => {
    const random = seededRandom(4071)
    const log: Record<string, Record<string, { in: number; out: number | null }>> = {}

    // Four weeks back, so paging through the weeks finds data rather than blanks.
    for (let ago = 27; ago >= 0; ago--) {
      const date = isoDate(-ago)
      if (isWeekend(date)) continue

      WORKFORCE.forEach((employee) => {
        // A few genuine absences, so the roll-up has something to follow up.
        if (random() < 0.08) return

        const start = new Date(`${date}T09:00:00`).getTime() + Math.floor(random() * 50) * 60_000
        const roll = random()
        const worked =
          roll < 0.08
            ? 4.5 * 3600_000 // a short day
            : (8 + random()) * 3600_000

        // One shift a fortnight is left open — the missed-punch case.
        const forgot = random() < 0.04
        log[employee.employeeId] ??= {}
        log[employee.employeeId][date] = {
          in: start,
          out: forgot ? null : start + worked,
        }
      })
    }
    return log
  })()

/** Monday of the week [weekOffset] weeks from the current one. */
/**
 * These format the local date, not the UTC one.
 *
 * `toISOString()` reports the previous day for any local time before the UTC offset
 * — every evening in IST — which put the whole attendance grid a day out and landed
 * Saturday's check-in under Friday's column.
 */
function isoOf(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function weekStart(weekOffset = 0): string {
  const date = new Date()
  const monday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - monday + weekOffset * 7)
  return isoOf(date)
}

export function weekDates(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${mondayIso}T00:00:00`)
    date.setDate(date.getDate() + index)
    return isoOf(date)
  })
}

/**
 * Applies the same rules as the Android app.
 *
 * The one that matters: an open shift is capped at the end of its own day, and once
 * that day has passed it becomes a missed punch rather than an ever-growing shift.
 */
function dayFor(employeeId: string, date: string, today: string, now: number): AttendanceDay {
  const record = attendanceLog[employeeId]?.[date]
  const holiday = HOLIDAYS.find((entry) => entry.isoDate === date)
  const dayEnd = new Date(`${date}T23:59:59.999`).getTime()

  const worked = !record
    ? 0
    : (record.out ?? Math.min(now, dayEnd)) - record.in

  const status: AttendanceStatus =
    isWeekend(date) ? 'WEEK_OFF'
    : holiday ? 'HOLIDAY'
    : !record ? (date < today ? 'ABSENT' : 'PENDING')
    : record.out === null && now > dayEnd ? 'MIS_PUNCH'
    : record.out === null ? 'IN_PROGRESS'
    : worked >= FULL_DAY_MILLIS ? 'PRESENT'
    : 'HALF_DAY'

  return {
    dateIso: date,
    status,
    checkInMillis: record?.in ?? null,
    checkOutMillis: record?.out ?? null,
    workedMillis: status === 'MIS_PUNCH' ? 0 : Math.max(0, worked),
    holidayName: holiday?.name,
  }
}

export function mockAttendanceWeek(mondayIso: string): EmployeeWeek[] {
  const today = isoDate()
  const now = Date.now()
  const dates = weekDates(mondayIso)

  return WORKFORCE.map((employee) => {
    const days = dates.map((date) => dayFor(employee.employeeId, date, today, now))
    return {
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      days,
      totalMillis: days.reduce((sum, day) => sum + day.workedMillis, 0),
    }
  })
}

// ------------------------------------------------------------------ holidays

/**
 * The published 2026 calendar, matching the Android app's list so both surfaces
 * agree. Optional days are the ones employees pick from; the rest are fixed under
 * the National and Festival Holidays Act.
 */
/** Re-exported so this module's own seeding can reference the real calendar. */
const HOLIDAYS: Holiday[] = HOLIDAY_CALENDAR


/** Superseded by mockHolidayList, which reads the store the mock writes into. */
export function mockHolidays(year: number): Holiday[] {
  return mockHolidayList(year)
}

// ----------------------------------------------------------------- directory

export function mockEmployees(): Employee[] {
  return [...EMPLOYEES].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * An employee with their HR Genie activity attached.
 *
 * HR accounts report no activity of their own — they are not subjects of the
 * programme, so their figures would be meaningless rather than zero.
 */
export function mockEmployeeSummary(employeeId: string): EmployeeSummary | null {
  const employee = EMPLOYEES.find((candidate) => candidate.employeeId === employeeId)
  if (!employee) return null

  const raised = tickets.filter((ticket) => ticket.employeeId === employeeId)
  const checkInDays = Object.keys(moodLog[employeeId] ?? {}).length

  return {
    employee,
    moodToday: moodLog[employeeId]?.[isoDate()] ?? null,
    pulseCompleted: Boolean(pulseLog[currentCycle()]?.[employeeId]),
    ticketsOpen: raised.filter((ticket) => ticket.status !== 'RESOLVED').length,
    ticketsTotal: raised.length,
    checkInDays,
    trendDays: TREND_DAYS,
  }
}

export function mockEmployeeTickets(employeeId: string): Ticket[] {
  return mockTickets().filter((ticket) => ticket.employeeId === employeeId)
}
