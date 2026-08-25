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

import { get, isLive, remove, request } from './client'
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
  /** Where the question is in its life. See QuestionState. */
  state: QuestionState
}

/**
 * Draft, published, retired.
 *
 * **Draft** is being written. **Published** is fit to ask. **Retired** was asked once
 * and no longer should be.
 *
 * Only a published question can go into a selection — the point of the other two is
 * that they are visibly *not* being asked while still being in the bank.
 *
 * Retired rather than deleted, because answers are stored keyed by question id. Deleting
 * a question that has been answered leaves rows pointing at nothing, and next year's
 * comparison against this year quietly loses a column. Retiring keeps the record and
 * takes it out of circulation, which is what "we do not ask that any more" actually
 * means.
 */
export type QuestionState = 'DRAFT' | 'PUBLISHED' | 'RETIRED'

export const QUESTION_STATES: QuestionState[] = ['DRAFT', 'PUBLISHED', 'RETIRED']

export const STATE_LABEL: Record<QuestionState, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  RETIRED: 'Retired',
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


/** What the server returns. Everything optional — the reader fills in the rest. */
interface RawQuestion {
  id?: string
  question?: string
  hint?: string
  options?: string[]
  tags?: string[]
  state?: string
}

/** The bank, and where it came from — the page has to be honest about that. */
export interface Bank {
  questions: PulseQuestion[]
  /** True once HR has edited it here and the server has no idea. */
  unsaved: boolean
}

/**
 * The bank, from the server.
 *
 * It used to prefer a copy in this browser, because there was no way to save one. There
 * is now — POST/PATCH/DELETE on /api/pulse/questions — so a local copy would be a second
 * source of truth that silently wins over the real one, which is worse than not having
 * had a copy at all. `unsaved` stays on the type and is always false; the page still
 * reads it, and removing the field is churn for no gain.
 */
export async function fetchQuestionBank(): Promise<Bank> {
  return { questions: await fetchLiveBank(), unsaved: false }
}

/** One question, created server-side. The id comes back from the server. */
export function createQuestion(question: PulseQuestion): Promise<PulseQuestion> {
  if (!isLive) return Promise.resolve(mockCreateQuestion(question))
  return request<RawQuestion>('/api/pulse/questions', {
    method: 'POST',
    body: JSON.stringify(toWire(question)),
  }).then(fromWire)
}

