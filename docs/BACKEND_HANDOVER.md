# HR Genie — backend handover

Everything the backend needs, in one document. Written 26 August 2026, **re-checked
1 September** against `hrgenie-api.devinfinitylearn.in` — every claim was made by calling
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
| **Auto-assign on ticket creation** | **Still not implemented.** Three tickets raised within the hour on 1 Sep, none assigned. Section 4a. |
| **177 employees have no HRBP tagged** | **Unchanged.** Same 177 on 1 Sep as on 29 Aug. Section 3b. |
| `tickets.assign` on `HR_ADMIN` | **Confirmed 29 Aug.** All 16 Admin permissions present. |
| `PATCH .../assignee` | **Confirmed 29 Aug.** Route reached, guard passes for an Admin. |
| `PATCH .../status` for an Admin | **Fixed 1 Sep.** Reaches the handler now. |
| **`tickets.assign` for an HRBP** | **Wanted.** One string on the `HR` list. Section 4e. |
| **No way to list HR accounts** | `/api/employees/hr` is 404, so an HRBP's picker is empty but for themselves. Section 4f. |
| **Email on ticket creation** | **New request.** To the HRBP and the raiser, from `POST /api/tickets`. Section 4g. |

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

### Measured 29 August, with an Admin bearer

`GET /api/employees` as `HR_ADMIN` returns the whole organisation, so this is countable:

| | |
|---|---|
| Employees in the directory | **2,247** |
| Distinct HRBPs tagged | **7** |
| **Employees with no `hrbpId`** | **177** |

So it is not theoretical. **177 people are currently supported by nobody** as far as this
system is concerned: they appear in no HRBP's directory, and the moment one of them
raises a ticket it lands in nobody's queue.

None of the 177 has raised a ticket yet, which is the only reason this has not been
noticed. That is luck rather than design.

The largest HRBP covers 529 people and the smallest 143, so the tagging is real and
mostly complete — this looks like a gap in the data rather than a missing feature. Worth
a query on your side either way.

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

### Tested again 1 September: still not implemented

On 29 August every ticket came back `assigneeId: null`, but all of them predated the
change, so it proved nothing — the rule applies at creation. We said one new ticket would
settle it.

**Three tickets were raised within an hour on 1 September — `HRG-0043` at 17:10,
`HRG-0044` at 17:11, `HRG-0045` at 17:15 — and all three came back with no assignee.**
`HRG-0040` on 31 August was the same.

Every one was raised by `EMP3801`, whose `hrbpId` is `HYD606840`, an active `HR`
account. Three tickets minutes old is not a backfill question or a timing question: the
rule is not running at creation.

The only assigned tickets in the system are `HRG-0028`, `HRG-0038` and `HRG-0041` —
three out of forty-five, each assigned by hand from the console.

`EMP3801`'s `hrbpId` is `HYD606840` (Deepak Patil), an active `HR` account. There is
nothing ambiguous left in the inputs: the tag is on the employee record, the field is on
the ticket, and creation did not connect them.

It appears in Deepak's queue — correctly, because the raiser is tagged to him — as
"Needs an owner". So the scoping from section 3 is doing its job and this is the one
remaining piece.

**Please also backfill.** All 38 now sit at `null` and stay in the "needs an owner" pile
forever unless somebody routes each by hand. Same rule, same `assignedBy: "SYSTEM"`.

### 4b. `PATCH /api/tickets/{id}/assignee` — the route now exists

**Confirmed working 29 August.** Called as `HR_ADMIN` against a deliberately invalid
reference so that nothing could be mutated:

```http
PATCH /api/tickets/HRG-DOES-NOT-EXIST/assignee
{ "assigneeId": "HYD606840" }

→ 404 {"message":"Ticket 'HRG-DOES-NOT-EXIST' not found."}
```

That is the handler replying, not a missing route, and the Admin's `tickets.assign`
passed the guard on the way in. We have not written a real assignment — that would move
somebody's live ticket into an HRBP's queue and out of everyone else's, which is not ours
to do uninvited.

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

### 4d. An Admin cannot change a ticket's status — the API contradicts itself

Confirmed from the console on 31 August, signed in as `HYD604982` (`role: "HR_ADMIN"`):

```
PATCH /api/tickets/{id}/status
→ "Only HR can change ticket status."
```

The same account's own permission list says otherwise. `GET /api/employees/me` for
`HYD604982` returns `tickets.resolve` among its sixteen permissions — so the API tells
the console this account may resolve tickets, and then refuses when it does.

One of the two is wrong, and we think it is the guard:

**An Admin has to be able to close a ticket whose owner has left or is on leave.** That
is most of what an escalation ends in. An Admin who can assign a ticket to somebody but
cannot finish one himself can only ever hand work sideways.

**The guard reads a role where the rest of the API now reads permissions.** The message
names `HR` specifically, which is the same shape as the holidays 403 from before roles
landed. `tickets.resolve` is the permission that should gate this, and all three console
roles carry it.

**Please accept `HR_ADMIN` and `HR_HEAD` on the status route** — or, if the guard is
right and Admins genuinely should not resolve, take `tickets.resolve` out of the Admin
permission list so the console stops offering a button that cannot work. Either is
consistent. The two together are not.

The console does not hide this: it shows the server's own message under the note field.
That is deliberate — a refusal an employee's HR never sees is worse than an awkward one.

---

### 4e. HRBPs need `tickets.assign` too

A product decision on our side, and it needs one string from you.

An HRBP should be able to hand a ticket to a colleague — cover, escalation, or simply
the wrong person picking it up. Today `tickets.assign` is `HR_ADMIN` and above, so an
HRBP pressing "Needs an owner" gets a picker and then a refusal from
`PATCH /api/tickets/{id}/assignee`.

