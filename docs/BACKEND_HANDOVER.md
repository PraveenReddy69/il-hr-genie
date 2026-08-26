# HR Genie — backend handover

Everything the backend needs, in one document. Written 26 August 2026 and checked
against `hrgenie-api.devinfinitylearn.in` the same day — every claim below was made by
calling the API, not by reading our own code. Where something is our bug rather than
yours, it says so.

---

## 1. What the system is

One API, three clients:

| Client | Who uses it | Where |
|---|---|---|
| **Teams bot** — HR Genie | Every employee, in Microsoft Teams | Bitbucket `hrgenie-bot-service` |
| **Android app** | Every employee | separate repo |
| **HRBP console** | The HR team only | `praveenreddy69.github.io/il-hr-genie` |

The console is the newest and is what most of this document is about. It is a read-heavy
admin surface: the ticket queue, the directory, holidays, pulse questions, celebrations.

Roles, in rank order: `EMPLOYEE` → `HR` (HRBP) → `HR_ADMIN` (Admin) → `HR_HEAD`.

---

## 2. Status at a glance

| Area | State |
|---|---|
| Auth, roles, permissions | **Working.** Both auth responses carry `role` and a resolved `permissions` array. |
| Holidays | **Working.** Seeded, editable from the console, and the bot reads it live. |
| Celebrations | **Working.** `department` and `officialEmail` are both projected. |
| Pulse questions and selections | **Working** in the console. Not yet read by the bot or app. |
| **Directory (`/api/employees`)** | **Broken for HRBPs — returns `[]`.** Section 3. |
| **Ticket queue for HRBPs** | **Broken — returns `[]`.** Same cause. Section 3. |
| **Ticket assignment** | **Missing.** No auto-assign, and the route is 404. Section 4. |
| Two permission strings | **Missing.** Section 5. |

---

## 3. Blocking: an HRBP can see nobody

### The measurement

Three calls, one bearer — `HYD606840` (Deepak Patil, `role: "HR"`, `departments: []`) —
inside the same minute:

| Call | Answer |
|---|---|
| `GET /api/employees` | `200` · `[]` |
| `GET /api/tickets` | `200` · `[]` |
| `GET /api/employees/celebrations` | `200` · the whole organisation |

He can read every colleague's birthday, date of joining and work email, and cannot see
one employee record or one ticket.

`GET /api/employees/me` confirms the inputs:

```jsonc
{ "employeeId": "HYD606840", "role": "HR", "departments": [],
  "hrbpId": "HYD604982", "l1ManagerId": "HYD608460" }
```

### The cause

Scope is applied from `departments`, and every HRBP account has an empty one.

An empty `departments` meaning "nobody" is **correct and should stay** — an unassigned
HRBP showing the whole organisation is the leak scoping exists to prevent. The rule is
right. The missing half is the tag.

### The fix

An HRBP covers two sets of people, not one:

```
employees whose hrbpId is this HR account     ← the tag. Someone decided this.
        ∪
employees in the departments they cover       ← the inference already made.
```

Only the second is applied anywhere today. The first has data right now: `EMP3801`
names `HYD606840`, so Deepak already has people and the directory says he has none.

Apply the union to `GET /api/employees`, `GET /api/tickets`, and every scoped read in
section 8. That one change repairs People, Attendance and the ticket queue together.

Filling `departments` on each HRBP account is still worth doing — it covers someone in
the department who has no HRBP tagged yet — but the tag is the half already derivable
from data you hold.

### The sharpest version of this bug

An Admin's console shows **22 open tickets**, one of them raised by `EMP3801`, whose
`hrbpId` is Deepak. **Deepak cannot see the ticket raised by his own employee.**

---

## 4. Blocking: ticket assignment

### 4a. Assign on creation

`POST /api/tickets` should route the ticket itself:

```
raiser's hrbpId resolves to an active HR account  →  assigneeId = that id
no tag, or it does not resolve                    →  assigneeId = null
```

Unresolvable means unassigned, never a guess. A ticket sitting in a departed HRBP's
queue is invisible in a way an unassigned one is not — the console already counts and
prompts on unassigned.

Record it as the system's doing, so it does not read back as a person's decision:

```jsonc
{ "ticketId": "HRG-0036", "assigneeId": "HYD606840",
  "assignedBy": "SYSTEM", "reason": "HRBP_TAG" }
```

