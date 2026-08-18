# Pulse questions — what the backend needs to add

HR now authors the monthly pulse in the console: the wording, the answers, the tags,
and which departments are asked which questions. Everything on that page works except
saving it anywhere other than the HR user's own browser, because the API has one
route for questions and it is read-only:

```
GET /api/pulse/questions        # the whole bank, no departments, no way to change it
```

Four routes on the bank close half the gap; a second resource for selections closes the
rest. Read section 0 first - the model changed shape.

---

## 0. What changed, and why it matters to you

The console used to hold **one list**: a bank of at most ten questions, each carrying
the departments it was asked of. That has been split, because it conflated two
decisions that happen at different times:

| | |
|---|---|
| **The bank** | Every question anyone has written, tagged. A library. **Uncapped** |
| **A selection** | A set of departments paired with **up to ten** bank questions. What those departments are actually asked |

The ten-question limit moved from the bank to the selection. It is about how much you
can ask a person on a phone in one sitting — past about ten they stop reading and start
tapping the first option, which is worse than not asking, because the numbers still look
like data. It was never a statement about how many questions may *exist*, and while it
capped the bank, writing an eleventh question meant deleting one that was working.

**For the API this means `departments` comes off the question and a second resource
appears.** Everything below is written against that split.

---

## 0b. Tags

A question carries `tags`, which is how a selection finds it later.

```json
{ "tags": ["workload", "wellbeing"] }
```

Free text, unlike holiday regions — whoever writes a question should be able to name
what it covers without asking anyone. But **normalised**: lower-cased, trimmed, inner
spaces to dashes, punctuation dropped. Without that, `"Work Load"`, `"workload"` and
`"work load "` are three tags that filter to three different sets, and the list stops
being useful about a fortnight in.

Please normalise server-side too rather than trusting the client. At most six tags per
question, each at most 24 characters.

---

## 0b2. Draft, published, retired

A question carries a `state`:

```
DRAFT       being written. Cannot be asked.
PUBLISHED   fit to ask. The only state a selection may reference.
RETIRED     was asked once, no longer should be. Kept for the record.
```

**Only `PUBLISHED` may appear in a selection.** Reject a `questionIds` entry naming a
draft or retired question with `409` and a message naming which one — the console shows
it verbatim, and the two cases want different sentences, because the fix for each is
different.

**Retired rather than deleted, and this is the point of having the state at all.**
Answers are stored keyed by question id. Deleting a question that has been answered
leaves rows pointing at nothing, and next year's comparison against this year quietly
loses a column. Retiring keeps the record and takes it out of circulation, which is what
"we do not ask that any more" actually means.

**A new question is created as `DRAFT`.** A question is written, read back, and then let
out; making a half-typed one publishable the moment it saves is how a typo reaches
everybody.

**An absent `state` reads as `PUBLISHED`, not `DRAFT`.** Anything already stored is
being asked right now, and defaulting the other way would switch the pulse off for
everyone the first time the field is introduced.

**Moving a question out of `PUBLISHED` removes it from every selection.** The console
does this and reports how many it touched. Please do the same server-side rather than
leaving behind a selection that cannot be served, and return the affected selections so
the caller can say what happened.

---

## 0c. Selections

```jsonc
{
  "id": "sel-eng",
  "departments": ["Experience", "Growth"],   // empty array = every department
  "questionIds": ["experience", "workload"]  // order matters, see below
}
```

```http
GET    /api/pulse/selections
POST   /api/pulse/selections
PATCH  /api/pulse/selections/{id}
DELETE /api/pulse/selections/{id}
```

**Four rules, all of which the console enforces early and none of which it can
guarantee:**

1. **At most ten `questionIds`.** `422` beyond that.
2. **A department appears in at most one selection.** Two selections naming the same
   department means two different pulses and nothing to choose between them. Reject with
   `409` naming the department — the console shows the message verbatim.
3. **At most one selection with an empty `departments`.** Otherwise "everyone" has two
   answers.
4. **`questionIds` order is the order asked.** Store it as given. A pulse that opens
   with *have you thought about looking elsewhere* reads very differently from one that
   ends with it, so this is an authoring decision, not an implementation detail.

**What one department is asked:** its own selection if it has one, otherwise the
empty-`departments` selection. **Never both.** A department named in a selection has
been decided about, and quietly adding the general questions on top would push it past
ten without anybody choosing to.

A department in no selection, with no everyone-selection present, is asked **nothing**.
That is a real state and the console warns about it, because otherwise the first sign is
an empty column on the dashboard a month later.

