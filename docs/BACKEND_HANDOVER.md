# HR Genie — backend handover

Everything the backend needs, in one document. Written 26 August 2026, **re-checked
29 August** against `hrgenie-api.devinfinitylearn.in` — every claim was made by calling
the API, not by reading our own code. Where something is our bug rather than yours, it
says so.

**Most of this is now done.** Scoping, the regions route and one of the two permissions
landed between the two checks. What is left is section 4a, and one thing that fell out
of the fix — section 3b.

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
| Directory (`/api/employees`) | **Fixed 29 Aug.** Scoped by `hrbpId` — 457 people, every one correctly tagged. |
| Ticket queue for HRBPs | **Fixed 29 Aug.** 36 tickets, none raised from outside that set. |
| Holiday regions route | **Fixed 29 Aug.** Returns `["All India","Telangana"]`. |
| `celebrations.view` | **Fixed 29 Aug.** Now in the `HR` permission list. |
| **Auto-assign on ticket creation** | **Not seen yet.** Every ticket is `assigneeId: null`. Section 4a. |
| **Employees with no HRBP tagged** | **New gap** created by the fix. Section 3b. |
| `tickets.assign` on `HR_ADMIN` | Unverified — needs an Admin token. Section 5. |

---

## 3. Scoping — fixed, and one thing that fell out of it

### 3a. What it does now

An HRBP used to get `[]` from both the directory and the ticket queue, because scope was
read from `departments` and every HRBP account has an empty one. Re-checked 29 August
with the same bearer — `HYD606840` (Deepak Patil, `role: "HR"`, `departments: []` still):

| Call | Before | Now |
|---|---|---|
| `GET /api/employees` | `[]` | **457 employees** |
| `GET /api/tickets` | `[]` | **36 tickets** |
| `GET /api/holidays/regions` | `400` — shadowed | `["All India","Telangana"]` |

And it is scoped rather than opened up, which is the part worth confirming: **all 457
returned employees carry `hrbpId: "HYD606840"`**, spanning nine departments, and **none
of the 36 tickets was raised by anybody outside that set**. That is the tag doing the
work — exactly what was asked for. Thank you.

### 3b. The gap it leaves: an employee with nobody tagged

Scope now appears to be the tag alone rather than the union: every row came back tagged,
and `departments` is still `[]`.

That means **an employee with no `hrbpId` is invisible to every HRBP**. Their tickets
reach nobody's queue and they appear in nobody's directory. Unlike an unassigned ticket,
no screen anywhere shows this — it is an absence, not a state, so nobody would notice.

Two ways to close it, either is fine:

- Keep the union as originally specified — tag **∪** the departments the HRBP covers —
  and fill `departments` on the HRBP accounts, so an untagged employee is still covered
  by whoever holds their department.
- Or guarantee at the data level that every active employee has an `hrbpId`, and give us
  a way to see the ones that do not.

**What we would like to know either way: how many active employees currently have no
`hrbpId`?** If the answer is zero, this is theoretical. If it is not, those people are
silently unsupported right now.

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

**Status on 29 August: not seen yet.** `assigneeId` is now a real field on every ticket,
which is the half that was missing — but all 36 come back `null`, including `HRG-0036`,
raised by `EMP3801`, whose `hrbpId` is `HYD606840`.

That does not prove 4a is missing: all 36 predate the change, and the rule applies at
creation. **Raising one new ticket settles it.** If it comes back with
`assigneeId: "HYD606840"`, this is done.

**Please also backfill the existing ones.** Thirty-six tickets sitting at `null` stay in
the "needs an owner" pile forever unless an Admin routes each by hand. Same rule, same
`assignedBy: "SYSTEM"`.

### 4b. `PATCH /api/tickets/{id}/assignee` — the route now exists

It answered `404` on 26 August and answers `401` unauthenticated on 29 August, so it is
built. We have not exercised it against real data — that needs an Admin token, and we
would rather not reassign somebody's live ticket to find out.

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

`GET /api/employees/me` for the `HR` account on 29 August:

```json
["dashboard.view","tickets.view","tickets.resolve","people.view","attendance.view",
 "celebrations.view","trends.view","analytics.view","holidays.view","pulse.view"]
```

**`celebrations.view` — done 29 August.** It is in the `HR` list now, so the temporary
bridge the console was carrying comes out.

**`tickets.assign` on `HR_ADMIN` — unverified.** We have only checked an `HR` token,
which would not carry it either way. Needed before an Admin can use section 4b.

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

### 6a. `GET /api/holidays/regions` — fixed 29 August

It answered `400` because the literal route sat behind the parameterised one. It now
returns `["All India","Telangana"]`, so the console reads your list rather than falling
back to a copy of its own.

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

## 10. What is left

1. **Section 4a** — raise one new ticket and tell us whether it comes back assigned. If
   not, the rule; if so, a backfill for the existing 36.
2. **Section 3b** — how many active employees have no `hrbpId`, and which way you would
   rather close that gap.
3. **Section 5** — confirm `tickets.assign` is on `HR_ADMIN`.
4. **Section 6b** — cache headers on authenticated routes. Small, and still open.
5. **Section 6c** — pulse delivery reading selections.
6. **Section 7** — the three questions, whenever suits.

Everything else on this list is done.

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
