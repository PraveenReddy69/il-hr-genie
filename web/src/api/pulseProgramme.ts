/**
 * The pulse, in two halves.
 *
 * It used to be one list: a bank of at most ten questions, each carrying the
 * departments it was asked of. That conflated two decisions that happen at different
 * times and by different reasoning — *what could we ask* and *what are we asking this
 * month* — and it made the ten-question cap a cap on the whole library, so writing an
 * eleventh question meant deleting one that was working.
 *
 * Now:
 *
 *   **The bank** — every question anyone has written, tagged. Uncapped. A question is
 *   written once and reused for years.
 *
 *   **A selection** — a set of departments paired with up to ten questions from the
 *   bank. This is what those departments are actually asked. The cap lives here, where
 *   it belongs: it is about how much you can ask a person on a phone in one sitting,
 *   not about how many questions may exist.
 *
 * The cap is the one number worth defending. Past about ten, people stop reading and
 * start tapping the first option, which is worse than not asking — the numbers still
 * look like data.
 */

import type { PulseQuestion } from './pulseQuestions'

/** How many questions one selection may ask. See the note above. */
export const MAX_SELECTED = 10

/** The bank is uncapped in spirit; this only stops a runaway paste. */
export const MAX_BANK = 200

export const MAX_TAG_LENGTH = 24
export const MAX_TAGS_PER_QUESTION = 6

/**
 * Tags people are likely to want, offered rather than imposed.
 *
 * Unlike holiday regions, tags are meant to grow — the whole point is that whoever
 * writes a question can name what it is about without asking anyone. So free text,
 * normalised, with these as suggestions.
 */
export const SUGGESTED_TAGS = [
  'wellbeing',
  'workload',
  'manager',
  'career',
  'attrition',
  'tools',
  'onboarding',
  'recognition',
] as const

/**
 * One tag, cleaned up.
 *
 * Lower-cased and trimmed, and inner runs of whitespace collapsed to a single dash.
 * Without this "Work Load", "workload" and "work load " are three tags that filter to
 * three different sets, which is how a tag list stops being useful about a fortnight in.
 */
export function normaliseTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_TAG_LENGTH)
}

export function normaliseTags(raw: string[]): string[] {
  const seen: string[] = []
  for (const one of raw) {
    const tag = normaliseTag(one)
    if (tag && !seen.includes(tag)) seen.push(tag)
  }
  return seen.slice(0, MAX_TAGS_PER_QUESTION)
}

/** Every tag in use, most-used first, so the filter leads with what matters. */
export function tagsInUse(bank: PulseQuestion[]): string[] {
  const counts = new Map<string, number>()
  for (const question of bank) {
    for (const tag of question.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

export const ANY_TAG = 'All tags'

export function byTag(bank: PulseQuestion[], tag: string): PulseQuestion[] {
  if (tag === ANY_TAG) return bank
  return bank.filter((question) => (question.tags ?? []).includes(tag))
}

/**
 * A set of departments and what they are asked.
 *
 * `departments` empty means **every department** — the fallback for anyone not named
 * in a selection of their own. At most one of those may exist, or "everyone" would
 * have two different answers.
 */
export interface PulseSelection {
  id: string
  departments: string[]
  questionIds: string[]
}

export function blankSelection(taken: string[]): PulseSelection {
  let id = 'selection'
  for (let n = 1; taken.includes(id); n += 1) id = `selection-${n}`
  return { id, departments: [], questionIds: [] }
}

export function isEveryone(selection: PulseSelection): boolean {
  return selection.departments.length === 0
}

export function selectionLabel(selection: PulseSelection): string {
  if (isEveryone(selection)) return 'Every department'
  if (selection.departments.length === 1) return selection.departments[0]
  return `${selection.departments.length} departments`
}

/**
 * What one department is asked.
 *
 * Its own selection if it has one, otherwise the everyone selection. Never both: a
 * department named in a selection has been decided about, and quietly adding the
 * general questions on top would push it over the ten-question cap without anyone
 * choosing to.
 */
export function selectionFor(
  selections: PulseSelection[],
  department: string,
): PulseSelection | null {
  const own = selections.find((one) => one.departments.includes(department))
  if (own) return own
  return selections.find(isEveryone) ?? null
}

export function questionsIn(
  bank: PulseQuestion[],
  selection: PulseSelection | null,
): PulseQuestion[] {
  if (!selection) return []
  // Mapped from the ids rather than filtered, so the order is the order they were
  // chosen in — a pulse that opens with "have you thought about leaving" reads very
  // differently from one that ends with it.
  return selection.questionIds
    .map((id) => bank.find((question) => question.id === id))
    .filter((question): question is PulseQuestion => Boolean(question))
}

/** What is wrong with one selection, as a sentence, or null. */
export function validateSelection(
  selection: PulseSelection,
  others: PulseSelection[],
  bank: PulseQuestion[],
): string | null {
  if (selection.questionIds.length === 0) {
    return 'Pick at least one question, or remove this selection.'
  }
  if (selection.questionIds.length > MAX_SELECTED) {
    return `A pulse asks at most ${MAX_SELECTED} questions.`
  }
  if (new Set(selection.questionIds).size !== selection.questionIds.length) {
    return 'The same question is picked twice.'
  }

  const missing = selection.questionIds.filter(
    (id) => !bank.some((question) => question.id === id),
  )
  if (missing.length > 0) return 'A picked question is no longer in the bank.'

  if (isEveryone(selection) && others.some(isEveryone)) {
    return 'There is already a selection for every department.'
  }

  // A department in two selections has two different pulses, and nothing here could
  // say which one it gets. Named rather than silently letting the first win.
  const clash = selection.departments.find((department) =>
    others.some((other) => other.departments.includes(department)),
  )
  if (clash) return `${clash} is already in another selection.`

  return null
}

export function validateProgramme(
  selections: PulseSelection[],
  bank: PulseQuestion[],
): string | null {
  for (let index = 0; index < selections.length; index += 1) {
    const others = selections.filter((_, other) => other !== index)
    const problem = validateSelection(selections[index], others, bank)
    if (problem) return problem
  }
  return null
}

/**
 * Departments with no pulse at all.
 *
 * Worth surfacing rather than leaving to be noticed: without an everyone selection, a
 * department nobody named is simply never asked, and the first sign of it is an empty
 * column on the dashboard a month later.
 */
export function unreached(selections: PulseSelection[], departments: string[]): string[] {
  if (selections.some(isEveryone)) return []
  const covered = new Set(selections.flatMap((one) => one.departments))
  return departments.filter((department) => !covered.has(department))
}

// ------------------------------------------------------------------- storage

const STORAGE_KEY = 'hr-genie-pulse-programme'
const SCHEMA = 1

/**
 * The selections, kept in this browser.
 *
 * Separate from the bank's storage on purpose: the bank is a library that changes
 * rarely, the selections change every cycle, and a single blob would mean a failed
 * write to one losing the other.
 */
export function readProgramme(): PulseSelection[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { schema?: number; selections?: PulseSelection[] }
    if (parsed.schema !== SCHEMA || !Array.isArray(parsed.selections)) return null
    return parsed.selections
  } catch {
    return null
  }
}

export function saveProgramme(selections: PulseSelection[]): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), selections }),
  )
}

export function discardProgramme(): void {
  localStorage.removeItem(STORAGE_KEY)
}