**Please add `tickets.assign` to the `HR` permission list.** The console reads what you
send, so nothing ships on our side when you do.

This reverses what `docs/ACCESS_CONTROL.md` says — that deciding who deals with a ticket
is a workload call across the HR team, and therefore Admin's. That reasoning holds for a
large team and did not survive contact with this one, where the HRBPs are the people
actually moving work between themselves.

Note this is the mirror image of section 4d: there an Admin is refused something their
permission list grants; here an HRBP is correctly refused something we now want granted.
The guard is right in both cases — the lists are what need changing.

---

### 4f. There is no way to list HR accounts

`GET /api/employees/hr` is a 404, so the console builds its list of HR accounts by
taking `/api/employees` and filtering on `role`.

That works for an Admin, whose directory is the whole organisation. It does not work for
an HRBP, whose directory is the people *they look after* — and an HRBP is not one of
their own people, so the list comes back with none of their colleagues in it and, until
we patched around it, without them either.

**An endpoint returning the console accounts would fix it:**

```jsonc
GET /api/employees/hr
[ { "employeeId": "HYD606840", "name": "Deepak Patil", "role": "HR",
    "designation": "Manager", "officialEmail": "…" } ]
```

Every account with `role` of `HR`, `HR_ADMIN` or `HR_HEAD`. It is not sensitive — it is
the list of people the console already names in its own picker — and it is the same list
whoever asks, so it needs no scoping.

Without it an HRBP can only ever assign a ticket to themselves, which is half a feature.

---

### 4g. Email when a ticket is raised

New, and independent of the rest of section 4 — it does not wait on auto-assignment.

When an employee raises a ticket, two people should hear by email: the HRBP who will
deal with it, and the employee who raised it.

**In `POST /api/tickets`, after the ticket is committed** — not in the bot. The Android
app raises tickets too, so a send that lives in the bot means every ticket from the app
silently gets none.

**Addressed from `hrbpId`, not `assigneeId`.** Every ticket has a null assignee today, so
keying off it would send nothing; and the tag is the better key anyway, being a standing
relationship rather than where the ticket happens to sit this week.

Sent with Microsoft Graph `sendMail` from a shared mailbox. IT grants `Mail.Send` as an
application permission, scoped to that one mailbox with an application access policy.

**A failed send must never fail the ticket.** Losing somebody's ticket because a
notification threw inverts the importance of the two things entirely.

Full spec, both templates, the IT ask and the privacy call on whether the ticket's own
text belongs in an email: `docs/TICKET_EMAIL_BACKEND.md`.

---

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

## 5. Permissions — done

The console prefers the `permissions` array you send over its own defaults — that is the
point of sending it — so anything absent is switched off.

`GET /api/employees/me` for the `HR` account on 29 August:

```json
["dashboard.view","tickets.view","tickets.resolve","people.view","attendance.view",
 "celebrations.view","trends.view","analytics.view","holidays.view","pulse.view"]
```

**`celebrations.view` — done 29 August.** It is in the `HR` list now, so the temporary
bridge the console was carrying comes out.

**`tickets.assign` on `HR_ADMIN` — done 29 August.** The Admin token carries all sixteen
permissions, exactly the list below. Section 5 is closed.

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

### 6b. Cache headers — fixed 1 September

`GET /api/employees` now answers `Cache-Control: no-store`. It used to send an `ETag`
and nothing else, so the browser served stored bodies and the page rendered a cached
answer rather than the current one. Nothing further needed here.

The rest of this section is kept for the record.

`GET /api/employees` answered with an `ETag` and **no `Cache-Control` at all**. In the
browser these came back `304`, so the page rendered a stored body rather than the
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

1. **Section 4a** — auto-assignment on creation. Now tested and confirmed missing, and
   it is the feature everything else in section 4 exists to support. Plus a backfill for
   the 38 already sitting unowned.
2. **Sections 4d, 4e and 4f** — the rest of assignment, in three small pieces. Two
   permission lists to correct in opposite directions (an Admin cannot resolve a ticket
   their list grants; an HRBP cannot assign one and now should), and one endpoint that
   lists HR accounts, without which an HRBP can only assign to themselves.
3. **Section 3b** — the 177 employees with no `hrbpId`. Tag them, or cover them by
   department, but they are unsupported until one or the other.
4. **Section 6b** — cache headers on authenticated routes. Small, and still open.
5. **Section 6c** — pulse delivery reading selections.
6. **Section 7** — the three questions, whenever suits.

Sections 3a, 4b, 5 and 6a are done.

---

## Appendix: deeper specs

Referenced above, kept separate because they are longer than most people need:

| Document | Covers |
|---|---|
| `docs/ACCESS_CONTROL.md` | Roles, permission bundles, grants, escalation rules, audit |
| `docs/TICKET_ASSIGNMENT_BACKEND.md` | Assignment in full, including the visibility rule |
| `docs/TICKET_EMAIL_BACKEND.md` | Email on ticket creation: templates, Graph, the IT ask |
| `docs/CELEBRATIONS_BACKEND.md` | The celebrations response |
| `docs/HOLIDAYS_BACKEND.md` | Holiday CRUD, regions, immutability of past years |
| `docs/PULSE_QUESTIONS_BACKEND.md` | Question bank, states, selections |
| `docs/NOTIFY_BACKEND.md`, `docs/PUSH_BACKEND.md` | Outbound notification hooks |
| `docs/TEAMS_SSO_BACKEND.md` | The Teams token exchange |
