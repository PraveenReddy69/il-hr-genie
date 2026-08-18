/**
 * The pulse bank and the selections that draw from it.
 *
 * Two rules carry most of the weight: a department must not end up in two selections,
 * because nothing could then say which pulse it gets; and ten is the most anyone is
 * asked, because past that people stop reading and start tapping the first option.
 *
 * Both are easy to state and easy to break with an off-by-one or a missed overlap, so
 * they are checked here rather than trusted to the disabled state of a button.
 */

import { describe, expect, it } from 'vitest'
import {
  ANY_STATE,
  ANY_TAG,
  MAX_SELECTED,
  blankSelection,
  byState,
  byTag,
  countByState,
  isSelectable,
  isEveryone,
  normaliseTag,
  normaliseTags,
  questionsIn,
  selectionFor,
  selectionLabel,
  tagsInUse,
  unpublishableIn,
  unreached,
  validateProgramme,
  validateSelection,
  withoutQuestion,
  type PulseSelection,
} from './pulseProgramme'
import { migrateQuestion, type PulseQuestion, type QuestionState } from './pulseQuestions'

const question = (
  id: string,
  tags: string[] = [],
  state: QuestionState = 'PUBLISHED',
): PulseQuestion => ({
  id,
  question: `Question ${id}?`,
  hint: '',
  options: ['Yes', 'No'],
  tags,
  state,
})

const bank: PulseQuestion[] = [
  question('experience', ['wellbeing']),
  question('workload', ['workload', 'wellbeing']),
  question('manager', ['manager']),
  question('attrition', ['attrition']),
]

const selection = (over: Partial<PulseSelection> = {}): PulseSelection => ({
  id: 'a',
  departments: [],
  questionIds: ['experience'],
  ...over,
})

describe('tags', () => {
  it('collapses the ways people write the same tag', () => {
    // The whole reason tags are normalised. Left alone these are three tags that
    // filter to three different sets, and the list stops being useful in a fortnight.
    expect(normaliseTag('Work Load')).toBe('work-load')
    expect(normaliseTag('  workload ')).toBe('workload')
    expect(normaliseTag('WORKLOAD')).toBe('workload')
  })

  it('drops punctuation rather than keeping it as part of the word', () => {
    expect(normaliseTag('well-being!')).toBe('well-being')
    expect(normaliseTag('career?')).toBe('career')
  })

  it('comes back empty when there was nothing but punctuation', () => {
    expect(normaliseTag('!!!')).toBe('')
    expect(normaliseTag('   ')).toBe('')
  })

  it('deduplicates a list after normalising, not before', () => {
    expect(normaliseTags(['Workload', 'workload', ' WORKLOAD '])).toEqual(['workload'])
  })

  it('drops empties instead of storing a blank tag', () => {
    expect(normaliseTags(['wellbeing', '   ', '!!'])).toEqual(['wellbeing'])
  })

  it('lists tags in use, most used first', () => {
    // The filter leads with what most questions are about, which is more useful than
    // alphabetical when the list gets long.
    expect(tagsInUse(bank)).toEqual(['wellbeing', 'attrition', 'manager', 'workload'])
  })

  it('filters the bank by one tag', () => {
    expect(byTag(bank, 'wellbeing').map((one) => one.id)).toEqual(['experience', 'workload'])
    expect(byTag(bank, ANY_TAG)).toHaveLength(bank.length)
    expect(byTag(bank, 'nothing-uses-this')).toEqual([])
  })
})

describe('what a department is asked', () => {
  const engineering = selection({ id: 'eng', departments: ['Experience'], questionIds: ['workload'] })
  const everyone = selection({ id: 'all', departments: [], questionIds: ['experience', 'manager'] })

  it('prefers a department its own selection', () => {
    expect(selectionFor([everyone, engineering], 'Experience')?.id).toBe('eng')
  })

  it('falls back to the everyone selection', () => {
    expect(selectionFor([everyone, engineering], 'Finance')?.id).toBe('all')
  })

  it('does not stack the two', () => {
    // A department named in a selection has been decided about. Adding the general
    // questions on top would push it over the cap without anybody choosing to.
    const asked = questionsIn(bank, selectionFor([everyone, engineering], 'Experience'))
    expect(asked.map((one) => one.id)).toEqual(['workload'])
  })

  it('asks nothing when nobody has been assigned', () => {
    expect(selectionFor([engineering], 'Finance')).toBeNull()
    expect(questionsIn(bank, null)).toEqual([])
  })

  it('keeps the order the questions were picked in', () => {
    // A pulse that opens with "have you thought about leaving" reads very differently
    // from one that ends with it, so the order is the author's, not the bank's.
    const ordered = selection({ questionIds: ['attrition', 'experience'] })
    expect(questionsIn(bank, ordered).map((one) => one.id)).toEqual(['attrition', 'experience'])
  })

  it('skips a question that has left the bank rather than rendering a hole', () => {
    const stale = selection({ questionIds: ['experience', 'deleted-one'] })
    expect(questionsIn(bank, stale).map((one) => one.id)).toEqual(['experience'])
  })
})

