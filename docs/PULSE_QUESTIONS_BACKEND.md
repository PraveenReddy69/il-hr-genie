# Pulse questions — what the backend needs to add

HR now authors the monthly pulse in the console: the wording, the answers, the order,
and **which departments get asked each question**. Everything on that page works
except saving it anywhere other than the HR user's own browser, because the API has
one route for questions and it is read-only:

```
GET /api/pulse/questions        # the whole bank, no departments, no way to change it
```

Four routes close the gap. Nothing else in the console or either app changes.

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
  "departments": ["Sales", "Inside Sales"], // empty array = everyone
  "order": 2                                // 1-based, what employees see
}
```

**`id` must never change once a question exists.** Answers are stored keyed by it
(`answers: {"workload": "Stretched"}`), so rewriting an id orphans every answer ever
given. The console generates a readable slug on create and never sends a different one
on update — please enforce the same on your side and reject an `id` in a `PATCH` body
rather than honouring it.

`departments` matches the `department` field on `/api/employees` exactly, as a string.
No ids, because the directory does not expose any.

---

## 2. The routes

| Route | Body | Returns |
|---|---|---|
| `POST /api/pulse/questions` | everything except `order` (append to the end) | the created question |
| `PATCH /api/pulse/questions/{id}` | any of `question`, `hint`, `options`, `departments` | the updated question |
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
