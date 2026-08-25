# What the console needs next

Short list, in the order that unblocks the most. Everything here was checked against
`hrgenie-api.devinfinitylearn.in` on 21 August 2026 — the route survey at the bottom
says how.

---

## 1. Blocking today: login says HR, the write says it is not

Signing in as **HYD604982 (OM Narayan)** succeeds and `role` comes back as `HR`.
Creating a holiday as the same account, in the same session, with the same token:

```http
POST /api/holidays
→ 403 {"message":"This action requires the HR role.","error":"Forbidden","statusCode":403}
```

Both cannot be true. Our guess is that the write guard reads a role from the **JWT
claims** while the login response reports the role from the **employee record**, and the
token carries no role claim — or a different one.

**What we need to know:** which field does the guard read, and what does it see for this
account? If the answer is "the token has no role", the fix is at sign-in, not on the
endpoint.

This blocks every write in the console: holidays, pulse questions, pulse selections.

---

## 2. One field, and the console stops guessing at roles

`/api/auth/login` and `/api/employees/me` return `role: "HR"` for every HR account,
because `HR` is the only role the API has. The console therefore cannot tell an Admin
from an HRBP, and **currently carries a hard-coded map of three employee ids to roles**
to work around it. That map is client-side, publicly readable, and should not exist.

```jsonc
{ "employeeId": "HYD604982", "role": "HR_ADMIN" }
```

Three roles, ordered: `HR` (HRBP) · `HR_ADMIN` (Admin) · `HR_HEAD` (Main Head). The
console already reads a server-sent role in preference to its own map, so the day this
lands the map stops having any effect — no release needed on our side.

Full model in `docs/ACCESS_CONTROL.md`, but **this one field is worth doing on its own,
ahead of the rest.**

---

## 3. Ticket assignment — the last piece of the primary feature

`PATCH /api/tickets/{id}/assignee` returns **404**. Tickets is the highest-priority
screen and assignment is the one thing on it still running on a mock.

One field on the ticket, one route, and one rule about who may see what — all in
`docs/TICKET_ASSIGNMENT_BACKEND.md`. The rule is the part that matters:

> An assigned ticket goes to its assignee and leaves everyone else's queue. Admin and
> above still see everything.

Without the rule enforced server-side, assignment is a label rather than a handover.

---

## 4. Is the calendar seeded?

`GET /api/holidays` answers, but we cannot see whether it has any rows. The console no
longer falls back to its built-in list when live — it used to, and with editing now real
that would have offered rows to edit which do not exist on the server.

So an empty calendar means an empty page. `docs/holidays.json` is the published 2026
calendar, ready to load.

---

## 5. Does anything read pulse selections yet?

`/api/pulse/selections` exists and the console writes to it. But the Teams bot and the
Android app still read `/api/pulse/questions` and ask everyone the whole bank.

Until delivery reads selections, the console will warn that departments are not being
asked anything while employees are in fact being asked — a contradiction that will look
like a bug in the console. See §0c of `docs/PULSE_QUESTIONS_BACKEND.md`.

---

## 6. Two small ones, both outstanding a while

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
