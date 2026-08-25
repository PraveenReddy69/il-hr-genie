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

import { get, isLive, remove, request } from './client'
import {
  mockCreateSelection,
  mockDeleteSelection,
  mockSelectionList,
  mockUpdateSelection,
} from './mock'
import type { PulseQuestion, QuestionState } from './pulseQuestions'

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
export const ANY_STATE = 'Any state'

/**
 * Whether a question may be put into a selection.
 *
 * The whole point of draft and retired: a question in either is visibly in the bank and
 * visibly not being asked. Checked here rather than left to the picker, so a stale
 * selection built before a question was retired is caught rather than quietly asked.
 */
export function isSelectable(question: PulseQuestion): boolean {
  return question.state === 'PUBLISHED'
}

export function byState(bank: PulseQuestion[], state: string): PulseQuestion[] {
  if (state === ANY_STATE) return bank
  return bank.filter((question) => question.state === state)
}

/** How many questions sit in each state, for the filter chips. */
export function countByState(bank: PulseQuestion[]): Record<QuestionState, number> {
  const counts = { DRAFT: 0, PUBLISHED: 0, RETIRED: 0 }
  for (const question of bank) counts[question.state] += 1
  return counts
}

/**
 * Selections with a question that is no longer publishable in them.
 *
 * Retiring a question does pull it out of every selection, but a bank loaded from
 * elsewhere — another browser, eventually a server — can arrive already inconsistent.
 * Surfaced rather than silently dropped: what a department is asked should not change
 * because of a state transition nobody connected to it.
 */
export function unpublishableIn(
  selection: PulseSelection,
  bank: PulseQuestion[],
): PulseQuestion[] {
  return selection.questionIds
    .map((id) => bank.find((question) => question.id === id))
    .filter((question): question is PulseQuestion => Boolean(question))
    .filter((question) => !isSelectable(question))
}

/** Every selection, with any question that has since stopped being publishable removed. */
export function withoutQuestion(
  selections: PulseSelection[],
  questionId: string,
): PulseSelection[] {
  return selections.map((one) => ({
    ...one,
    questionIds: one.questionIds.filter((id) => id !== questionId),
  }))
}

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

/**
 * The marker on a selection the server has never seen.
 *
 * A new card needs *an* id — React keys it, and two blank cards must not collide — but
 * that id must not look saved. It did: the page read "has an id" as "exists", took the
 * update branch for something that had never been created, and the new selection
 * vanished on the next reload with no error anywhere.
 */
const UNSAVED_PREFIX = 'new:'

export function isUnsaved(selection: PulseSelection): boolean {
  return selection.id.startsWith(UNSAVED_PREFIX)
}

export function blankSelection(taken: string[]): PulseSelection {
  let id = `${UNSAVED_PREFIX}selection`
  for (let n = 1; taken.includes(id); n += 1) id = `${UNSAVED_PREFIX}selection-${n}`
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

  // Draft and retired questions cannot be asked. A selection holding one is a real
  // state — retire a question from another browser and this is what you come back to —
  // so it is named rather than quietly skipped.
  const unpublishable = unpublishableIn(selection, bank)
  if (unpublishable.length > 0) {
    const first = unpublishable[0]
    const state = first.state === 'DRAFT' ? 'still a draft' : 'retired'
    return `"${first.question}" is ${state} and cannot be asked. Remove it from this selection.`
  }

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

// ------------------------------------------------------------------- the API

/**
 * Selections, from the server.
 *
 * Reads both envelopes — `{ selections: [...] }` and a bare array — for the same reason
 * the bank does: the console asked for one shape and cannot be sure which arrived.
 *
 * A selection with no id has not been saved yet. The page creates it on first change
 * rather than on the button press that adds the card, so an Admin who adds one and
 * changes their mind leaves nothing behind.
 */
export async function fetchSelections(): Promise<PulseSelection[]> {
  if (!isLive) return mockSelectionList()
  const body = await get<unknown>('/api/pulse/selections')
  const list = Array.isArray(body) ? body : (body as { selections?: unknown }).selections
  if (!Array.isArray(list)) return []

  return list.map((raw) => {
    const one = raw as Record<string, unknown>
    return {
      id: String(one.id ?? ''),
      departments: Array.isArray(one.departments) ? one.departments.map(String) : [],
      questionIds: Array.isArray(one.questionIds)
        ? one.questionIds.map(String)
        : Array.isArray(one.questions)
          ? (one.questions as unknown[]).map((q) =>
              typeof q === 'string' ? q : String((q as { id?: unknown }).id ?? ''),
            )
        : [],
    }
  })
}

function wire(selection: PulseSelection): Record<string, unknown> {
  return { departments: selection.departments, questionIds: selection.questionIds }
}

export function createSelection(selection: PulseSelection): Promise<PulseSelection> {
  if (!isLive) return Promise.resolve(mockCreateSelection(selection))
  return request<PulseSelection>('/api/pulse/selections', {
    method: 'POST',
    body: JSON.stringify(wire(selection)),
  })
}

export function updateSelection(id: string, selection: PulseSelection): Promise<PulseSelection> {
  if (!isLive) return Promise.resolve(mockUpdateSelection(id, selection))
  return request<PulseSelection>(`/api/pulse/selections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(wire(selection)),
  })
}

export function deleteSelection(id: string): Promise<void> {
  if (!isLive) return Promise.resolve(mockDeleteSelection(id))
  return remove(`/api/pulse/selections/${encodeURIComponent(id)}`)
}