export function updateQuestion(
  id: string,
  patch: Partial<PulseQuestion>,
): Promise<PulseQuestion> {
  // Never the id. Answers are keyed by it, so rewriting one orphans every answer ever
  // given — see the note on PulseQuestion.id.
  const { id: _ignored, ...rest } = patch
  if (!isLive) return Promise.resolve(mockUpdateQuestion(id, rest))
  return request<RawQuestion>(`/api/pulse/questions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(toWire(rest as PulseQuestion)),
  }).then(fromWire)
}

export function deleteQuestion(id: string): Promise<void> {
  if (!isLive) return Promise.resolve(mockDeleteQuestion(id))
  return remove(`/api/pulse/questions/${encodeURIComponent(id)}`)
}

function toWire(question: Partial<PulseQuestion>): Record<string, unknown> {
  const wire: Record<string, unknown> = {}
  if (question.question !== undefined) wire.question = question.question
  if (question.hint !== undefined) wire.hint = question.hint
  if (question.options !== undefined) wire.options = question.options
  if (question.tags !== undefined) wire.tags = normaliseTags(question.tags)
  if (question.state !== undefined) wire.state = question.state
  return wire
}

/** Reads whatever the endpoint sends, filling in what it does not. */
export function fromWire(raw: RawQuestion): PulseQuestion {
  return migrateQuestion(raw as unknown as Record<string, unknown>)
}

/** Whatever employees are being asked right now, adapted to the fuller shape. */
async function fetchLiveBank(): Promise<PulseQuestion[]> {
  if (!isLive) return mockBank()
  try {
    // Both envelopes: `{ questions: [...] }` as documented, and a bare array.
    const body = await get<unknown>('/api/pulse/questions')
    const raw = (Array.isArray(body) ? { questions: body } : body) as { questions?: RawQuestion[] }
    // Not truncated any more. The server returns what is currently being asked, which
    // is a selection of at most MAX_SELECTED — but this is the bank, and slicing it
    // would silently drop questions the moment the endpoint starts serving a library.
    // Read through migrateQuestion so a row missing tags or state gets the same
    // defaults as one read back from anywhere else, in one place.
    return (raw.questions ?? [])
      .slice(0, MAX_BANK)
      .map((question) => migrateQuestion(question as unknown as Record<string, unknown>))
      .filter((question) => question.id)
  } catch {
    // A bank that will not load is not a reason to block authoring — start from the
    // same defaults the mock uses and let HR see the failure in the banner.
    return DEFAULTS.map((question) => ({ ...question }))
  }
}

/**
 * Kept only to validate before a write.
 *
 * It used to persist the whole bank to this browser. The endpoints landed, so the page
 * writes one question at a time and this no longer stores anything — the validation it
 * did is still worth running before a request goes out.
 */
export function checkBank(questions: PulseQuestion[]): void {
  const problem = validateBank(questions)
  if (problem) throw new Error(problem)
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
    // Published when the field is absent. Anything already stored was being asked, and
    // defaulting to draft would switch the pulse off for everyone who opens this page
    // after the upgrade — a silent change to what employees are asked.
    state: QUESTION_STATES.includes(raw.state as QuestionState)
      ? (raw.state as QuestionState)
      : 'PUBLISHED',
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
  // Draft, not published. A question is written, read back, and then let out — making
  // a half-typed one publishable the moment it is saved is how a typo reaches everyone.
  return { id: '', question: '', hint: '', options: [...SCALES[0].options], tags: [], state: 'DRAFT' }
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

/*
 * The bank the mock serves, held in memory so the page can be edited offline.
 *
 * Same reasoning as the holidays above: the page writes through the API now, and
 * without somewhere for those writes to land the offline path is read-only.
 */
let bank: PulseQuestion[] | null = null

function mockBank(): PulseQuestion[] {
  bank ??= DEFAULTS.map((question) => ({ ...question }))
  return bank
}

function mockCreateQuestion(question: PulseQuestion): PulseQuestion {
  const taken = mockBank().map((one) => one.id)
  const created = { ...question, id: newQuestionId(question.question, taken) }
  bank = [...mockBank(), created]
  return created
}

function mockUpdateQuestion(id: string, patch: Partial<PulseQuestion>): PulseQuestion {
  let updated: PulseQuestion | null = null
  bank = mockBank().map((one) => {
    if (one.id !== id) return one
    updated = { ...one, ...patch, id }
    return updated
  })
  if (!updated) throw new Error(`No question ${id}`)
  return updated
}

function mockDeleteQuestion(id: string): void {
  bank = mockBank().filter((one) => one.id !== id)
}

/** The starting bank the mock serves, so the page has something real to edit offline. */
const DEFAULTS: PulseQuestion[] = [
  {
    id: 'experience',
    question: 'How has your work experience been this month?',
    hint: '',
    options: ['Genuinely good', 'Mostly fine', 'Up and down', 'Rough, honestly'],
    tags: ['wellbeing'],
    state: 'PUBLISHED',
  },
  {
    id: 'workload',
    question: 'Is your workload manageable right now?',
    hint: 'Think about the last two weeks rather than today.',
    options: ['Comfortable', 'Busy but okay', 'Stretched', 'Not sustainable'],
    tags: ['workload', 'wellbeing'],
    state: 'PUBLISHED',
  },
  {
    id: 'manager',
    question: 'Do you feel supported by your manager?',
    hint: '',
    options: ['Always', 'Usually', 'Sometimes', 'Rarely'],
    tags: ['manager'],
    state: 'PUBLISHED',
  },
  {
    id: 'attrition',
    question: 'Have you thought about looking elsewhere recently?',
    hint: '',
    options: ['Not at all', 'Passing thought', 'Somewhat', 'Actively looking'],
    tags: ['attrition'],
    state: 'PUBLISHED',
  },
]
