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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Loading, clickable } from '../components/Bits'
import { Drawer } from '../components/Drawer'
import {
  fetchAskedHistory,
  fetchEmployees,
  fetchPulseBreakdown,
  isLive,
  type AskedCycle,
} from '../api/client'
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
  forgetHidden,
  pruneHidden,
  rememberHidden,
  type HiddenNote,
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

/*
 * How many departments a selection lists before it needs asking.
 *
 * Six covers the ones with real headcount here — the tail is single-digit teams — so
 * the common edit is done without expanding anything, and the full list is one click
 * away rather than a permanent forty-row column beside the questions.
 */
const DEPTS_SHOWN = 6

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
  /** Ids this browser has watched drop off the list. See the note in pulseQuestions.ts. */
  const [hidden, setHidden] = useState<HiddenNote[]>([])
  /** What was actually asked each month, worked out from the answers. */
  const [asked, setAsked] = useState<AskedCycle[] | null>(null)

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
    // Anything on the list needs no recovering, whoever published it.
    setHidden(pruneHidden(bank.questions))
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

    // Its own request rather than part of `reload`: it is twelve calls, it does not
    // change when a question is edited, and the bank should not wait for it.
    fetchAskedHistory(12)
      .then(setAsked)
      .catch(() => setAsked([]))

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
    // The id is made here after all — the endpoint requires a kebab-case slug and
    // rejects a payload without one. The ids already in the bank go with it so a second
    // question about workload does not collide with the first.
    const ok = await attempt(() =>
      index < 0 || !question.id
        ? createQuestion(question, (questions ?? []).map((one) => one.id))
        : updateQuestion(question.id, question),
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

    /*
     * Written down before the write, not after.
     *
     * Once it is retired the list stops returning it, so if the note were made from the
     * reloaded bank there would be nothing left to make it from. Recording it first
     * costs an unused note if the save then fails, which prune clears on the next load.
     */
    if (next !== 'PUBLISHED') setHidden(rememberHidden(question, next))

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

    if (ok && next === 'PUBLISHED') setHidden(forgetHidden(question.id))

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
    /*
     * A selection that does not exist yet is edited here, not on the server.
     *
     * It appears with no questions and no departments, which is exactly the shape the
     * create endpoint refuses. Sending every keystroke of it meant the first few edits
     * were POSTed, rejected, and dropped — so ticking a department before choosing a
     * question did nothing at all, silently, while the page invited you to do just that.
     *
     * It is held locally until it is complete enough to be accepted, and created then.
     * `bank` is captured because narrowing from the early return does not reach inside
     * this closure.
     */
    const bank = questions ?? []
    if (isUnsaved(next)) {
      setSelections((current) => current.map((one) => (one.id === next.id ? next : one)))
      const others = selections.filter((one) => one.id !== next.id)
      if (validateSelection(next, others, bank)) return Promise.resolve(true)
      return attempt(() => createSelection(next))
    }
    return attempt(() => updateSelection(next.id, next))
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

  /**
   * Put a question back on the list.
   *
   * The only route back for something the list will not return: PATCH works on any id,
   * published or not, so setting the state is enough to make it reappear. Used both by
   * the remembered notes and by the id box, which is the only way to reach a question
   * hidden before this browser was watching.
   */
  async function publishById(id: string) {
    const wanted = id.trim().toLowerCase()
    if (!wanted) return false
    const ok = await attempt(() => updateQuestion(wanted, { state: 'PUBLISHED' }))
    if (ok) setHidden(forgetHidden(wanted))
    return ok
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

      <section className="card bankcard">
        <div className="bankbar">
          <div className="chips">
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
                {/*
                  Questions this browser knows are hidden count too. The list cannot
                  return drafts or retired questions, so counting only what it returned
                  put "Retired · 0" directly above a panel offering to restore one.
                  It is still a floor rather than a total, which the panel says.
                */}
                {STATE_LABEL[one]} ·{' '}
                {counts[one] + hidden.filter((note) => note.state === one).length}
              </button>
            ))}
          </div>

          {editable && (
            <button
              className="button bankbar__add"
              onClick={() => setEditing({ question: blankQuestion(), index: -1 })}
            >
              <PlusIcon />
              Add question
            </button>
          )}
        </div>

        {/*
          A select rather than a row of chips.

          Tags are open-ended — anybody writing a question can coin one — so the chip row
          grew with the bank and pushed the questions themselves off the first screen.
          A select is one control at a fixed size however many tags exist, and it hands
          the long-list behaviour to the platform, which does it better than a scroller
          built here would.
        */}
        <div className="tagpick">
          <select
            className="tagpick__select"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            aria-label="Filter by tag"
          >
            <option value={ANY_TAG}>{ANY_TAG}</option>
            {tags.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>

        {editable && (state === 'DRAFT' || state === 'RETIRED') && (
          <HiddenPanel
            state={state}
            notes={hidden.filter((one) => one.state === state)}
            busy={busy}
            onPublish={publishById}
            onForget={(id) => setHidden(forgetHidden(id))}
          />
        )}

        {shown.length === 0 ? (
          <Empty style={{ marginTop: 14 }}>
            {tag === ANY_TAG && state === ANY_STATE
              ? 'No questions yet. Nobody would be asked anything.'
              : 'Nothing here matches those filters.'}
          </Empty>
        ) : (
          <div className="qlist">
            {shown.map((question) => {
              const index = questions.indexOf(question)
              const uses = selections.filter((one) =>
                one.questionIds.includes(question.id),
              ).length
              return (
                <QuestionRow
                  key={question.id}
                  question={question}
                  uses={uses}
                  editable={editable}
                  confirming={confirmRemove === question.id}
                  onConfirm={() => setConfirmRemove(question.id)}
                  onKeep={() => setConfirmRemove(null)}
                  onRemove={() => void removeQuestion(index)}
                  onEdit={() => setEditing({ question: { ...question }, index })}
                  onState={(next) => void setQuestionState(index, next)}
                />
              )
            })}
          </div>
        )}
      </section>

      <AskedByMonth
        history={asked}
        bank={questions}
        selections={selections}
        cycle={currentCycle()}
      />

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
        <button className="addsel" disabled={busy} onClick={() => void addSelection()}>
          <PlusIcon />
          Add a selection
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

// ------------------------------------------------------------- asked by month

/**
 * Which questions went out in which month.
 *
 * The question HR asks about their own programme is "what did we ask in August" — and
 * nothing on the server answers it directly. A selection has departments and question
 * ids and no cycle, so it describes the present and forgets everything else. The
 * answers remember: each one carries a cycle and is keyed by question id.
 *
 * So the past is read off the replies, and the present is read off the selections,
 * and the two are labelled differently because they are not the same claim. "4 people
 * answered" is a fact about August. "Planned" is a statement about what is set up
 * right now, which anybody can change before the month is out.
 */
function AskedByMonth({
  history,
  bank,
  selections,
  cycle,
}: {
  history: AskedCycle[] | null
  bank: PulseQuestion[]
  selections: PulseSelection[]
  cycle: string
}) {
  const [year, setYear] = useState<string>('')

  const years = useMemo(() => {
    const found = new Set((history ?? []).map((one) => one.cycle.slice(0, 4)))
    found.add(cycle.slice(0, 4))
    return [...found].sort().reverse()
  }, [history, cycle])

  const showing = year || years[0] || cycle.slice(0, 4)
  const months = (history ?? []).filter((one) => one.cycle.slice(0, 4) === showing)
  const answeredThisCycle = (history ?? []).some((one) => one.cycle === cycle)
  const planned = showing === cycle.slice(0, 4) && !answeredThisCycle

  function nameOf(id: string): string | null {
    return bank.find((one) => one.id === id)?.question ?? null
  }

  return (
    <section className="card askedcard">
      <div className="asked__head">
        <div>
          <h2 className="asked__title">What we asked, by month</h2>
          <p className="asked__sub">
            Taken from the answers themselves — nothing on the server records the
            programme month by month.
          </p>
        </div>
        {years.length > 1 && (
          <div className="tagpick">
            <select
              className="tagpick__select"
              value={showing}
              onChange={(event) => setYear(event.target.value)}
              aria-label="Year"
            >
              {years.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>
        )}
      </div>

      {history === null ? (
        <div className="asked__loading">Reading the last twelve months\u2026</div>
      ) : (
        <div className="asked__list">
          {planned && (
            <div className="askmonth askmonth--planned">
              <div className="askmonth__head">
                <span className="askmonth__name">{monthName(cycle)}</span>
                <span className="askmonth__tag askmonth__tag--planned">Planned</span>
                <span className="askmonth__count">nobody has answered yet</span>
              </div>

              {selections.length === 0 ? (
                <div className="askmonth__none">
                  No selection, so nobody is being asked anything this month.
                </div>
              ) : (
                selections.map((selection) => (
                  <div className="askgroup" key={selection.id}>
                    <div className="askgroup__who">{selectionLabel(selection)}</div>
                    {selection.questionIds.length === 0 ? (
                      <div className="askmonth__none">No questions picked.</div>
                    ) : (
                      selection.questionIds.map((id) => (
                        <div className="askq" key={id}>
                          <span className="askq__text">
                            {nameOf(id) ?? <code className="askq__id">{id}</code>}
                          </span>
                          {!nameOf(id) && (
                            <span className="askq__missing">not on the list</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {months.length === 0 && !planned ? (
            <Empty>No answers recorded in {showing}.</Empty>
          ) : (
            months.map((month) => (
              <div className="askmonth" key={month.cycle}>
                <div className="askmonth__head">
                  <span className="askmonth__name">{monthName(month.cycle)}</span>
                  <span className="askmonth__count">
                    {month.people} {month.people === 1 ? 'person' : 'people'} answered
                  </span>
                </div>
                {month.questions.map((question) => (
                  <div className="askq" key={question.id}>
                    <span className="askq__text">
                      {nameOf(question.id) ?? <code className="askq__id">{question.id}</code>}
                    </span>
                    {!nameOf(question.id) && (
                      <span className="askq__missing">not on the list</span>
                    )}
                    <span className="askq__n">{question.answers}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/*
        Said once, at the bottom, rather than beside every row it applies to.

        A retired question is not returned by the list endpoint, so a month that asked
        one shows its id and nothing else — August asked `experience` and this console
        cannot name it. That is section 6d, not a gap in the record.
      */}
      <p className="note">
        A question shown as an id was asked but is no longer on the list — retired or
        still a draft. The answers are kept either way.
      </p>
    </section>
  )
}

/** "August 2026" from "2026-08". */
function monthName(cycle: string): string {
  return new Date(`${cycle}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

// ------------------------------------------------- questions the API will not list

/**
 * The way back to a question that has stopped being listed.
 *
 * Shown only under the Draft and Retired filters, which is exactly when somebody is
 * looking for one and finding nothing. It says why the list is empty rather than
 * leaving "no questions" to imply there are none — there may well be several, and one
 * is known to exist already.
 *
 * Delete the whole thing when §6d of docs/BACKEND_HANDOVER.md ships. It exists because
 * the list endpoint returns published questions only.
 */
function HiddenPanel({
  state,
  notes,
  busy,
  onPublish,
  onForget,
}: {
  state: string
  notes: HiddenNote[]
  busy: boolean
  onPublish: (id: string) => Promise<boolean>
  onForget: (id: string) => void
}) {
  const [byId, setById] = useState('')
  const [open, setOpen] = useState(false)
  const label = state === 'DRAFT' ? 'drafts' : 'retired questions'

  return (
    <div className="hidepanel">
      <div className="hidepanel__head">
        <WarnIcon />
        <div>
          <div className="hidepanel__title">The API does not return {label}</div>
          <div className="hidepanel__body">
            They are saved and they are safe — they just cannot be listed yet. Publishing
            one brings it back here, and it can be edited or retired again from there.
          </div>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="hidelist">
          {notes.map((note) => (
            <div className="hiderow" key={note.id}>
              <span className="hiderow__text">{note.question || note.id}</span>
              <code className="hiderow__id">{note.id}</code>
              <button
                className="ghostbtn ghostbtn--sm"
                disabled={busy}
                onClick={() => void onPublish(note.id)}
              >
                <PublishIcon />
                Publish
              </button>
              {/* Wrong note, or somebody deleted the question outright. Dropping it is
                  local only — it never touches the question itself. */}
              <button
                className="hiderow__drop"
                onClick={() => onForget(note.id)}
                aria-label={`Forget ${note.id}`}
                title="Remove from this list"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {/*
        Hidden before this browser started watching — `experience` is the live example.
        Nothing knows its id but the person who wrote it, so they type it.
      */}
      {open ? (
        <form
          className="hideform"
          onSubmit={(event) => {
            event.preventDefault()
            void onPublish(byId).then((ok) => ok && setById(''))
          }}
        >
          <input
            className="search hideform__input"
            value={byId}
            onChange={(event) => setById(event.target.value)}
            placeholder="Question id, e.g. experience"
            aria-label="Question id to publish"
          />
          <button className="ghostbtn ghostbtn--sm" disabled={busy || !byId.trim()}>
            Publish it
          </button>
        </form>
      ) : (
        <button className="hidepanel__more" onClick={() => setOpen(true)}>
          Know the id of one that is not here? Publish it by id
        </button>
      )}
    </div>
  )
}

function WarnIcon() {
  return (
    <svg className="hidepanel__glyph" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.8v4.8M12 15.9v.1" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

// -------------------------------------------------------------- one bank row

/**
 * A question in the bank.
 *
 * Two actions are on the row and the rest are behind the overflow: Edit and the state
 * change are what HR does weekly, and Remove is the one that destroys answers. Putting
 * all four in a line of equal buttons made deleting a question exactly as easy as
 * editing one, which is the wrong shape for a list you scan quickly.
 */
function QuestionRow({
  question,
  uses,
  editable,
  confirming,
  onConfirm,
  onKeep,
  onRemove,
  onEdit,
  onState,
}: {
  question: PulseQuestion
  uses: number
  editable: boolean
  confirming: boolean
  onConfirm: () => void
  onKeep: () => void
  onRemove: () => void
  onEdit: () => void
  onState: (next: QuestionState) => void
}) {
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  /*
   * Close on a click anywhere else, and on Escape.
   *
   * Both, not either: a menu that only closes on Escape strands anyone using a mouse,
   * and one that only closes on an outside click strands anyone who opened it by
   * keyboard and does not want to move the pointer to get out.
   */
  useEffect(() => {
    if (!menu) return
    function away(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setMenu(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])

  // Closing the menu has to take the confirmation with it, or reopening it later shows
  // a "Remove / Keep" pair for a decision nobody is currently making.
  useEffect(() => {
    if (!menu && confirming) onKeep()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu])

  const published = question.state === 'PUBLISHED'

  return (
    <div className={`qcard ${confirming ? 'qcard--confirming' : ''}`}>
      <span className={`qcard__mark qcard__mark--${question.state.toLowerCase()}`}>
        <ClipboardIcon />
      </span>

      <div className="qcard__main">
        <div className="qcard__title">
          {question.question}
          <span
            className={`statepill statepill--${question.state.toLowerCase()}`}
          >
            {STATE_LABEL[question.state]}
          </span>
        </div>
        <div className="qcard__meta">
          {question.tags.length > 0 ? (
            question.tags.map((one) => (
              <span className="tag tag--dept" key={one}>
                {one}
              </span>
            ))
          ) : (
            <span className="qcard__untagged">untagged</span>
          )}
          {uses > 0 && (
            <span className="qcard__uses">
              in {uses} {uses === 1 ? 'selection' : 'selections'}
            </span>
          )}
        </div>
      </div>

      {editable && (
        <div className="qcard__acts">
          <button
            className="ghostbtn ghostbtn--sm"
            onClick={() => onState(published ? 'RETIRED' : 'PUBLISHED')}
          >
            {published ? <RetireIcon /> : <PublishIcon />}
            {published ? 'Retire' : 'Publish'}
          </button>
          <button className="ghostbtn ghostbtn--sm" onClick={onEdit}>
            <PencilIcon />
            Edit
          </button>

          <div className="qmenu" ref={box}>
            <button
              className={`qmenu__open ${menu ? 'qmenu__open--on' : ''}`}
              onClick={() => setMenu((on) => !on)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`More actions for ${question.question}`}
            >
              <DotsIcon />
            </button>

            {menu && (
              <div className="qmenu__pop" role="menu">
                {confirming ? (
                  <>
                    <div className="qmenu__ask">
                      {uses > 0
                        ? `In ${uses} ${uses === 1 ? 'selection' : 'selections'}. Answers already given go too.`
                        : 'Answers already given go with it.'}
                    </div>
                    <button
                      className="qmenu__item qmenu__item--danger"
                      role="menuitem"
                      onClick={() => {
                        setMenu(false)
                        onRemove()
                      }}
                    >
                      <TrashIcon />
                      Yes, remove it
                    </button>
                    <button className="qmenu__item" role="menuitem" onClick={onKeep}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    className="qmenu__item qmenu__item--danger"
                    role="menuitem"
                    onClick={onConfirm}
                  >
                    <TrashIcon />
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the glyphs

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M9 4.5h6a1 1 0 011 1v1H8v-1a1 1 0 011-1z" />
      <path d="M8 6.5H6.6a1.6 1.6 0 00-1.6 1.6v10.4a1.6 1.6 0 001.6 1.6h10.8a1.6 1.6 0 001.6-1.6V8.1a1.6 1.6 0 00-1.6-1.6H16" />
      <path d="M8.8 11.5h6.4M8.8 15h4.2" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M4.5 19.5l.9-3.6L15.3 6a1.8 1.8 0 012.5 0l.6.6a1.8 1.8 0 010 2.5L8.5 18.9z" />
    </svg>
  )
}

function RetireIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M7.5 12h9" />
    </svg>
  )
}

function PublishIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8.6 12.2l2.3 2.3 4.5-4.8" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="12" cy="5.6" r="1.55" />
      <circle cx="12" cy="12" r="1.55" />
      <circle cx="12" cy="18.4" r="1.55" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M5.5 7h13M10 7V5.6a1 1 0 011-1h2a1 1 0 011 1V7" />
      <path d="M7 7l.8 11.4a1.6 1.6 0 001.6 1.5h5.2a1.6 1.6 0 001.6-1.5L17 7" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 5.8v12.4M5.8 12h12.4" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg className="tagpick__chev" viewBox="0 0 24 24" {...S} aria-hidden="true">
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </svg>
  )
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="12" cy="12" r="7.6" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6" />
    </svg>
  )
}

/**
 * The tick box on a department row.
 *
 * Three states, and the third is the one worth drawing properly: a department already
 * spoken for by another selection cannot be chosen here, and a plain empty box would
 * invite the click that is about to be refused. It gets a bar rather than a tick.
 */
function Tick({ on, blocked = false }: { on: boolean; blocked?: boolean }) {
  return (
    <span
      className={`deptick ${on ? 'deptick--on' : ''} ${blocked ? 'deptick--blocked' : ''}`}
      aria-hidden="true"
    >
      {on && (
        <svg viewBox="0 0 24 24" {...S} strokeWidth={2.8}>
          <path d="M6 12.4l4 4 8-8.6" />
        </svg>
      )}
      {blocked && !on && (
        <svg viewBox="0 0 24 24" {...S} strokeWidth={2.4}>
          <path d="M7 12h10" />
        </svg>
      )}
    </span>
  )
}

function GripIcon() {
  return (
    <svg className="pickrow__grip" viewBox="0 0 24 24" fill="currentColor" stroke="none"
      aria-hidden="true">
      <circle cx="9.5" cy="7" r="1.35" />
      <circle cx="14.5" cy="7" r="1.35" />
      <circle cx="9.5" cy="12" r="1.35" />
      <circle cx="14.5" cy="12" r="1.35" />
      <circle cx="9.5" cy="17" r="1.35" />
      <circle cx="14.5" cy="17" r="1.35" />
    </svg>
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
  const [allDepartments, setAllDepartments] = useState(false)
  /** The question being dragged, while it is being dragged. */
  const [dragging, setDragging] = useState<string | null>(null)
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

  /**
   * Move a chosen question to where another one sits.
   *
   * The order is the order they are asked, and it is not cosmetic: the first question
   * gets the most considered answer and the last gets the most abandoned ones, so
   * whichever question matters most this month belongs at the top. It was previously
   * fixed as whatever order they happened to be ticked in, which nobody chose.
   */
  function moveQuestion(id: string, before: string) {
    if (id === before) return
    const order = selection.questionIds.filter((one) => one !== id)
    const at = order.indexOf(before)
    if (at < 0) return
    order.splice(at, 0, id)
    onChange({ ...selection, questionIds: order })
  }

  function toggleDepartment(name: string) {
    onChange({
      ...selection,
      departments: selection.departments.includes(name)
        ? selection.departments.filter((one) => one !== name)
        : [...selection.departments, name],
    })
  }

  const everyone = isEveryone(selection)
  const total = departments.reduce((sum, one) => sum + one.headcount, 0)
  const listed = allDepartments ? departments : departments.slice(0, DEPTS_SHOWN)
  const rest = departments.length - listed.length

  return (
    <section className="card selection">
      <header className="selection__head">
        <span className="selection__mark">
          <TargetIcon />
        </span>
        <div className="selection__id">
          <div className="selection__name">{selectionLabel(selection)}</div>
          <div className="selection__sub">
            {picked} of {MAX_SELECTED} questions · {reach} {reach === 1 ? 'person' : 'people'}
          </div>
        </div>
        {editable && (
          <button className="selection__remove" disabled={saving} onClick={onRemove}>
            Remove
          </button>
        )}
      </header>

      {problem && <div className="error">{problem}</div>}

      {/*
        Departments beside questions, not above them.

        Choosing who is asked and choosing what they are asked are one decision, and
        stacked they were a scroll apart — you picked the questions with the department
        list off-screen, which is how a selection ends up asking Consumer Sales about
        something that only makes sense to Academic Delivery.
      */}
      <div className="selection__grid">
        <div className="selection__col">
          <div className="selection__label selection__label--split">
            <span>Departments</span>
            <span className="selection__hint">
              {everyone
                ? 'Everyone'
                : `${selection.departments.length} of ${departments.length} picked`}
            </span>
          </div>

          {/*
            Every row carries a tick box.

            Without one the list read as a table of headcounts — nothing said the rows
            could be clicked, and an unchosen department looked exactly like a caption.
            The box is the whole affordance: it says these are choices, and it says which
            way each one currently sits without having to compare shades of blue.
          */}
          <div className="deptlist">
            <div
              {...clickable(() => editable && onChange({ ...selection, departments: [] }))}
              className={`deptrow deptrow--every ${everyone ? 'deptrow--on' : ''}`}
            >
              <Tick on={everyone} />
              <span className="deptrow__name">Every department</span>
              <span className="deptrow__count">{total}</span>
            </div>

            {/*
              "Everyone" is an absence of departments, not a department, so ticking a
              named one silently drops you out of it. Said out loud, because a selection
              that quietly stopped covering the whole company is not something anybody
              would notice until the response rate came in.
            */}
            {everyone && (
              <p className="deptnote">
                Everyone is included. Tick a department to ask only those instead.
              </p>
            )}

            {listed.map((department) => {
              const on = selection.departments.includes(department.name)
              // Named in another selection: showing it as available offers a choice that
              // is then refused, which is worse than showing it as spoken for.
              const elsewhere = others.some((one) =>
                one.departments.includes(department.name),
              )
              return (
                <div
                  key={department.name}
                  {...clickable(() => editable && !elsewhere && toggleDepartment(department.name))}
                  className={`deptrow ${on ? 'deptrow--on' : ''} ${elsewhere ? 'deptrow--taken' : ''}`}
                  aria-disabled={elsewhere}
                >
                  <Tick on={on} blocked={elsewhere} />
                  <span className="deptrow__name">{department.name}</span>
                  <span className="deptrow__count">
                    {elsewhere ? 'in another selection' : department.headcount}
                  </span>
                </div>
              )
            })}
          </div>

          {(rest > 0 || allDepartments) && (
            <button className="showmore" onClick={() => setAllDepartments((on) => !on)}>
              {allDepartments ? 'Show fewer' : `Show ${rest} more`}
              <ChevronDown />
            </button>
          )}
        </div>

        <div className="selection__col">
          <div className="selection__label selection__label--split">
            <span>
              Questions — {picked} of {MAX_SELECTED}
              {full && <span className="selection__cap"> · at the cap</span>}
            </span>
            {picked > 1 && <span className="selection__hint">Drag to reorder</span>}
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
            <div className="qpicks">
              {shown.map((question) => {
                const on = selection.questionIds.includes(question.id)
                const order = selection.questionIds.indexOf(question.id) + 1
                return (
                  <div
                    key={question.id}
                    className={`pickrow ${on ? 'pickrow--on' : ''} ${
                      !on && full ? 'pickrow--capped' : ''
                    } ${dragging === question.id ? 'pickrow--lifting' : ''}`}
                    // Draggable only once chosen. There is no position to drag an
                    // unchosen question to — it is not in the order yet.
                    draggable={editable && on && picked > 1}
                    onDragStart={() => setDragging(question.id)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (on && dragging) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragging) moveQuestion(dragging, question.id)
                      setDragging(null)
                    }}
                  >
                    <button
                      className="pickrow__box"
                      onClick={() => editable && toggleQuestion(question.id)}
                      aria-pressed={on}
                      aria-label={on ? `Remove: ${question.question}` : `Add: ${question.question}`}
                    >
                      {on ? String(order).padStart(2, '0') : ''}
                    </button>
                    <span className="pickrow__text">{question.question}</span>
                    {on && picked > 1 && <GripIcon />}
                    <span className="pickrow__tail">
                      {on ? `#${order}` : question.tags[0] ?? ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {picked > 0 && (
            <>
              <div className="selection__label" style={{ marginTop: 16 }}>
                In this order
              </div>
              <ol className="orderlist">
                {questionsIn(bank, selection).map((question) => (
                  <li key={question.id}>{question.question}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
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
      {/*
        Not a styling flourish — a warning about real data loss.

        The list endpoint returns only published questions, so anything saved as a draft
        or retired is stored correctly and then cannot be found again from here. Better
        to say that at the moment of choosing than to let the question quietly disappear
        and have HR write it a second time. Delete this the day §6d ships.
      */}
      {draft.state !== 'PUBLISHED' && (
        <div className="field-foot field-foot--warn">
          Heads up: the API only lists published questions, so this one will be saved but
          will not appear here until it is published.
        </div>
      )}

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