---

## 0d. Who may change what

Same permissions as the holiday calendar — see `docs/ACCESS_CONTROL.md`.

| | HRBP | Admin | Main Head |
|---|:--:|:--:|:--:|
| `GET` questions and selections | yes | yes | yes |
| `POST`, `PATCH`, `DELETE` on either | | yes | yes |

HRBPs read the bank so they know what their people are being asked. Deciding the
wording, and who gets which questions, is `pulse.publish`. An HRBP calling a write gets
`403`.

---

## 1. The shape

A question gains two fields. Both are additive — the Android app, the Teams bot and
the console all tolerate the current shape today.

```jsonc
{
  "id": "workload",                        // stable forever; see below
  "question": "Is your workload manageable right now?",
  "hint": "Think about the last two weeks rather than today.",   // optional, may be ""
  "options": ["Comfortable", "Busy but okay", "Stretched", "Not sustainable"],
  "tags": ["workload", "wellbeing"],        // normalised; see 0b
  "state": "PUBLISHED",                     // DRAFT | PUBLISHED | RETIRED; see 0b2
  "order": 2                                // 1-based, position in the bank
}
```

**`id` must never change once a question exists.** Answers are stored keyed by it
(`answers: {"workload": "Stretched"}`), so rewriting an id orphans every answer ever
given. The console generates a readable slug on create and never sends a different one
on update — please enforce the same on your side and reject an `id` in a `PATCH` body
rather than honouring it.

A selection's `departments` matches the `department` field on `/api/employees` exactly,
as a string. No ids, because the directory does not expose any.

---

## 2. The routes

| Route | Body | Returns |
|---|---|---|
| `POST /api/pulse/questions` | everything except `order` (append to the end) | the created question |
| `PATCH /api/pulse/questions/{id}` | any of `question`, `hint`, `options`, `tags`, `state` | the updated question |
| `DELETE /api/pulse/questions/{id}` | — | `204` |
| `PUT /api/pulse/questions/order` | `{ "ids": ["experience", "workload", ...] }` | the reordered bank |

All four are **HR-only** — the same role check the console's other write, `PATCH
/api/tickets/{id}/status`, already uses. An employee must not be able to change what
they are asked.

### Validation, server-side

The console enforces all of this in the form, but a disabled button is not a
constraint:

- **At most 10 questions.** `POST` past ten answers `422`. A pulse is answered on a
  phone once a month; past about ten, people stop reading and tap the first option,
  which is worse than not asking because the numbers still look like data.
- 2 to 6 options, none blank, no two the same within a question.
- `question` non-empty, 120 characters or fewer.
- Unknown department names rejected — a typo silently means "asked of nobody".

---

## 3. The read, and the one behaviour change worth care

`GET /api/pulse/questions` currently returns everything. Once questions carry
departments it has to answer differently depending on who is asking:

- **An employee** gets only the questions that apply to them: `departments` empty, or
  containing their own department. That filter belongs on the server. Neither the app
  nor the bot should receive questions it must then hide — a question sitting in a
  response is a question that leaked.
- **HR** gets the whole bank, unfiltered, so the console can show it.

Add `order` to the response and sort by it. The console shows the bank in the order
employees will see it, and that promise has to be true.

`POST /api/pulse` (submitting answers) needs no change, but should ignore an answer to
a question the submitter is not asked rather than storing it.

---

## 4. Two things that will bite

**A department with no questions gets an empty pulse.** If every question is scoped
and one department is in none of them, those people are invited to a form with nothing
in it. The console flags this — it counts questions per department and turns that tile
amber — but the invitation itself is sent by your side. Worth skipping the reminder for
anyone whose bank comes back empty.

**Editing a question mid-cycle changes what its existing answers mean.** People who
answered "Stretched" answered the old wording. The console warns HR when a question
already has answers this cycle and suggests adding a new question instead. If you want
to make that impossible rather than discouraged, reject `PATCH` of `question` or
`options` once an answer exists for the current cycle and let the console surface the
`409` — say so and the warning becomes a hard stop.

---

## 5. Until then

The console keeps the authored bank in the HR user's browser (`localStorage`) and says
so on the page, in a banner, with this file named in it. It still reads the live
`GET /api/pulse/questions` as the starting point, so what HR edits is what employees
are actually being asked — and "Discard local edits" goes back to exactly that.

When the routes land, the change in the console is confined to
`web/src/api/pulseQuestions.ts`: `fetchQuestionBank` and `saveQuestionBank` call the
API instead of `localStorage`, and the banner comes out. No page or component changes.
