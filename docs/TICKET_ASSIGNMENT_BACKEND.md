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

## 4. Assign it on the way in

`hrbpId` now arrives on the employee record, alongside `l1ManagerId`:

```jsonc
{ "employeeId": "EMP3801", "hrbpId": "HYD606840", "l1ManagerId": "HYD608263" }
```

That settles a question this document previously left open. **A ticket should be
assigned to the raiser's tagged HRBP when it is created**, not left for an Admin to
route by hand.

```
POST /api/tickets
  → look up the raiser's hrbpId
  → that id resolves to an active HR account  →  assigneeId = hrbpId
  → it does not, or there is no tag           →  assigneeId = null
```

An unresolvable tag means unassigned, never a guess. An HRBP who has left, or an id
that points at somebody who is not an HR account, must not become an owner — a ticket
sitting in a departed employee's queue is invisible in a way an unassigned one is not.
Unassigned is a state the console already shows, counts and prompts on.

This replaces an earlier position in this file, which was that nothing should ever be
auto-assigned: a queue that grows owners nobody chose has no record of who decided, and
the honest answer the first time one is wrong would be "nobody did". That objection is
answered rather than dropped — see the next paragraph — and it does not outweigh the
cost of the alternative, which is every ticket landing in a pile for one Admin to
hand-route before anyone can act on it.

**So record that the system did it.** Whatever the audit log ends up being, an
auto-assignment is not the same event as a person assigning, and reading them back as
identical is the failure the original objection was about:

```jsonc
{ "ticketId": "HRG-0036", "assigneeId": "HYD606840",
  "assignedBy": "SYSTEM", "reason": "HRBP_TAG" }
```

`assignedBy: "SYSTEM"` with `reason: "HRBP_TAG"` says a rule did this and which rule.
An Admin reassigning later is `assignedBy: "<their id>"`, and the difference is the
whole point.

**Reassignment stays a person's decision.** Auto-assignment applies at creation only.
Nothing should re-run the rule afterwards — an Admin who moves a ticket has overruled
the tag deliberately, and a rule that quietly puts it back is worse than no rule.

### What the console does with the tag

It suggests, and says why. The picker puts the tagged HRBP first, labelled
**"their HRBP"**, and department cover — the weaker, inferred reason — is labelled
separately as such. Where there is neither, the drawer says so plainly rather than
implying somebody will pick it up.

That stays useful after auto-assignment lands: it is what an Admin sees when they open
a ticket the rule could not route, and what they check against when overruling one it
did.

---

## 5. Also worth having

**The bot should say who is looking at it.** Once a ticket has an assignee, the status
card the employee gets in Teams could name them — "Priya is looking into this" is a
materially better message than "In progress", and it is the same `POST /notify` call
with one more field. Not needed now; worth not designing out.

**Log assignments.** Per `docs/ACCESS_CONTROL.md` section 6, the audit log already wants
role and scope changes. Assignment belongs with them: who handed what to whom is a
question with consequences the moment a ticket is missed.
