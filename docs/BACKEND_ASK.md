# What the console needs next

Short list, in the order that unblocks the most. Everything here was checked against
`hrgenie-api.devinfinitylearn.in` on 21 August 2026 — the route survey at the bottom
says how.

---

## Done — thank you

**Roles and permissions now come from the API.** Both auth responses carry `role` and a
resolved `permissions` array, and the write guard accepts an Admin. The console has
deleted the id-to-role map it was carrying to work around this.

**The holiday calendar is seeded.** `GET /api/holidays?year=2026` returns the full year
including holidays added from the console, so the open question about whether it had any
rows is closed. The Teams bot reads it from there now instead of shipping its own copy.

**`hrbpId` and `l1ManagerId` are on the employee record.** That unblocks item 3.

---

## 1. Two permissions are missing from the list

The list is authoritative in the console — it is preferred over the console's own
defaults, which is the point of sending it. So anything absent is switched off.

**`celebrations.view`** — absent from both roles, which removes the Celebrations page
from the sidebar entirely. It was specified after your permission set was built, so this
is a spec gap rather than a decision. The console currently grants it alongside
`people.view` as a bridge; that bridge is deleted the day it appears in the list.

**`tickets.assign`** — absent from `HR_ADMIN`. Only Admin and above should have it.
Not urgent, because the endpoint it guards is still 404 (item 3), but the two want to
land together.

Expected for `HR_ADMIN`:

```jsonc
[ "dashboard.view", "tickets.view", "tickets.resolve", "tickets.assign",
  "people.view", "attendance.view", "celebrations.view", "trends.view",
  "analytics.view", "holidays.view", "holidays.edit", "pulse.view",
  "pulse.publish", "sales.view", "access.manage", "audit.view" ]
```

For `HR`, the same list without `tickets.assign`, `holidays.edit`, `pulse.publish`,
`sales.view`, `access.manage` and `audit.view` — those six are the Admin tier.

---

## 2. An HRBP sees nobody — measured, not inferred

Three calls with the same bearer, `HYD606840` (Deepak Patil, role `HR`,
`departments: []`), within the same minute on 26 August 2026:

| Call | Answer |
|---|---|
| `GET /api/employees` | `200` · `[]` |
| `GET /api/tickets` | `200` · `[]` |
| `GET /api/employees/celebrations` | `200` · the whole organisation |

An HRBP can read every colleague's birthday and date of joining, and cannot see a single
employee record or a single ticket. Whatever scoping is meant to be, it is not being
applied the same way twice.

`GET /api/employees/me` for the same account confirms the inputs:

```jsonc
{ "employeeId": "HYD606840", "role": "HR", "departments": [],
  "hrbpId": "HYD604982", "l1ManagerId": "HYD608460" }
```

### Why both empties are wrong

`departments: []` on an HR account means access to nobody, deliberately — an unassigned
HRBP showing the whole organisation is the leak scoping exists to prevent. The rule is
right. The half that is missing is the tag.

**An HRBP covers two sets of people:**

```
employees whose hrbpId is this HR account     ← the tag. Someone decided this.
        ∪
employees in the departments they cover       ← the inference already made.
```

Only the second is applied, and it is empty for every HRBP. The first has data today:
`EMP3801` names `HYD606840`, so Deepak already has people and the directory says he has
none. Applying the union fixes People, Attendance and the ticket scope together.

The ticket queue is the sharper case. An Admin's console shows 22 open tickets,
including one raised by `EMP3801` — whose HRBP is Deepak. He cannot see the ticket
raised by his own employee.

### And celebrations is scoped the other way

It returns the whole organisation to an account the other two endpoints give nothing.
Both cannot be the intended rule. Our reading is that celebrations is fine as it is —
a birthday list is meant to be broad — and that `employees` and `tickets` are the two
that are wrong. Worth confirming rather than assuming, because if celebrations is the
one that is too wide, that is a live data-exposure question rather than a missing
feature.

### Cache headers on authenticated endpoints

`/api/employees` and `/api/employees/me` come back **304 Not Modified** in the browser,
which means the page is rendering a stored body rather than the current answer.

That is worth fixing regardless of the scoping above, for two reasons:

**A shared cache would serve one employee's scoped view to another.** These responses
differ per bearer — the directory an HRBP may read is not the one an Admin may read —
and the browser caches by URL alone. Any proxy in front of the API would do the same.
`Cache-Control: no-store` on authenticated routes, or at minimum
`Cache-Control: private, no-cache` plus `Vary: Authorization`.

