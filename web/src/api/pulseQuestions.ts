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
import { MAX_BANK, normaliseTags } from './pulseProgramme'

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
  /**
   * What the question is about, normalised — see normaliseTag.
   *
   * Free text rather than a fixed list, unlike holiday regions: whoever writes a
   * question should be able to name what it covers without asking anyone. Normalising
   * is what stops "Work Load", "workload" and "work load " becoming three tags that
   * filter to three different sets.
   */
  tags: string[]
}

/**
 * The cap on one *selection*, re-exported from where it is defined.
 *
 * It used to cap the bank, which meant an eleventh question could only be written by
 * deleting one that was working. The limit is about how much you can ask a person on
 * a phone in one sitting, so it belongs to what is asked, not to what exists.
 */
export { MAX_SELECTED as MAX_QUESTIONS } from './pulseProgramme'
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
const SCHEMA = 2

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
    // Not truncated any more. The server returns what is currently being asked, which
    // is a selection of at most MAX_SELECTED — but this is the bank, and slicing it
    // would silently drop questions the moment the endpoint starts serving a library.
    return (raw.questions ?? []).slice(0, MAX_BANK).map((question) => ({
      id: question.id,
      question: question.question,
      hint: '',
      options: question.options ?? [],
      tags: [],
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

/**
 * The stored bank, whatever shape it was stored in.
 *
 * Version 1 put `departments` on each question. That is now a property of a selection,
 * so an old entry is read, its departments dropped, and its tags defaulted — rather
 * than being thrown away, which would lose whatever wording somebody had already
 * agreed.
 */
export function migrateQuestion(raw: Record<string, unknown>): PulseQuestion {
  return {
    id: String(raw.id ?? ''),
    question: String(raw.question ?? ''),
    hint: String(raw.hint ?? ''),
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    tags: normaliseTags(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
  }
}

function readLocal(): PulseQuestion[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { schema?: number; questions?: unknown[] }
    if (!Array.isArray(parsed.questions)) return null
    // Schema 1 and 2 are both read. Refusing the older one would throw away wording
    // somebody had already agreed, for the sake of a field that moved.
    if (parsed.schema !== SCHEMA && parsed.schema !== 1) return null
    return parsed.questions.map((one) => migrateQuestion(one as Record<string, unknown>))
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
  // No size cap here any more. The bank is a library; the ten-question limit applies to
  // what a selection asks, which is a different thing — see pulseProgramme.ts.
  if (questions.length > MAX_BANK) return `That is more than ${MAX_BANK} questions.`
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
  return { id: '', question: '', hint: '', options: [...SCALES[0].options], tags: [] }
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

// What a department is asked now comes from the selection, not the question — see
// selectionFor and questionsIn in pulseProgramme.ts.

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
    tags: ['wellbeing'],
  },
  {
    id: 'workload',
    question: 'Is your workload manageable right now?',
    hint: 'Think about the last two weeks rather than today.',
    options: ['Comfortable', 'Busy but okay', 'Stretched', 'Not sustainable'],
    tags: ['workload', 'wellbeing'],
  },
  {
    id: 'manager',
    question: 'Do you feel supported by your manager?',
    hint: '',
    options: ['Always', 'Usually', 'Sometimes', 'Rarely'],
    tags: ['manager'],
  },
  {
    id: 'attrition',
    question: 'Have you thought about looking elsewhere recently?',
    hint: '',
    options: ['Not at all', 'Passing thought', 'Somewhat', 'Actively looking'],
    tags: ['attrition'],
  },
]
