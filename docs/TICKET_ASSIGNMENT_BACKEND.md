# Ticket assignment — one field, one route, and a visibility rule

Handoff for the backend team. The console half is built and runs on its mock.

Admin can now hand a ticket to a particular HRBP. The field and the route are trivial;
**the visibility rule is the part that matters**, and it is the part a client cannot
enforce.

---

## 1. The field

`Ticket` gains one:

```jsonc
{
  "id": "HRG-0004",
  "employeeId": "EMP3801",
  "subject": "...",
  "assigneeId": "HR000"     // or null — nobody has picked it up
}
```

`assigneeId` is an HR account's `employeeId`. Absent or `null` means unassigned, which
is a normal state, not a missing value.

---

## 2. The route

```http
PATCH /api/tickets/{id}/assignee
{ "assigneeId": "HR000" }     // or { "assigneeId": null } to hand it back

→ 200  the updated ticket
```

Separate from the status route on purpose. Assigning and resolving are different
decisions, and folding them together means neither can happen without the other.

**Do not touch `updatedAtMillis`.** Handing a ticket over is not progress on it. Letting
an assignment reset the clock makes an ageing queue look fresh every time somebody
shuffles it, which is exactly when you least want that.

`tickets.assign` — Admin and above, per `docs/ACCESS_CONTROL.md`. An HRBP calling this
gets `403`. Assigning to a non-HR account is `422`.

---

## 3. The visibility rule

This is the request. Everything above is plumbing.

**`GET /api/tickets/list` must already be narrowed by the caller.** The console applies
the same rule so it does not draw rows it would then have to hide, but a filtered list
from an unfiltered endpoint is a courtesy, not a boundary — the raw list is one curl
away.

For an **HRBP**:

| The ticket is | They see it |
|---|---|
| Assigned to them | **Yes** — whatever department it came from |
| Assigned to someone else | **No** |
| Unassigned | Yes, if the raiser's department is in their scope |

For **Admin and Main Head**: everything. Somebody has to be able to find a ticket whose
assignee is on leave, and that is most of what an escalation is.

### Assignment narrows, it never widens

Worth stating on its own, because getting it backwards in either direction is a real
failure:

- Assigning a ticket to an HRBP who does **not** cover that department gives them **the
  ticket**, not the department. They still see nothing else from it.
- Assigning a ticket **away** from an HRBP takes it off their queue **even though it is
  still in their scope**.

Both are what a person means when they say "give that one to Priya". The second is the
whole feature: without it, everyone in the department still sees the ticket, still
replies, and the assignment is a label rather than a handover.

---

## 4. What we would like from the directory

The console suggests an assignee rather than picking one. Today it can only guess from
department coverage. One optional field would make the suggestion right most of the
time:

```jsonc
{ "employeeId": "EMP3801", "hrbpId": "HR000" }   // on /api/employees
```

The HR account tagged as that employee's HRBP. The console already reads it where
present and falls back to department coverage where it is not, so this can land whenever
it suits — nothing breaks in the meantime.

**Even with it, nothing is auto-assigned.** The suggestion fills the top of the picker
and says why. A queue that grows owners nobody chose is one where, the first time an
assignment is wrong, there is no record of who decided — and the honest answer would be
"nobody did".

---

## 5. Also worth having

**The bot should say who is looking at it.** Once a ticket has an assignee, the status
card the employee gets in Teams could name them — "Priya is looking into this" is a
materially better message than "In progress", and it is the same `POST /notify` call
with one more field. Not needed now; worth not designing out.

**Log assignments.** Per `docs/ACCESS_CONTROL.md` section 6, the audit log already wants
role and scope changes. Assignment belongs with them: who handed what to whom is a
question with consequences the moment a ticket is missed.
