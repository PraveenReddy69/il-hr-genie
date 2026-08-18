/**
 * Authoring the monthly pulse.
 *
 * HR writes the questions here and chooses which departments get asked each one. The
 * two things worth designing for: a department that ends up with nothing to answer
 * (an empty pulse, and nobody notices until the response rate is zero), and editing a
 * question people have already answered this cycle (the wording changes, the answers
 * do not, and the comparison quietly stops meaning anything).
 */

import { useEffect, useMemo, useState } from 'react'
import { Card, Empty, Loading, clickable } from '../components/Bits'
import { Drawer } from '../components/Drawer'
import { fetchEmployees, fetchPulseBreakdown, isLive } from '../api/client'
import { currentCycle } from '../api/mock'
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  SCALES,
  blankQuestion,
  departmentLabel,
  discardLocalBank,
  fetchQuestionBank,
  newQuestionId,
  nextCycleLabel,
  questionsFor,
  saveQuestionBank,
  validateQuestion,
  type PulseQuestion,
} from '../api/pulseQuestions'

interface Department {
  name: string
  headcount: number
}

/**
 * The question bank.
 *
 * `editable` is `pulse.publish`, which HRBPs do not hold — they read the bank so they
 * know what their people are being asked, and Admin decides the wording. The controls
 * are removed rather than disabled: a row of greyed buttons on every question is a
 * worse way to say "not yours" than not drawing them, and this page is mostly buttons.
 */
