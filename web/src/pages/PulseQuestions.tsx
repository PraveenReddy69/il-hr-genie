/**
 * Authoring the monthly pulse, in two stages.
 *
 * **The bank** is every question anyone has written, tagged. It is a library: a
 * question is written once and reused for years, so nothing here is capped.
 *
 * **A selection** pairs a set of departments with up to ten of those questions. That is
 * what those departments are actually asked, and the ten-question limit lives here
 * rather than on the bank — it is about how much you can ask a person on a phone in one
 * sitting, not about how many questions may exist.
 *
 * Two things worth designing for, both of which fail quietly: a department nobody
 * assigned (an empty pulse, noticed a month later when the response rate is zero), and
 * editing a question people have already answered this cycle (the wording changes, the
 * answers do not, and the comparison stops meaning anything).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Empty, Loading, clickable } from '../components/Bits'
import { Drawer } from '../components/Drawer'
import { fetchEmployees, fetchPulseBreakdown, isLive } from '../api/client'
import { currentCycle } from '../api/mock'
import {
  MAX_OPTIONS,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  SCALES,
  blankQuestion,
  createQuestion,
  deleteQuestion,
  fetchQuestionBank,
  updateQuestion,
  QUESTION_STATES,
  STATE_LABEL,
  nextCycleLabel,
  validateQuestion,
  type PulseQuestion,
  type QuestionState,
} from '../api/pulseQuestions'
import {
  ANY_STATE,
  ANY_TAG,
  MAX_SELECTED,
  MAX_TAGS_PER_QUESTION,
  SUGGESTED_TAGS,
  blankSelection,
  byState,
  byTag,
  countByState,
  createSelection,
  isUnsaved,
  deleteSelection,
  fetchSelections,
  isSelectable,
  isEveryone,
  normaliseTag,
  questionsIn,
  selectionLabel,
  updateSelection,
  tagsInUse,
  unreached,
  validateSelection,
  withoutQuestion,
  type PulseSelection,
} from '../api/pulseProgramme'

interface Department {
  name: string
  headcount: number
}

export function PulseQuestions({ editable = true }: { editable?: boolean }) {
  const [questions, setQuestions] = useState<PulseQuestion[] | null>(null)
  const [selections, setSelections] = useState<PulseSelection[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  /** questionId -> people who have already answered it this cycle. */
  const [answered, setAnswered] = useState<Map<string, number>>(new Map())
  const [editing, setEditing] = useState<{ question: PulseQuestion; index: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [tag, setTag] = useState<string>(ANY_TAG)
  const [state, setState] = useState<string>(ANY_STATE)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /**
   * Reloads both halves together.
   *
   * A write to either can move the other — retiring a question takes it out of every
   * selection — so refetching one and trusting the other is how the counter and the
   * list stop agreeing.
   */
  const reload = useCallback(async () => {
    const [bank, stored] = await Promise.all([
      fetchQuestionBank(),
      fetchSelections().catch(() => [] as PulseSelection[]),
    ])
    setQuestions(bank.questions)
    setSelections(stored)
  }, [])

  useEffect(() => {
    reload().catch((failure: unknown) => {
      setQuestions([])
      setSaveError(failure instanceof Error ? failure.message : 'Could not load the pulse.')
    })
  }, [reload])

  useEffect(() => {
    fetchEmployees().then((people) => {
      const counts = new Map<string, number>()
      for (const person of people) {
        if (person.role !== 'EMPLOYEE') continue
        counts.set(person.department, (counts.get(person.department) ?? 0) + 1)
      }
      setDepartments(
        [...counts.entries()]
          .map(([name, headcount]) => ({ name, headcount }))
          .sort((a, b) => b.headcount - a.headcount),
      )
    })

    fetchPulseBreakdown(currentCycle())
      .then((rows) =>
        // Summed from the per-option counts: the breakdown has no total of its own,
        // and the number wanted here is how many people this question has reached.
        setAnswered(
          new Map(
            rows.map((row) => [
              row.questionId,
              row.answers.reduce((total, answer) => total + answer.count, 0),
            ]),
          ),
        ),
      )
      .catch(() => setAnswered(new Map()))
  }, [])

  const tags = useMemo(() => tagsInUse(questions ?? []), [questions])
  const counts = useMemo(() => countByState(questions ?? []), [questions])
  const shown = useMemo(
    () => byState(byTag(questions ?? [], tag), state),
    [questions, tag, state],
  )
  const missed = useMemo(
    () => unreached(selections, departments.map((one) => one.name)),
    [selections, departments],
  )

  if (!questions) return <Loading />

  /**
   * One write, then a reload of both halves.
   *
   * The server's own message is shown rather than a rewritten one — it is the side that
   * knows which rule was hit, and a 409 naming a department in two selections reads far
   * better than anything this page could guess.
   */
  async function attempt(work: () => Promise<unknown>) {
    setBusy(true)
    setSaveError(null)
    try {
      await work()
      await reload()
      return true
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Could not save that change.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveQuestion(question: PulseQuestion, index: number) {
    // The id is the server's on create. It used to be generated here because there was
    // nowhere to send it; sending a client-made one now would either be ignored or
    // become an id nobody else can reproduce.
    const ok = await attempt(() =>
      index < 0 || !question.id ? createQuestion(question) : updateQuestion(question.id, question),
    )
    if (ok) setEditing(null)
  }

  /**
   * Move a question between draft, published and retired.
   *
   * Leaving published pulls it out of every selection, because a selection holding an
   * unaskable question is not a state worth keeping — and the alternative, leaving it
   * there and refusing to save, blocks the page on a decision the person has already
   * made. What they lose is a tick they can put back by publishing it again.
   */
  async function setQuestionState(index: number, next: QuestionState) {
    const question = questions![index]
    const affected = selections.filter((one) => one.questionIds.includes(question.id))

    const ok = await attempt(async () => {
      await updateQuestion(question.id, { state: next })
      // Leaving published pulls it out of every selection. Done here as well as
      // server-side: the spec asks the API to do it, and until that is confirmed a
      // selection left holding an unaskable question would fail its own validation on
      // the next render with no way for anyone to fix it.
      if (next !== 'PUBLISHED') {
        for (const selection of affected) {
          const trimmed = withoutQuestion([selection], question.id)[0]
          await updateSelection(selection.id, trimmed)
        }
      }
    })

    if (ok && next !== 'PUBLISHED' && affected.length > 0) {
      setSaveError(
        `Taken out of ${affected.length} ${affected.length === 1 ? 'selection' : 'selections'} — ` +
          `a ${STATE_LABEL[next].toLowerCase()} question cannot be asked.`,
      )
    }
  }

  /**
   * A selection, created or updated.
   *
   * Created on first save rather than when the card appears: an Admin who adds one and
   * changes their mind should leave nothing behind, and an empty selection would fail
   * its own validation the moment the server saw it.
   */
  function saveSelection(next: PulseSelection) {
    return attempt(() =>
      isUnsaved(next) ? createSelection(next) : updateSelection(next.id, next),
    )
  }

  function addSelection() {
    // Local until it has a question in it. blankSelection's id is a placeholder the
    // server replaces on create.
    setSelections((current) => [...current, blankSelection(current.map((one) => one.id))])
  }

  function removeSelection(selection: PulseSelection) {
    // Never saved, so there is nothing to delete — drop the card and say nothing.
    if (isUnsaved(selection)) {
      setSelections((current) => current.filter((one) => one.id !== selection.id))
      return Promise.resolve(true)
    }
    return attempt(() => deleteSelection(selection.id))
  }

  async function removeQuestion(index: number) {
    const going = questions![index]
    const affected = selections.filter((one) => one.questionIds.includes(going.id))

    const ok = await attempt(async () => {
      // Out of the selections first. A question deleted while a selection still names
      // it leaves that selection unserveable, and the order matters if the second call
      // fails.
      for (const selection of affected) {
        await updateSelection(selection.id, withoutQuestion([selection], going.id)[0])
      }
      await deleteQuestion(going.id)
    })
    if (ok) setConfirmRemove(null)
  }

  return (
    <>
      <div className="page-head">
        <h1>Pulse</h1>
        <p>
          {questions.length} in the bank · {selections.length}{' '}
          {selections.length === 1 ? 'selection' : 'selections'} for {nextCycleLabel()}
        </p>
      </div>

      {missed.length > 0 && (
        <div className="banner banner--warn" style={{ marginTop: 12 }}>
          <div className="banner__title">
            {missed.length} {missed.length === 1 ? 'department is' : 'departments are'} not asked
            anything
          </div>
          <div className="banner__body">
            {missed.join(', ')}. Add them to a selection, or add one covering every
            department — otherwise they are simply skipped, and the first sign is an
            empty column on the dashboard next month.
          </div>
        </div>
      )}

      {saveError && (
        <div className="error" style={{ marginTop: 12 }}>
          {saveError}
        </div>
      )}

      {/* ------------------------------------------------------------ the bank */}

      <section className="card" style={{ marginTop: 16 }}>
        <div className="chips" style={{ marginBottom: 8 }}>
          <button
            className={`chip ${state === ANY_STATE ? 'chip--on' : ''}`}
            onClick={() => setState(ANY_STATE)}
          >
            {ANY_STATE}
          </button>
          {QUESTION_STATES.map((one) => (
            <button
              key={one}
              className={`chip ${state === one ? 'chip--on' : ''}`}
              onClick={() => setState(one)}
            >
              {STATE_LABEL[one]} · {counts[one]}
            </button>
          ))}
        </div>

        <div className="chips">
          <button
            className={`chip ${tag === ANY_TAG ? 'chip--on' : ''}`}
            onClick={() => setTag(ANY_TAG)}
          >
            {ANY_TAG}
          </button>
          {tags.map((one) => (
            <button
              key={one}
              className={`chip ${tag === one ? 'chip--on' : ''}`}
              onClick={() => setTag(one)}
            >
              {one}
            </button>
          ))}
          {editable && (
            <button
              className="chip"
              style={{ marginLeft: 'auto' }}
              onClick={() => setEditing({ question: blankQuestion(), index: -1 })}
            >
              + Add question
            </button>
          )}
        </div>

        {shown.length === 0 ? (
          <Empty style={{ marginTop: 14 }}>
            {tag === ANY_TAG && state === ANY_STATE
              ? 'No questions yet. Nobody would be asked anything.'
              : 'Nothing here matches those filters.'}
          </Empty>
        ) : (
          <div style={{ marginTop: 8 }}>
            {shown.map((question) => {
              const index = questions.indexOf(question)
              const uses = selections.filter((one) =>
                one.questionIds.includes(question.id),
              ).length
              return (
                <div className="qrow" key={question.id}>
                  <div className="qrow__main">
                    <div className="row__title">
                      {question.question}
                      <span
                        className={`pill ${
                          question.state === 'PUBLISHED'
                            ? 'pill--resolved'
                            : question.state === 'DRAFT'
                              ? 'pill--optional'
                              : 'pill--neutral'
                        }`}
                        style={{ marginLeft: 8 }}
                      >
                        {STATE_LABEL[question.state]}
                      </span>
                    </div>
                    <div className="row__meta">
                      {question.tags.length > 0
                        ? question.tags.map((one) => (
                            <span className="tag tag--dept" key={one} style={{ marginRight: 6 }}>
                              {one}
                            </span>
                          ))
                        : <span className="tag tag--all">untagged</span>}
                      {uses > 0 && (
                        <span style={{ marginLeft: 8 }}>
                          in {uses} {uses === 1 ? 'selection' : 'selections'}
                        </span>
                      )}
                    </div>
                  </div>

                  {editable && (
                    <div className="qrow__acts">
                      {question.state !== 'PUBLISHED' && (
                        <button
                          className="qrow__act"
                          onClick={() => setQuestionState(index, 'PUBLISHED')}
                        >
                          Publish
                        </button>
                      )}
                      {question.state === 'PUBLISHED' && (
                        <button
                          className="qrow__act"
                          onClick={() => setQuestionState(index, 'RETIRED')}
                        >
                          Retire
                        </button>
                      )}
                      <button
                        className="qrow__act"
                        onClick={() => setEditing({ question: { ...question }, index })}
                      >
                        Edit
                      </button>
                      {confirmRemove === question.id ? (
                        <span className="qrow__confirm">
                          <button
                            className="qrow__act qrow__act--danger"
                            onClick={() => removeQuestion(index)}
                          >
                            Remove
                          </button>
                          <button className="qrow__act" onClick={() => setConfirmRemove(null)}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          className="qrow__act"
                          onClick={() => setConfirmRemove(question.id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ the selections */}

      <div style={{ marginTop: 20 }}>
        {selections.map((selection, index) => (
          <SelectionCard
            key={selection.id}
            selection={selection}
            others={selections.filter((_, at) => at !== index)}
            bank={questions}
            departments={departments}
            editable={editable}
            saving={busy}
            onChange={(next) => void saveSelection(next)}
            onRemove={() => void removeSelection(selection)}
          />
        ))}
      </div>

      {editable && (
        <button
          className="button button--ghost"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => void addSelection()}
        >
          + Add a selection
        </button>
      )}

      {editing && (
        <QuestionEditor
          question={editing.question}
          index={editing.index}
          knownTags={[...new Set([...tags, ...SUGGESTED_TAGS])]}
          answeredBy={answered.get(editing.question.id) ?? 0}
          onCancel={() => setEditing(null)}
          onSave={saveQuestion}
        />
      )}

      {!isLive && (
        <p className="note">
          Running on mock data — the bank and the selections are this browser&apos;s.
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------- a selection

/**
 * One set of departments and what they are asked.
 *
 * The question list is the whole bank with a checkbox each, rather than a picker that
 * hides what is not chosen: choosing the ten is a comparison, and you cannot compare
 * against things you cannot see.
 */
function SelectionCard({
  selection,
  others,
  bank,
  departments,
  editable,
  saving,
  onChange,
  onRemove,
}: {
  selection: PulseSelection
  others: PulseSelection[]
  bank: PulseQuestion[]
  departments: Department[]
  editable: boolean
  saving: boolean
  onChange: (selection: PulseSelection) => void
  onRemove: () => void
}) {
  const [tag, setTag] = useState<string>(ANY_TAG)
  const tags = useMemo(() => tagsInUse(bank), [bank])
  // Only published questions are offered. Drafts and retired ones are deliberately not
  // shown here rather than shown-and-refused: this list is a menu, and a menu listing
  // things the kitchen will not make wastes the reader's time.
  const shown = byTag(bank, tag).filter(isSelectable)

  const picked = selection.questionIds.length
  const full = picked >= MAX_SELECTED
  const problem = validateSelection(selection, others, bank)

  const reach = isEveryone(selection)
    ? departments.reduce((total, one) => total + one.headcount, 0)
    : departments
        .filter((one) => selection.departments.includes(one.name))
        .reduce((total, one) => total + one.headcount, 0)

  function toggleQuestion(id: string) {
    const on = selection.questionIds.includes(id)
    if (!on && full) return
    onChange({
      ...selection,
      questionIds: on
        ? selection.questionIds.filter((one) => one !== id)
        : [...selection.questionIds, id],
    })
  }

  function toggleDepartment(name: string) {
    onChange({
      ...selection,
      departments: selection.departments.includes(name)
        ? selection.departments.filter((one) => one !== name)
        : [...selection.departments, name],
    })
  }

  return (
    <Card
      chip="🎯"
      chipColour="var(--purple-tint-12)"
      title={selectionLabel(selection)}
      subtitle={`${picked} of ${MAX_SELECTED} questions · ${reach} ${reach === 1 ? 'person' : 'people'}`}
      action={
        editable ? (
          <button className="card__action" disabled={saving} onClick={onRemove}>
            Remove
          </button>
        ) : undefined
      }
    >
      {problem && <div className="error">{problem}</div>}

      <div className="drawer__label">Departments</div>
      <div
        {...clickable(() => editable && onChange({ ...selection, departments: [] }))}
        className={`option ${isEveryone(selection) ? 'option--on' : ''}`}
      >
        <span
          className="option__dot"
          style={{ background: isEveryone(selection) ? 'var(--blue-primary)' : 'var(--ink-12)' }}
        />
        Every department
        <span className="option__tag">
          {departments.reduce((total, one) => total + one.headcount, 0)} people
        </span>
      </div>

      {departments.map((department) => {
        const on = selection.departments.includes(department.name)
        // Named in another selection: showing it as available would offer a choice that
        // is then refused, which is worse than showing it as spoken for.
        const elsewhere = others.some((one) => one.departments.includes(department.name))
        return (
          <div
            key={department.name}
            {...clickable(() => editable && !elsewhere && toggleDepartment(department.name))}
            className={`option ${on ? 'option--on' : ''}`}
            style={elsewhere ? { opacity: 0.4 } : undefined}
          >
            <span
              className="option__dot"
              style={{ background: on ? 'var(--blue-primary)' : 'var(--ink-12)' }}
            />
            {department.name}
            <span className="option__tag">
              {elsewhere ? 'in another selection' : department.headcount}
            </span>
          </div>
        )
      })}

      <div className="drawer__label" style={{ marginTop: 16 }}>
        Questions — {picked} of {MAX_SELECTED}
        {full && <span style={{ color: 'var(--text-muted)' }}> · at the cap</span>}
      </div>

      {tags.length > 0 && (
        <div className="chips" style={{ marginBottom: 8 }}>
          <button
            className={`chip ${tag === ANY_TAG ? 'chip--on' : ''}`}
            onClick={() => setTag(ANY_TAG)}
          >
            {ANY_TAG}
          </button>
          {tags.map((one) => (
            <button
              key={one}
              className={`chip ${tag === one ? 'chip--on' : ''}`}
              onClick={() => setTag(one)}
            >
              {one}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty>
          {tag === ANY_TAG
            ? 'No published questions yet. Publish one from the bank above.'
            : `Nothing published under ${tag}.`}
        </Empty>
      ) : (
        shown.map((question) => {
          const on = selection.questionIds.includes(question.id)
          const order = selection.questionIds.indexOf(question.id) + 1
          return (
            <div
              key={question.id}
              {...clickable(() => editable && toggleQuestion(question.id))}
              className={`option ${on ? 'option--on' : ''}`}
              // Dimmed rather than hidden at the cap: the row still says what it is,
              // and the counter above says why it will not take.
              style={!on && full ? { opacity: 0.4 } : undefined}
            >
              <span
                className="option__dot"
                style={{ background: on ? 'var(--blue-primary)' : 'var(--ink-12)' }}
              />
              {question.question}
              <span className="option__tag">{on ? `#${order}` : question.tags[0] ?? ''}</span>
            </div>
          )
        })
      )}

      {picked > 0 && (
        <>
          <div className="drawer__label" style={{ marginTop: 16 }}>
            In this order
          </div>
          <div className="qpreview">
            {questionsIn(bank, selection).map((question, at) => (
              <div className="qpreview__option" key={question.id}>
                {at + 1}. {question.question}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------- the editor

function QuestionEditor({
  question,
  index,
  knownTags,
  answeredBy,
  onCancel,
  onSave,
}: {
  question: PulseQuestion
  index: number
  knownTags: string[]
  answeredBy: number
  onCancel: () => void
  onSave: (question: PulseQuestion, index: number) => void
}) {
  const [draft, setDraft] = useState<PulseQuestion>(question)
  const [tagDraft, setTagDraft] = useState('')
  const problem = validateQuestion(draft)

  function set(patch: Partial<PulseQuestion>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function setOption(at: number, value: string) {
    set({ options: draft.options.map((option, index) => (index === at ? value : option)) })
  }

  function toggleTag(raw: string) {
    const tag = normaliseTag(raw)
    if (!tag) return
    if (draft.tags.includes(tag)) {
      set({ tags: draft.tags.filter((one) => one !== tag) })
      return
    }
    if (draft.tags.length >= MAX_TAGS_PER_QUESTION) return
    set({ tags: [...draft.tags, tag] })
  }

  return (
    <Drawer
      title={index < 0 ? 'New question' : 'Edit question'}
      subtitle="Written once, used in any selection"
      onClose={onCancel}
    >
      {answeredBy > 0 && (
        <div className="banner banner--warn" style={{ marginTop: 18 }}>
          <div className="banner__title">{answeredBy} people have already answered this</div>
          <div className="banner__body">
            Their answers stay as they are. Rewording the question or changing the
            answers now means this cycle&apos;s numbers are a mix of two different
            questions — add a new one instead if the meaning changes.
          </div>
        </div>
      )}

      <div className="drawer__label">Question</div>
      <textarea
        value={draft.question}
        maxLength={MAX_QUESTION_LENGTH}
        placeholder="Is your workload manageable right now?"
        onChange={(event) => set({ question: event.target.value })}
        style={{ minHeight: 68 }}
      />
      <div className="field-foot">
        {draft.question.length}/{MAX_QUESTION_LENGTH}
      </div>

      <div className="drawer__label">Hint (optional)</div>
      <input
        className="search"
        value={draft.hint}
        placeholder="Think about the last two weeks rather than today."
        onChange={(event) => set({ hint: event.target.value })}
      />

      <div className="drawer__label">State</div>
      <div className="chips" style={{ marginBottom: 4 }}>
        {QUESTION_STATES.map((one) => (
          <button
            key={one}
            className={`chip ${draft.state === one ? 'chip--on' : ''}`}
            onClick={() => set({ state: one })}
          >
            {STATE_LABEL[one]}
          </button>
        ))}
      </div>
      <div className="field-foot">
        {draft.state === 'PUBLISHED'
          ? 'Can be put into a selection.'
          : draft.state === 'DRAFT'
            ? 'Still being written. Cannot be asked.'
            : 'Kept for the record, no longer asked.'}
      </div>

      <div className="drawer__label">Tags</div>
      <div className="chips" style={{ marginBottom: 8 }}>
        {knownTags.map((one) => (
          <button
            key={one}
            className={`chip ${draft.tags.includes(one) ? 'chip--on' : ''}`}
            onClick={() => toggleTag(one)}
          >
            {one}
          </button>
        ))}
      </div>
      <input
        className="search"
        value={tagDraft}
        placeholder="Add a tag and press Enter"
        onChange={(event) => setTagDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          toggleTag(tagDraft)
          setTagDraft('')
        }}
      />
      <div className="field-foot">
        {draft.tags.length}/{MAX_TAGS_PER_QUESTION} · tags are how a selection finds this
        question later
      </div>

      <div className="drawer__label">Answers</div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {SCALES.map((scale) => (
          <button
            key={scale.label}
            className={`chip ${sameOptions(draft.options, scale.options) ? 'chip--on' : ''}`}
            onClick={() => set({ options: [...scale.options] })}
          >
            {scale.label}
          </button>
        ))}
      </div>
      {draft.options.map((option, at) => (
        <div className="opt-edit" key={at}>
          <span className="opt-edit__dot" />
          <input
            className="search"
            value={option}
            placeholder={`Answer ${at + 1}`}
            onChange={(event) => setOption(at, event.target.value)}
          />
          <button
            className="opt-edit__remove"
            disabled={draft.options.length <= MIN_OPTIONS}
            onClick={() => set({ options: draft.options.filter((_, index) => index !== at) })}
            aria-label="Remove answer"
          >
            ✕
          </button>
        </div>
      ))}
      {draft.options.length < MAX_OPTIONS && (
        <button
          className="button button--ghost"
          style={{ marginTop: 4 }}
          onClick={() => set({ options: [...draft.options, ''] })}
        >
          + Add answer
        </button>
      )}

      <div className="drawer__label">How it looks in the app</div>
      <div className="qpreview">
        <div className="qpreview__text">{draft.question || 'Your question'}</div>
        {draft.hint && <div className="qpreview__hint">{draft.hint}</div>}
        {draft.options
          .filter((option) => option.trim())
          .map((option, at) => (
            <div className="qpreview__option" key={at}>
              {option}
            </div>
          ))}
      </div>

      {problem && <div className="error">{problem}</div>}
      <button className="button" disabled={Boolean(problem)} onClick={() => onSave(draft, index)}>
        {index < 0 ? 'Add to the bank' : 'Save changes'}
      </button>
      <button className="button button--ghost" onClick={onCancel}>
        Cancel
      </button>
    </Drawer>
  )
}

function sameOptions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((option, at) => option === b[at])
}
