# Roles and access control — HR Genie console

Handoff for the backend team. Nothing here is built yet on either side.

Today the console has one kind of account. `Role` is `EMPLOYEE | HR`, every HR account
sees the whole organisation, and the only check is a React condition in the browser.
This replaces that with three tiers, per-department scope, and enforcement on the API.

**The part that matters most:** every rule below has to be checked on the server, per
endpoint, from the role in the token. The console will mirror all of it, but only so
that people are not shown doors they cannot open. A client-side check is bypassed with
devtools in ten seconds. Today that is harmless — all HR accounts are identical, so
there is nothing to escalate *to*. The moment Admin can do something HR cannot, a
browser-only check is theatre.

---

## 1. The roles

```
EMPLOYEE    the mobile app and the Teams bot. Never enters the console.
HR          HRBP. Day to day. Scoped to assigned departments.
HR_ADMIN    Admin. Organisation-wide. Manages HR accounts and access.
HR_HEAD     Main Head. Everything, plus who gets to be an Admin.
```

Strictly ordered, so a check is `rank(actual) >= rank(required)`:

| Role | Rank |
|---|---|
| `EMPLOYEE` | 0 |
| `HR` | 1 |
| `HR_ADMIN` | 2 |
| `HR_HEAD` | 3 |

Send the **uppercase constant**, matching the convention in `API_SCHEMA.md`.

### Migration

Every existing `HR` account stays `HR`. Promote explicitly, one at a time, and seed
exactly one `HR_HEAD` by hand.

Do not bulk-promote. A permissions migration that defaults people upward grants access
nobody reviewed, and it is invisible afterwards — everything simply works for everyone,
which is also what it looks like when it is broken.

---

## 2. Permissions

Bundles are **fixed**. `HR`, `HR_ADMIN` and `HR_HEAD` mean the same thing in every
deployment; they are not configurable. Individual exceptions are handled by grants
(section 4), not by redefining what a role means.

| Permission | HR | Admin | Head |
|---|:--:|:--:|:--:|
| `dashboard.view` | yes | yes | yes |
| `tickets.view` | yes | yes | yes |
| `tickets.resolve` | yes | yes | yes |
| `people.view` | yes | yes | yes |
| `attendance.view` | yes | yes | yes |
| `trends.view` | yes | yes | yes |
| `analytics.view` | yes | yes | yes |
| `holidays.view` | yes | yes | yes |
| `pulse.view` | yes | yes | yes |
| `pulse.publish` | | yes | yes |
| `holidays.edit` | | yes | yes |
| `sales.view` | | yes | yes |
| `access.manage` | | yes | yes |
| `audit.view` | | yes | yes |
| `roles.assign` | | | yes |

`sales.view` is Admin and above because it is commercially sensitive in a way mood and
tickets are not. Say if that is wrong for your organisation — it is a one-line change.

`pulse.publish` and `holidays.edit` have no backend at all today. Question-bank edits
are written to `localStorage` in the browser and the holiday list is static. The
permissions are defined now so those endpoints arrive with them already in place,
rather than being retrofitted onto something already shipped without them.

---

## 3. Department scope

`HR` accounts read only the departments assigned to them. `HR_ADMIN` and `HR_HEAD` read
the whole organisation.

Scope is a **property of the account**, not a request parameter. A client asking for a
department outside its scope gets `403`, never a filtered-but-successful response —
silent filtering makes a scope bug look like a quiet week.

```json
{
  "employeeId": "HR004",
  "role": "HR",
  "departments": ["Experience", "Growth"]
}
```

An `HR` account with an empty `departments` array sees nothing. That is the correct
failure: an unassigned HRBP is a configuration mistake, and showing them everything
until someone notices is exactly the leak this feature exists to prevent.

### What scope applies to

Every read that names or aggregates people:

| Endpoint | Scoped by |
|---|---|
| `GET /api/employees` | the employee's department |
| `GET /api/employees/{id}/summary` | that employee's department |
| `GET /api/tickets/list` | the raiser's department |
| `PATCH /api/tickets/{id}/status` | the raiser's department |
| `GET /api/attendance/*` | the employee's department |
| `GET /api/mood/*`, `GET /api/pulse/*` | the employee's department |
| `GET /api/stats` | aggregates over in-scope departments only |

### A consequence worth deciding on now

Mood and pulse are already withheld below **5 responses**, so that no individual can be
identified from a number. Scoping narrows the pool that floor is measured against, so a
small department that used to disappear into an organisation-wide average may now
report nothing at all to its own HRBP.