export function PulseQuestions({ editable = true }: { editable?: boolean }) {
  const [questions, setQuestions] = useState<PulseQuestion[] | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  /** questionId -> people who have already answered it this cycle. */
  const [answered, setAnswered] = useState<Map<string, number>>(new Map())
  const [editing, setEditing] = useState<{ question: PulseQuestion; index: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    fetchQuestionBank().then((bank) => {
      setQuestions(bank.questions)
      setUnsaved(bank.unsaved)
    })

    fetchEmployees().then((people) => {
      const counts = new Map<string, number>()
      people.forEach((person) => {
        if (!person.department) return
        counts.set(person.department, (counts.get(person.department) ?? 0) + 1)
      })
      setDepartments(
        [...counts.entries()]
          .map(([name, headcount]) => ({ name, headcount }))
          .sort((a, b) => b.headcount - a.headcount),
      )
    })

    // Only to warn before an edit rewrites what an answer meant. A failure here is
    // not worth blocking authoring over — it costs the warning, not the page.
    fetchPulseBreakdown(currentCycle())
      .then((rows) => {
        setAnswered(
          new Map(
            rows.map((row) => [
              row.questionId,
              row.answers.reduce((total, answer) => total + answer.count, 0),
            ]),
          ),
        )
      })
      .catch(() => undefined)
  }, [])

  /**
   * Every change is written straight away — there is no half-saved state to lose.
   *
   * The write can still fail (a full storage quota, private browsing), and silently
   * losing an edit that is on screen is the one outcome worth ruling out: the change
   * is kept either way and the failure is said out loud.
   */
  function commit(next: PulseQuestion[]) {
    setQuestions(next)
    setUnsaved(true)
    try {
      saveQuestionBank(next)
      setSaveError(null)
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Could not save that change.')
    }
  }

  function move(index: number, by: number) {
    if (!questions) return
    const to = index + by
    if (to < 0 || to >= questions.length) return
    const next = [...questions]
    ;[next[index], next[to]] = [next[to], next[index]]
    commit(next)
  }

  function remove(index: number) {
    if (!questions) return
    commit(questions.filter((_, at) => at !== index))
    setConfirmRemove(null)
  }

  function save(question: PulseQuestion, index: number) {
    if (!questions) return
    const cleaned: PulseQuestion = {
      ...question,
      question: question.question.trim(),
      hint: question.hint.trim(),
      options: question.options.map((option) => option.trim()).filter(Boolean),
    }
    if (index < 0) {
      const id = newQuestionId(cleaned.question, questions.map((one) => one.id))
      commit([...questions, { ...cleaned, id }])
    } else {
      // The id is deliberately not taken from the form: it is what every answer ever
      // given is keyed by.
      commit(questions.map((one, at) => (at === index ? { ...cleaned, id: one.id } : one)))
    }
    setEditing(null)
  }

  const coverage = useMemo(() => {
    const list = questions ?? []
    return departments.map((department) => ({
      ...department,
      asked: questionsFor(list, department.name).length,
    }))
  }, [questions, departments])

  if (!questions) return <Loading />

  const everyone = questions.filter((question) => question.departments.length === 0).length
  const targeted = questions.length - everyone
  const uncovered = coverage.filter((department) => department.asked === 0)
  const full = questions.length >= MAX_QUESTIONS

  return (
    <>
      <div className="page-head">
        <h1>Pulse questions</h1>
        <p>
          {questions.length} of {MAX_QUESTIONS} · asked in {nextCycleLabel()}
        </p>
      </div>

      <div className="banner banner--info">
        <div className="banner__title">Not on the server yet</div>
        <div className="banner__body">
          The backend serves the question bank read-only — there is no route to create
          or edit one. Everything here is kept in this browser so the wording and the
          department split can be agreed now; it reaches employees once the four routes
          in <code>docs/PULSE_QUESTIONS_BACKEND.md</code> exist.
          {unsaved && (
            <>
              {' '}
              <button
                className="linkish"
                onClick={() => {
                  discardLocalBank()
                  fetchQuestionBank().then((bank) => {
                    setQuestions(bank.questions)
                    setUnsaved(bank.unsaved)
                  })
                }}
              >
                Discard local edits
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && <div className="error">{saveError}</div>}

      <div className="grid grid--3">
        <div className="tile tile--blue">
          <div className="tile__value">
            {questions.length}
            <small> / {MAX_QUESTIONS}</small>
          </div>
          <div className="tile__label">Questions</div>
          <div className="tile__sub">
            {full ? 'At the cap' : `${MAX_QUESTIONS - questions.length} more allowed`}
          </div>
        </div>
        <div className="tile tile--purple">
          <div className="tile__value">{everyone}</div>
          <div className="tile__label">Asked of everyone</div>
          <div className="tile__sub">{targeted} scoped to departments</div>
        </div>
        <div className={`tile ${uncovered.length ? 'tile--amber' : 'tile--green'}`}>
          <div className="tile__value">
            {coverage.length - uncovered.length}
            <small> / {coverage.length}</small>
          </div>
          <div className="tile__label">Departments covered</div>
          <div className="tile__sub">
            {uncovered.length === 0
              ? 'Everyone gets something to answer'
              : `${uncovered.length} would get an empty pulse`}
          </div>
        </div>
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <Card
          chip="✎"
          chipColour="var(--blue-tint-12)"
          title="The bank"
          subtitle="In the order employees are asked"
          action={
            editable ? (
              <button
                className="card__action"
                disabled={full}
                title={full ? `A pulse is capped at ${MAX_QUESTIONS} questions.` : undefined}
                onClick={() => setEditing({ question: blankQuestion(), index: -1 })}
              >
                + Add question
              </button>
            ) : undefined
          }
        >
          {questions.length === 0 && <Empty>No questions yet. Nobody would be asked anything.</Empty>}

          {questions.map((question, index) => (
            <div className="qrow" key={question.id}>
              <div className="qrow__ord">
                <button
                  className="qrow__move"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                >
                  ▲
                </button>
                <span className="qrow__num">{index + 1}</span>
                <button
                  className="qrow__move"
                  onClick={() => move(index, 1)}
                  disabled={index === questions.length - 1}
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>

              <div className="qrow__main">
                <div className="qrow__text">{question.question}</div>
                {question.hint && <div className="qrow__hint">{question.hint}</div>}
                <div className="qrow__options">
                  {question.options.map((option) => (
                    <span className="qrow__option" key={option}>
                      {option}
                    </span>
                  ))}
                </div>
                <div className="qrow__foot">
                  <span
                    className={`tag ${question.departments.length === 0 ? 'tag--all' : 'tag--dept'}`}
                    title={question.departments.join(', ')}
                  >
                    {departmentLabel(question.departments)}
                  </span>
                  {(answered.get(question.id) ?? 0) > 0 && (
                    <span className="tag tag--live">
                      {answered.get(question.id)} answered this cycle
                    </span>
                  )}
                </div>
              </div>

              <div className="qrow__acts">
                {editable && (
                  <button
                    className="qrow__act"
                    onClick={() => setEditing({ question: { ...question }, index })}
                  >
                    Edit
                  </button>
                )}
                {editable &&
                  (confirmRemove === question.id ? (
                    <span className="qrow__confirm">
                      <button className="qrow__act qrow__act--danger" onClick={() => remove(index)}>
                        Remove
                      </button>
                      <button className="qrow__act" onClick={() => setConfirmRemove(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button className="qrow__act" onClick={() => setConfirmRemove(question.id)}>
                      Remove
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </Card>

        <Card
          chip="◎"
          chipColour="var(--green-tint-14)"
          title="Who is asked what"
          subtitle={`${departments.length} departments in the directory`}
        >
          {departments.length === 0 && <Empty>Directory not loaded.</Empty>}
          {coverage.map((department) => (
            <div className="row" key={department.name}>
              <div className="row__main">
                <div className="row__title">{department.name}</div>
                <div className="row__meta">
                  {department.headcount} {department.headcount === 1 ? 'person' : 'people'}
                </div>
              </div>
              <span className={`pill ${department.asked === 0 ? 'pill--open' : 'pill--neutral'}`}>
                {department.asked === 0
                  ? 'nothing to answer'
                  : `${department.asked} question${department.asked === 1 ? '' : 's'}`}
              </span>
            </div>
          ))}
          <p className="note">
            A question with no departments goes to everyone. A department with nothing
            still gets the pulse invitation, and opens an empty form.
          </p>
        </Card>
      </div>

      {editing && (
        <QuestionEditor
          question={editing.question}
          index={editing.index}
          departments={departments}
          answeredBy={answered.get(editing.question.id) ?? 0}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------- the editor

function QuestionEditor({
  question,
  index,
  departments,
  answeredBy,
  onCancel,
  onSave,
}: {
  question: PulseQuestion
  index: number
  departments: Department[]
  answeredBy: number
  onCancel: () => void
  onSave: (question: PulseQuestion, index: number) => void
}) {
  const [draft, setDraft] = useState<PulseQuestion>(question)
  const problem = validateQuestion(draft)

  function set(patch: Partial<PulseQuestion>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function setOption(at: number, value: string) {
    set({ options: draft.options.map((option, index) => (index === at ? value : option)) })
  }

  function toggleDepartment(name: string) {
    set({
      departments: draft.departments.includes(name)
        ? draft.departments.filter((one) => one !== name)
        : [...draft.departments, name],
    })
  }

  const reach = draft.departments.length
    ? departments
        .filter((department) => draft.departments.includes(department.name))
        .reduce((total, department) => total + department.headcount, 0)
    : departments.reduce((total, department) => total + department.headcount, 0)

  return (
    <Drawer
      title={index < 0 ? 'New question' : 'Edit question'}
      subtitle={`Goes to ${reach} ${reach === 1 ? 'person' : 'people'}`}
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

      <div className="drawer__label">Who gets asked</div>
      <div
        {...clickable(() => set({ departments: [] }))}
        className={`option ${draft.departments.length === 0 ? 'option--on' : ''}`}
      >
        <span
          className="option__dot"
          style={{
            background: draft.departments.length === 0 ? 'var(--blue-primary)' : 'var(--ink-12)',
          }}
        />
        Everyone
        <span className="option__tag">
          {departments.reduce((total, department) => total + department.headcount, 0)} people
        </span>
      </div>

      {departments.map((department) => {
        const on = draft.departments.includes(department.name)
        return (
          <div
            key={department.name}
            {...clickable(() => toggleDepartment(department.name))}
            className={`option ${on ? 'option--on' : ''}`}
          >
            <span
              className="option__dot"
              style={{ background: on ? 'var(--blue-primary)' : 'var(--ink-12)' }}
            />
            {department.name}
            <span className="option__tag">{department.headcount}</span>
          </div>
        )
      })}

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
        {index < 0 ? 'Add to the pulse' : 'Save changes'}
      </button>
      <button className="button button--ghost" onClick={onCancel}>
        Cancel
      </button>

      {!isLive && <p className="note">Running on mock data — the directory is seeded.</p>}
    </Drawer>
  )
}

function sameOptions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((option, index) => option === b[index])
}