**It will hide the fix.** If the ETag is computed over the underlying collection rather
than the scoped response, changing how scoping works will not change the ETag — so a
correct fix would land and Deepak's browser would go on showing an empty directory. If
that happens, it is this, not the fix.

The console now sends `cache: 'no-store'` on every API call, which handles the browser.
It does nothing about a shared cache, which is the half only the response headers can
fix.

### What the console does meanwhile

The People page now offers a **"Tagged to me"** filter, counted from `hrbpId` on the
rows it was sent. It appears only when there is somebody to show, so today nobody has
it. Its empty state also stopped telling an HRBP to clear a filter they had not set.

---

## 3. Ticket assignment — the last piece of the primary feature

Two halves, and the first one is the one that matters.

### Assign to the raiser's HRBP on creation

`hrbpId` is on the employee record now, so `POST /api/tickets` can route the ticket
itself:

```
raiser's hrbpId resolves to an active HR account  →  assigneeId = that id
no tag, or it does not resolve                    →  assigneeId = null
```

Unresolvable means unassigned, never a guess — a ticket in a departed HRBP's queue is
invisible in a way an unassigned one is not, and the console already counts and prompts
on unassigned.

Record it as the system's doing, not a person's: `assignedBy: "SYSTEM"`,
`reason: "HRBP_TAG"`. An Admin overruling it later is a different event and has to read
back as one.

Nothing re-runs the rule after creation. An Admin who moves a ticket meant to.

### `PATCH /api/tickets/{id}/assignee` — still 404

Checked again today. Until it exists an Admin cannot reassign at all: the console has
the picker, the HR list and the permission check, and the call fails. Auto-assignment
without this is worse than neither, because the one ticket the rule gets wrong is then
stuck.

Both are specified in `docs/TICKET_ASSIGNMENT_BACKEND.md`, including the visibility
rule, which is the part that makes assignment a handover rather than a label:

> An assigned ticket goes to its assignee and leaves everyone else's queue. Admin and
> above still see everything.

---

## 4. Does anything read pulse selections yet?

`/api/pulse/selections` exists and the console writes to it. But the Teams bot and the
Android app still read `/api/pulse/questions` and ask everyone the whole bank.

Until delivery reads selections, the console will warn that departments are not being
asked anything while employees are in fact being asked — a contradiction that will look
like a bug in the console. See §0c of `docs/PULSE_QUESTIONS_BACKEND.md`.

---

## 5. Two small ones, both outstanding a while


**`department` on each celebrant** — `/api/employees/celebrations` sends none, so the
console joins against the directory to decide which HRBP may see whom. That join fails
silently for anyone the directory does not return, and we resolve it by hiding them.
Safe, but a real person can vanish for reasons invisible from the page.

**`officialEmail` on each celebrant** — without it the Wish button has nobody to open a
chat with and hides itself. Oldest item on the list.

Both in `docs/CELEBRATIONS_BACKEND.md`.

---

## How the routes were surveyed

Unauthenticated calls, reading `404` as "no such route" and `401` as "exists, needs
auth". The guard runs after routing, so the two are reliably different.

| Route | |
|---|---|
| `/api/holidays`, `/api/holidays/regions` | exists |
| `/api/pulse/questions`, `/api/pulse/selections`, `/api/pulse/questions/order` | exists |
| `/api/employees/celebrations`, `/api/employees/me` | exists |
| `/api/access/users`, `/api/access/roles`, `/api/audit` | **404** |
| `PATCH /api/tickets/{id}/assignee` | **404** |
| `/api/auth/me` | **404** (we use `/api/employees/me`) |

---

## One thing that arrived unasked: `dateOfBirth`

The employee payload now includes `dateOfBirth`. Two consequences worth a decision
rather than a default:

**It unblocks birthdays in the month ahead.** The Celebrations page says birthdays can
only be known on the day, because nothing carried a birth date. That is no longer true,
and the page can look ahead the way it does for anniversaries.

**It is more personal data than the console needs.** A birth date gives an age; month
and day are all a birthday list requires. `docs/CELEBRATIONS_BACKEND.md` asks for month
and day on the celebrations endpoint for exactly this reason — the directory is
work-facing, and every HR account can read it.

Our preference is to drop `dateOfBirth` from the directory and add month-and-day to
`/api/employees/celebrations`. Happy to use what is there if you would rather not
change it, but the narrower field is the better shape.