Nothing re-runs the rule after creation. An Admin who moves a ticket meant to, and a
rule that quietly puts it back is worse than no rule.

### 4b. `PATCH /api/tickets/{id}/assignee` — currently 404

```http
PATCH /api/tickets/{id}/assignee
{ "assigneeId": "HYD606840" }     // or null to hand it back
→ 200  the updated ticket
```

- Separate from the status route on purpose. Assigning and resolving are different
  decisions, and folding them together means neither can happen without the other.
- **Do not touch `updatedAtMillis`.** Handing a ticket over is not progress on it;
  letting it reset the clock makes an ageing queue look fresh every time somebody
  shuffles it.
- `tickets.assign` is Admin and above. An HRBP calling this gets `403`. Assigning to a
  non-HR account is `422`.

**Ship 4a and 4b together.** Auto-assignment without a way to correct it is worse than
neither, because the one ticket the rule gets wrong is then stuck with nobody able to
move it.

### 4c. The visibility rule

This is the part a client cannot enforce, and the part that makes assignment a handover
rather than a label.

For an **HRBP**:

| Ticket | Visible? |
|---|---|
| assigned to them | yes, whatever the department |
| assigned to someone else | **no** |
| unassigned | yes, if the raiser is in their scope (section 3) |

**Admin and above see everything** — somebody has to be able to find a ticket whose
assignee is on leave, and that is most of what an escalation is.

Stated in one line: **assignment narrows, it never widens.**

---

## 5. Two permission strings are missing

The console prefers the `permissions` array you send over its own defaults — that is the
point of sending it — so anything absent is switched off.

`GET /api/employees/me` for the `HR` account returns:

```json
["dashboard.view","tickets.view","tickets.resolve","people.view",
 "attendance.view","trends.view","analytics.view","holidays.view","pulse.view"]
```

**`celebrations.view` is absent from both roles.** That removes the Celebrations page
from the sidebar for everyone. It was specified after your permission set was built, so
it is a spec gap rather than a decision. The console currently grants it alongside
`people.view` as a temporary bridge, deleted the day it appears in the list.

**`tickets.assign` is absent from `HR_ADMIN`.** Needed for section 4.

Expected for `HR_ADMIN`:

```json
["dashboard.view","tickets.view","tickets.resolve","tickets.assign",
 "people.view","attendance.view","celebrations.view","trends.view",
 "analytics.view","holidays.view","holidays.edit","pulse.view",
 "pulse.publish","sales.view","access.manage","audit.view"]
```

For `HR`, the same without `tickets.assign`, `holidays.edit`, `pulse.publish`,
`sales.view`, `access.manage` and `audit.view`. `HR_HEAD` is `HR_ADMIN` plus
`roles.assign`.

---

## 6. Smaller, all confirmed by calling the API

### 6a. `GET /api/holidays/regions` is shadowed by `GET /api/holidays/{id}`

```
GET /api/holidays/regions
→ 400 {"message":"'regions' is not a valid id."}
```

The literal route needs declaring before the parameterised one. The console falls back
to its own built-in region list, so nothing is visibly broken — but that means the
region list is a copy shipping in the front end rather than the one you own, and a
region added server-side will never appear.

### 6b. No cache headers on authenticated endpoints

`GET /api/employees` answers with an `ETag` and **no `Cache-Control` at all**. In the
browser these were coming back `304`, so the page rendered a stored body rather than the
current answer.

Two consequences:

- **A shared cache would serve one employee's scoped view to another.** These responses
  differ per bearer; caches key on URL. Any proxy in front of the API would do the same.
- **It will hide the section 3 fix.** If the ETag is computed over the employee
  collection rather than the scoped response, changing the scoping will not change the
  ETag — a correct fix lands and the page stays empty.

Please send `Cache-Control: no-store` on authenticated routes, or at minimum
`private, no-cache` plus `Vary: Authorization`. The console now sends
`cache: 'no-store'`, which handles the browser but not a shared cache.

### 6c. Nothing reads pulse selections

`/api/pulse/selections` has real data — one selection, four question ids. The bot and
the app still read `/api/pulse/questions` and ask everyone the whole bank. Until
delivery reads selections, the console will report that departments are not being asked
anything while employees are in fact being asked, which will look like a console bug.

### 6d. One of ours, listed so nobody chases it