That is the privacy rule working rather than a bug, and the console already says which
of the two it is looking at. But it means an HRBP covering two teams of four sees no
sentiment data, ever. Worth knowing before someone asks why their dashboard is empty.

---

## 4. Grants

A per-person addition or removal on top of the role's fixed bundle, for cases that do
not justify a promotion — an HRBP who also curates the pulse questions, say.

```json
{ "add": ["pulse.publish"], "remove": [] }
```

Effective permissions are `bundle(role) + add - remove`. The escalation rules in
section 5 apply to grants exactly as they do to role changes.

---

## 5. Escalation rules

These are the feature. Without them, "Admin manages access" means Admin is Head.

1. **You cannot grant a permission you do not hold.** No bootstrapping upward.
2. **You cannot edit an account at or above your own rank.** Admin administers HRs;
   Head administers Admins. This includes yourself — nobody raises their own rank or
   grants themselves a permission.
3. **`access.manage` and `roles.assign` can only be granted by `HR_HEAD`.** Admin uses
   them; only Head hands them out. Without this rule, rule 1 is satisfied trivially: an
   Admin holding `access.manage` passes it onward and the tier collapses.
4. **The last active `HR_HEAD` cannot be demoted or deactivated.** Reject with a message
   naming the reason. Otherwise one click locks the organisation out of its own console,
   recoverable only by someone with database access.

Rule 4 needs a count rather than a flag: check that at least one other active `HR_HEAD`
exists at the moment of the write, inside the same transaction.

---

## 6. Endpoints

### Sign-in and session

`POST /api/auth/login` and `GET /api/auth/me` already exist. Both responses grow three
fields on the employee object:

```json
{
  "employeeId": "HR004",
  "name": "...",
  "role": "HR",
  "departments": ["Experience", "Growth"],
  "permissions": ["dashboard.view", "tickets.view", "tickets.resolve"]
}
```

`permissions` is the **effective** list — bundle plus grants, already resolved. The
console renders from it and never recomputes a bundle of its own, so changing what `HR`
includes never needs a matching front-end release.

`departments` is empty for `HR_ADMIN` and `HR_HEAD`, meaning organisation-wide. An empty
array on an `HR` account means no access, per section 3 — the two cases are told apart
by role, not by the array.

### Managing access

```http
GET /api/access/users
```

The accounts the caller may administer, which is everyone below their rank. Returns id,
name, role, departments, grants and an active flag.

```http
PATCH /api/access/users/{employeeId}
{ "role": "HR", "departments": ["Experience"], "grants": { "add": [], "remove": [] } }
```

Every field optional. Applies the rules in section 5 and returns `403` with a message
naming which rule was hit — the console shows that message verbatim, so it wants to read
like a sentence rather than a code.

```http
GET /api/access/roles
```

The fixed bundles, so the console can show what a role includes without keeping a copy
that drifts. Read-only; there is no PUT.

```http
GET /api/audit?limit=100&cursor=...
```

Requires `audit.view`.

```json
{
  "atMillis": 1754500000000,
  "actorId": "HR001",
  "action": "ROLE_CHANGED",
  "targetId": "HR004",
  "before": { "role": "HR" },
  "after": { "role": "HR_ADMIN" }
}
```

Log role changes, grant changes, scope changes, activation and deactivation, and ticket
resolutions. Once the tiers differ, "who resolved this" and "who promoted whom" become
questions with consequences.

---

## 7. What does not change with rank

**`HR_HEAD` sees exactly what an HRBP sees about any individual.** Specifically:

- The **5-response floor** on mood and pulse applies to every role, Head included.
- **Individual mood notes are never returned to any console account, at any rank.**

The app told employees their notes are private and that their mood reaches HR only as
anonymised trends. That promise has no seniority exception, and a role system is
precisely the thing that invites one: the argument that the top tier should see
everything is easy to make and impossible to walk back once somebody has read a note.

Rank buys **breadth** — more departments, more administrative actions. It never buys
**depth** into an individual's answers.

Please enforce this on the server rather than by omission in the console. It should be
impossible to construct a request that returns a note, whoever is asking.

---

## 8. Order of work

1. Role enum, plus `departments` and `permissions` on both auth responses and in the token.
2. Per-endpoint permission checks.
3. Department scope on the reads in section 3.
4. `GET /api/access/users`, `PATCH /api/access/users/{id}`, `GET /api/access/roles`.
5. Audit log and `GET /api/audit`.

Steps 1 and 2 unblock the console entirely; the rest can follow. Until they land the
console runs against its mock, which serves the same shapes locally.
