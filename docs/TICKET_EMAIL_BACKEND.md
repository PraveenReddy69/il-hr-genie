# Email on ticket creation

When an employee raises a ticket, two people should hear about it by email: the HRBP who
will deal with it, and the employee who raised it.

Handoff for the backend team. Nothing in the console or the bot changes.

---

## 1. Where it goes

**In `POST /api/tickets`, after the ticket is committed.**

Not in the Teams bot. The bot is one of two clients that create tickets — the Android app
is the other — so a send that lives in the bot means every ticket raised from the app
silently gets no email, and nobody finds out for weeks. The API is the single place every
ticket passes through.

---

## 2. Who is emailed

| | Address | From what |
|---|---|---|
| The HRBP | the raiser's `hrbpId` → that account's `officialEmail` | employee record |
| The employee | the raiser's own `officialEmail` | employee record |

Both addresses are already on the records you return; nothing new needs looking up.

### Use `hrbpId`, not `assigneeId`

Auto-assignment is not implemented yet — every ticket in the system currently has
`assigneeId: null` — so keying the email off the assignee would send nothing at all.

It is also the better key regardless. The tag is a standing relationship somebody decided;
the assignee is where the ticket happens to sit right now, and an Admin reassigning a
ticket next week should not change who was told about it when it was raised.

### When the raiser has no HRBP

**177 employees currently have no `hrbpId`** (see §3b of `BACKEND_HANDOVER.md`). For them:

- send the employee their confirmation as normal,
- send no HR email,
- **log it as a warning with the employee id.**

That log line is the point. A ticket nobody was told about is the worst case in this
whole feature, and right now it would happen silently 177 different ways.

---

## 3. What the emails say

### To the HRBP

```
Subject:  New ticket HRG-0041 · Payroll · Gunapati Praveen Reddy

Gunapati Praveen Reddy raised a ticket.

  Reference   HRG-0041
  Category    Payroll
  Raised      1 September 2026, 13:24

Open it in the HR console:
https://praveenreddy69.github.io/il-hr-genie/tickets

— HR Genie
```

### To the employee

```
Subject:  We have your request · HRG-0041

Thanks — your ticket is with HR.

  Reference   HRG-0041
  Category    Payroll

You will get an update in HR Genie on Teams as soon as somebody picks it up.
There is nothing else you need to do.

— HR Genie
```

### Leave the ticket's own text out of both

Recommended, and worth a deliberate decision rather than a default.

A ticket body can hold anything an employee is worried about — their salary, a
grievance, a medical matter. In the console that sits behind a role check and a
department scope. In an email it lands in a mailbox, gets forwarded, gets backed up, and
follows whatever retention policy the tenant has, none of which this system controls.

The reference and the category are enough for the HRBP to act on: they tell them
something arrived and what kind of thing it is, and the console holds the rest. If you
would rather include the subject line, say so and we will note it — but it should be a
choice somebody made, not something that happened because the field was to hand.

---

## 4. Sending it

Microsoft Graph `sendMail` from a shared mailbox — say `hrgenie@infinitylearn.com`.

```http
POST https://graph.microsoft.com/v1.0/users/hrgenie@infinitylearn.com/sendMail
Authorization: Bearer <app-only token>
```

### What IT needs to grant

| | |
|---|---|
| A shared mailbox | `hrgenie@infinitylearn.com`, no licence required |
| An Entra app registration | can be a new one, or the bot's existing registration |
| Application permission | `Mail.Send` |
| Admin consent | for Varsity Education Management |

`Mail.Send` as an *application* permission lets the app send as any mailbox in the
tenant, which is more than this needs. Ask IT to scope it with an **application access
policy** restricted to that one shared mailbox — it is a two-line PowerShell command on
their side and it turns "can send as anyone" into "can send as HR Genie". Worth doing:
it is the difference between a leaked credential sending one kind of email and it
sending mail as the CEO.

SMTP is the obvious alternative and the worse bet — Microsoft has been closing down
basic authentication, and an app password is a long-lived secret with no scoping at all.

**Set `Reply-To` to the HRBP's address** on the employee's mail, so a reply reaches a
person rather than an unmonitored mailbox. On the HRBP's mail, set it to the employee.

---

## 5. A failed email must never fail the ticket

The send happens **after the ticket is committed**, and its outcome is logged, not
returned.

If Graph is slow, rate-limited or down, the employee must still see their ticket filed.
Losing the ticket because the notification failed inverts the importance of the two
things entirely — and the employee is standing in Teams watching for a confirmation
that will never come, because the thing that would have produced it threw.

Retry in the background if you like. Do not retry inline.

---

## 6. Do not send twice

If the send is retried or the endpoint is called again, the same ticket must not produce
a second pair of emails. Key on the ticket reference: one ticket, one notification, ever.

The specific way this goes wrong: a client times out waiting for `POST /api/tickets`,
retries, and the second attempt creates a second ticket — two references, two pairs of
emails, one problem. That is worth guarding at ticket creation rather than at the email,
but the email is where it becomes visible.

---

## 7. Two things for later, not now

**Status changes.** The same hook could email when a ticket is resolved. The employee
already gets that in Teams via `POST /notify`, so it is duplication rather than a gap —
worth having only if HR want the written trail.

**A digest instead of one mail per ticket.** At 38 tickets, one email each is fine. At
ten a day it becomes noise the HRBP filters, and a filtered notification is worse than
none because everybody assumes it is working. If the queue grows, a daily digest per
HRBP will serve them better, and it is easier to design for now than to retrofit once
people have built inbox rules around the per-ticket mail.
