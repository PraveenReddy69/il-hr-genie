/**
 * The monthly pulse question bank, and who each question is asked of.
 *
 * The server has `GET /api/pulse/questions` and nothing else — no create, no update,
 * no delete, and no department on a question. So authoring lives in this browser
 * until the backend grows the four routes in docs/PULSE_QUESTIONS_BACKEND.md, and the
 * page says so rather than pretending it saved to a server.
 *
 * The live bank is still read and used as the starting point, so HR edits what
 * employees are actually being asked rather than a fresh mock.
 */

import { get, isLive } from './client'
import { currentCycle } from './mock'

export interface PulseQuestion {
  /**
   * Stable for the life of the question.
   *
   * Answers are stored keyed by it, so changing an id silently orphans every answer
   * ever given. Generated once, on create, and never rewritten by an edit.
   */
  id: string
  question: string
  /** The line under the question. Optional — most questions do not need one. */
  hint: string
  options: string[]
  /** Empty means everyone. Otherwise only these departments are asked. */
  departments: string[]
}

/**
 * The cap, and the reason for it.
 *
 * A pulse is answered on a phone, in a chat window, once a month. Past about ten
 * questions people stop reading and start tapping the first option, which is worse
 * than not asking — the numbers still look like data.
 */
export const MAX_QUESTIONS = 10
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 6
export const MAX_QUESTION_LENGTH = 120
export const MAX_OPTION_LENGTH = 32

/** Ready-made answer scales, because most questions want one of these. */
export const SCALES: { label: string; options: string[] }[] = [
  { label: 'Agreement', options: ['Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree'] },
  { label: 'Frequency', options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'] },
  { label: 'How it is going', options: ['Genuinely good', 'Mostly fine', 'Up and down', 'Rough, honestly'] },
  { label: 'Yes or no', options: ['Yes', 'No'] },
]

const STORAGE_KEY = 'hr-genie-pulse-bank'
const SCHEMA = 1

/** What the server returns today. No hint, no departments. */
interface RawQuestion {
  id: string
  question: string
  options: string[]
}

/** The bank, and where it came from — the page has to be honest about that. */
export interface Bank {
  questions: PulseQuestion[]
  /** True once HR has edited it here and the server has no idea. */
  unsaved: boolean
}

export async function fetchQuestionBank(): Promise<Bank> {
  const local = readLocal()
  if (local) return { questions: local, unsaved: true }
  return { questions: await fetchLiveBank(), unsaved: false }
}

/** Whatever employees are being asked right now, adapted to the fuller shape. */
async function fetchLiveBank(): Promise<PulseQuestion[]> {
  if (!isLive) return DEFAULTS.map((question) => ({ ...question }))
  try {
    const raw = await get<{ questions: RawQuestion[] }>('/api/pulse/questions')
    return (raw.questions ?? []).slice(0, MAX_QUESTIONS).map((question) => ({
      id: question.id,
      question: question.question,
      hint: '',
      options: question.options ?? [],
      departments: [],
    }))
  } catch {
    // A bank that will not load is not a reason to block authoring — start from the
    // same defaults the mock uses and let HR see the failure in the banner.
    return DEFAULTS.map((question) => ({ ...question }))
  }
}

export function saveQuestionBank(questions: PulseQuestion[]): void {
  const problem = validateBank(questions)
  if (problem) throw new Error(problem)
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), questions }),
  )
}

/** Throws away local edits and goes back to what the server is serving. */
export function discardLocalBank(): void {
  localStorage.removeItem(STORAGE_KEY)
}

function readLocal(): PulseQuestion[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { schema?: number; questions?: PulseQuestion[] }
    if (parsed.schema !== SCHEMA || !Array.isArray(parsed.questions)) return null
    return parsed.questions
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ validation

/**
 * Checked here rather than only in the form, so a disabled button is not the only
 * thing standing between a half-written question and the bank.
 */
export function validateQuestion(question: PulseQuestion): string | null {
  const text = question.question.trim()
  if (!text) return 'Write the question first.'
  if (text.length > MAX_QUESTION_LENGTH) {
    return `Keep it under ${MAX_QUESTION_LENGTH} characters — it is read on a phone.`
  }

  const options = question.options.map((option) => option.trim()).filter(Boolean)
  if (options.length < MIN_OPTIONS) return `Give at least ${MIN_OPTIONS} answers to choose from.`
  if (options.length > MAX_OPTIONS) return `That is more than ${MAX_OPTIONS} answers.`
  if (options.some((option) => option.length > MAX_OPTION_LENGTH)) {
    return `Keep each answer under ${MAX_OPTION_LENGTH} characters.`
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    return 'Two answers are the same.'
  }
  return null
}

export function validateBank(questions: PulseQuestion[]): string | null {
  if (questions.length > MAX_QUESTIONS) return `A pulse is capped at ${MAX_QUESTIONS} questions.`
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    return 'Two questions share an id.'
  }
  for (const question of questions) {
    const problem = validateQuestion(question)
    if (problem) return problem
  }
  return null
}

// --------------------------------------------------------------------- helpers

export function blankQuestion(): PulseQuestion {
  return { id: '', question: '', hint: '', options: [...SCALES[0].options], departments: [] }
}

/**
 * An id from the wording, once.
 *
 * Readable in the answer payload — `{"workload": "Stretched"}` beats a uuid when
 * someone is reading a row in the database at 9pm.
 */
export function newQuestionId(text: string, taken: string[]): string {
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .split('-')
      .filter((word) => word.length > 2)
      .slice(0, 3)
      .join('-') || 'question'
  if (!taken.includes(slug)) return slug
  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (!taken.includes(`${slug}-${suffix}`)) return `${slug}-${suffix}`
  }
  return `${slug}-${taken.length}`
}

/** What one department is asked: its own questions plus everyone's. */
export function questionsFor(questions: PulseQuestion[], department: string): PulseQuestion[] {
  return questions.filter(
    (question) => question.departments.length === 0 || question.departments.includes(department),
  )
}

export function departmentLabel(departments: string[]): string {
  if (departments.length === 0) return 'Everyone'
  if (departments.length === 1) return departments[0]
  return `${departments.length} departments`
}

/** The cycle this bank will be asked in — pulses are monthly. */
export function nextCycleLabel(): string {
  const [year, month] = currentCycle().split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

/** The bank the mock serves, so the page has something real to edit offline. */
const DEFAULTS: PulseQuestion[] = [
  {
    id: 'experience',
    question: 'How has your work experience been this month?',
    hint: '',
    options: ['Genuinely good', 'Mostly fine', 'Up and down', 'Rough, honestly'],
    departments: [],
  },
  {
    id: 'workload',
    question: 'Is your workload manageable right now?',
    hint: 'Think about the last two weeks rather than today.',
    options: ['Comfortable', 'Busy but okay', 'Stretched', 'Not sustainable'],
    departments: [],
  },
  {
    id: 'manager',
    question: 'Do you feel supported by your manager?',
    hint: '',
    options: ['Always', 'Usually', 'Sometimes', 'Rarely'],
    departments: [],
  },
  {
    id: 'attrition',
    question: 'Have you thought about looking elsewhere recently?',
    hint: '',
    options: ['Not at all', 'Passing thought', 'Somewhat', 'Actively looking'],
    departments: [],
  },
]