`GET /api/tickets/categories` answers `{"categories":[...]}`. The **bot** reads a bare
array or `{items:[...]}`, so it silently falls back to a hard-coded list and has never
shown your categories. Our fix, not yours — noted here only so it is not debugged from
your side.

---

## 7. Three questions, not requests

**Is celebrations meant to be organisation-wide?** It returns the whole organisation to
an account the other two endpoints give nothing. Both cannot be the intended rule. Our
reading is that celebrations is fine as it is — a birthday list is meant to be broad —
and `employees` and `tickets` are the two that are wrong. Worth confirming rather than
assuming: if celebrations is the one that is too wide, that is a live data-exposure
question rather than a missing feature.

**Should `dateOfBirth` be on the employee record?** It arrives there now. A birth date
gives an age; a birthday list needs a month and a day. The directory is work-facing and
every HR account can read it. We would rather it were dropped from the directory and
month-and-day projected onto `/api/employees/celebrations`, which already carries what
the feature needs.

**Keep `"Attendance"` in the ticket categories?** It is already in the list you serve.
The product decision on our side was to park it for this phase. Harmless either way —
say which you would prefer and we will match it.

---

## 8. Reference: what scope applies to

Every read that names or aggregates people:

| Endpoint | Scoped by |
|---|---|
| `GET /api/employees` | the employee's department **∪ `hrbpId`** |
| `GET /api/employees/{id}/summary` | that employee's department |
| `GET /api/tickets` | the raiser's department, then assignment (4c) |
| `PATCH /api/tickets/{id}/status` | the raiser's department |
| `GET /api/attendance/*` | the employee's department |
| `GET /api/mood/*`, `GET /api/pulse/*` | the employee's department |
| `GET /api/stats` | aggregates over in-scope departments only |

Scope is a **property of the account**, not a request parameter. A client asking for a
department outside its scope should get `403`, never a filtered-but-successful response
— silent filtering makes a scope bug look like a quiet week.

`HR_ADMIN` and `HR_HEAD` are organisation-wide. For them an empty `departments` means
everything; for `HR` it means nothing.

**Mood and pulse stay withheld below 5 responses** so no individual can be identified
from a number. Scoping narrows the pool that floor is measured against, so an HRBP
covering two teams of four will see no sentiment data at all. That is the privacy rule
working, not a bug — but worth knowing before somebody asks why their dashboard is
empty.

---

## 9. How this was verified

Authenticated calls with a live `HR` bearer on 26 August 2026, plus unauthenticated
probes reading `404` as "no such route" and `401` as "exists, needs auth" — the guard
runs after routing, so the two are reliably different.

| Route | |
|---|---|
| `/api/holidays`, `/api/employees`, `/api/employees/me` | exists |
| `/api/employees/celebrations`, `/api/tickets`, `/api/tickets/categories` | exists |
| `/api/pulse/questions`, `/api/pulse/selections` | exists |
| `/api/holidays/regions` | **400** — shadowed by `/api/holidays/{id}` |
| `PATCH /api/tickets/{id}/assignee` | **404** |
| `/api/access/users`, `/api/access/roles`, `/api/audit` | **404** — not needed yet |
| `/api/auth/me` | **404** — we use `/api/employees/me` |

---

## 10. Suggested order

1. **Section 3** — the scoping union. Unblocks the most, and is one change.
2. **Section 4** — assignment, both halves together.
3. **Section 5** — two strings.
4. **Sections 6a and 6b** — small, and 6b will otherwise mask item 1.
5. **Section 6c** — pulse delivery.

Sections 3 and 4 are the whole of the primary feature. Everything else can wait a week
without anyone noticing.

---

## Appendix: deeper specs

Referenced above, kept separate because they are longer than most people need:

| Document | Covers |
|---|---|
| `docs/ACCESS_CONTROL.md` | Roles, permission bundles, grants, escalation rules, audit |
| `docs/TICKET_ASSIGNMENT_BACKEND.md` | Assignment in full, including the visibility rule |
| `docs/CELEBRATIONS_BACKEND.md` | The celebrations response |
| `docs/HOLIDAYS_BACKEND.md` | Holiday CRUD, regions, immutability of past years |
| `docs/PULSE_QUESTIONS_BACKEND.md` | Question bank, states, selections |
| `docs/NOTIFY_BACKEND.md`, `docs/PUSH_BACKEND.md` | Outbound notification hooks |
| `docs/TEAMS_SSO_BACKEND.md` | The Teams token exchange |