describe('the ten-question cap', () => {
  const many = Array.from({ length: 12 }, (_, index) => question(`q${index}`))

  it('allows exactly ten', () => {
    const ten = selection({ questionIds: many.slice(0, MAX_SELECTED).map((one) => one.id) })
    expect(validateSelection(ten, [], many)).toBeNull()
  })

  it('refuses eleven', () => {
    const eleven = selection({ questionIds: many.slice(0, MAX_SELECTED + 1).map((one) => one.id) })
    expect(validateSelection(eleven, [], many)).toMatch(/at most 10/i)
  })

  it('does not cap the bank itself', () => {
    // The point of splitting the two. Writing an eleventh question used to mean
    // deleting one that was working.
    const five = selection({ questionIds: many.slice(0, 5).map((one) => one.id) })
    expect(validateSelection(five, [], many)).toBeNull()
  })
})

describe('a selection has to make sense', () => {
  it('wants at least one question', () => {
    expect(validateSelection(selection({ questionIds: [] }), [], bank)).toMatch(/at least one/i)
  })

  it('refuses the same question twice', () => {
    const doubled = selection({ questionIds: ['experience', 'experience'] })
    expect(validateSelection(doubled, [], bank)).toMatch(/twice/i)
  })

  it('refuses a question that is not in the bank', () => {
    const ghost = selection({ questionIds: ['never-written'] })
    expect(validateSelection(ghost, [], bank)).toMatch(/no longer in the bank/i)
  })
})

describe('a department belongs to one selection', () => {
  const first = selection({ id: 'a', departments: ['Experience', 'Growth'] })

  it('names the overlap rather than letting the first win', () => {
    const second = selection({ id: 'b', departments: ['Growth'] })
    expect(validateSelection(second, [first], bank)).toMatch(/Growth is already/i)
  })

  it('allows departments that do not overlap', () => {
    const second = selection({ id: 'b', departments: ['Finance'] })
    expect(validateSelection(second, [first], bank)).toBeNull()
  })

  it('allows one everyone selection', () => {
    expect(validateSelection(selection({ id: 'b' }), [first], bank)).toBeNull()
  })

  it('refuses a second everyone selection', () => {
    // Two answers to "what does everybody get" and no way to choose between them.
    const everyone = selection({ id: 'a', departments: [] })
    const alsoEveryone = selection({ id: 'b', departments: [] })
    expect(validateSelection(alsoEveryone, [everyone], bank)).toMatch(/already a selection/i)
  })

  it('checks the whole programme, not just one at a time', () => {
    const clashing = [
      selection({ id: 'a', departments: ['Experience'] }),
      selection({ id: 'b', departments: ['Experience'] }),
    ]
    expect(validateProgramme(clashing, bank)).toMatch(/already/i)
  })

  it('passes a programme that covers everyone once', () => {
    const fine = [
      selection({ id: 'a', departments: ['Experience'] }),
      selection({ id: 'b', departments: [] }),
    ]
    expect(validateProgramme(fine, bank)).toBeNull()
  })
})

describe('who gets missed', () => {
  const departments = ['Experience', 'Growth', 'Finance']

  it('names departments nobody has assigned', () => {
    // Otherwise the first sign is an empty column on the dashboard a month later.
    const partial = [selection({ id: 'a', departments: ['Experience'] })]
    expect(unreached(partial, departments)).toEqual(['Growth', 'Finance'])
  })

  it('misses nobody once there is an everyone selection', () => {
    const withFallback = [
      selection({ id: 'a', departments: ['Experience'] }),
      selection({ id: 'b', departments: [] }),
    ]
    expect(unreached(withFallback, departments)).toEqual([])
  })
})

describe('labels and blanks', () => {
  it('says what a selection covers', () => {
    expect(selectionLabel(selection({ departments: [] }))).toBe('Every department')
    expect(selectionLabel(selection({ departments: ['Growth'] }))).toBe('Growth')
    expect(selectionLabel(selection({ departments: ['a', 'b', 'c'] }))).toBe('3 departments')
  })

  it('starts a new selection covering everyone', () => {
    const fresh = blankSelection([])
    expect(isEveryone(fresh)).toBe(true)
    expect(fresh.questionIds).toEqual([])
  })

  it('does not reuse an id already taken', () => {
    expect(blankSelection(['selection']).id).toBe('selection-1')
    expect(blankSelection(['selection', 'selection-1']).id).toBe('selection-2')
  })
})

describe('reading a bank stored under the old shape', () => {
  it('keeps the wording and drops the departments field', () => {
    // Schema 1 put departments on the question. Refusing to read it would throw away
    // wording somebody had already agreed, for the sake of a field that moved.
    const old = {
      id: 'workload',
      question: 'Is your workload manageable right now?',
      hint: 'Think about the last two weeks.',
      options: ['Comfortable', 'Stretched'],
      departments: ['Experience'],
    }
    const migrated = migrateQuestion(old)

    expect(migrated.question).toBe('Is your workload manageable right now?')
    expect(migrated.options).toEqual(['Comfortable', 'Stretched'])
    expect(migrated.tags).toEqual([])
    expect('departments' in migrated).toBe(false)
  })

  it('normalises tags that were stored before the rule existed', () => {
    const migrated = migrateQuestion({ id: 'x', question: 'Q?', options: [], tags: ['Work Load'] })
    expect(migrated.tags).toEqual(['work-load'])
  })

  it('survives a record with nothing in it', () => {
    const migrated = migrateQuestion({})
    expect(migrated.id).toBe('')
    expect(migrated.options).toEqual([])
    expect(migrated.tags).toEqual([])
  })
})

describe('draft, published and retired', () => {
  const mixed: PulseQuestion[] = [
    question('live', ['wellbeing'], 'PUBLISHED'),
    question('writing', ['wellbeing'], 'DRAFT'),
    question('old', ['attrition'], 'RETIRED'),
  ]

  it('lets only a published question be asked', () => {
    expect(isSelectable(mixed[0])).toBe(true)
    expect(isSelectable(mixed[1])).toBe(false)
    expect(isSelectable(mixed[2])).toBe(false)
  })

  it('filters the bank by state', () => {
    expect(byState(mixed, 'DRAFT').map((one) => one.id)).toEqual(['writing'])
    expect(byState(mixed, 'RETIRED').map((one) => one.id)).toEqual(['old'])
    expect(byState(mixed, ANY_STATE)).toHaveLength(3)
  })

  it('counts each state for the filter chips', () => {
    expect(countByState(mixed)).toEqual({ DRAFT: 1, PUBLISHED: 1, RETIRED: 1 })
  })

  it('combines with the tag filter the way the page does', () => {
    const shown = byState(byTag(mixed, 'wellbeing'), 'PUBLISHED')
    expect(shown.map((one) => one.id)).toEqual(['live'])
  })

  it('refuses a selection holding a draft, and names it', () => {
    const withDraft = selection({ questionIds: ['live', 'writing'] })
    expect(validateSelection(withDraft, [], mixed)).toMatch(/still a draft/i)
  })

  it('refuses a selection holding a retired question, and says so differently', () => {
    // Two different sentences on purpose: "retired" and "still a draft" are different
    // situations, and the fix for each is different too.
    const withRetired = selection({ questionIds: ['live', 'old'] })
    expect(validateSelection(withRetired, [], mixed)).toMatch(/retired/i)
  })

  it('accepts a selection of published questions', () => {
    expect(validateSelection(selection({ questionIds: ['live'] }), [], mixed)).toBeNull()
  })

  it('lists what in a selection can no longer be asked', () => {
    const stale = selection({ questionIds: ['live', 'writing', 'old'] })
    expect(unpublishableIn(stale, mixed).map((one) => one.id)).toEqual(['writing', 'old'])
  })

  it('finds nothing wrong with a clean selection', () => {
    expect(unpublishableIn(selection({ questionIds: ['live'] }), mixed)).toEqual([])
  })

  it('pulls a question out of every selection it was in', () => {
    const before = [
      selection({ id: 'a', questionIds: ['live', 'writing'] }),
      selection({ id: 'b', departments: ['Growth'], questionIds: ['writing'] }),
    ]
    const after = withoutQuestion(before, 'writing')
    expect(after[0].questionIds).toEqual(['live'])
    expect(after[1].questionIds).toEqual([])
  })

  it('leaves selections alone when the question was in none of them', () => {
    const before = [selection({ id: 'a', questionIds: ['live'] })]
    expect(withoutQuestion(before, 'never-used')).toEqual(before)
  })
})

describe('state on a bank stored before states existed', () => {
  it('reads as published rather than draft', () => {
    // Defaulting to draft would switch the pulse off for everybody the first time this
    // page is opened after the upgrade — a silent change to what employees are asked.
    expect(migrateQuestion({ id: 'x', question: 'Q?', options: [] }).state).toBe('PUBLISHED')
  })

  it('keeps a state that was stored', () => {
    expect(migrateQuestion({ id: 'x', question: 'Q?', state: 'RETIRED' }).state).toBe('RETIRED')
  })

  it('falls back to published on a state nobody recognises', () => {
    expect(migrateQuestion({ id: 'x', question: 'Q?', state: 'ARCHIVED' }).state).toBe('PUBLISHED')
  })
})
