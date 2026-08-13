# Reopening a ticket — what the backend needs

Today a ticket ends when HR resolves it. The employee is told, and that is the end of
the conversation whether or not the thing was actually fixed. There is no way to say
"that did not solve it" short of raising a second ticket, which loses the history and
looks like a new problem to whoever picks it up.

The proposal: when a ticket is `IN_PROGRESS` or `RESOLVED`, the employee can read
HR's response, say whether it helped, and — if not — reopen it with more detail.

---

## Why it cannot be built yet

```
PATCH /api/tickets/{id}/status     HR only. "This action requires the HR role."
status enum                        OPEN | IN_PROGRESS | RESOLVED   (no reopened state)
```

Two problems: the only status-change route is closed to employees, and there is no way
to tell a reopened ticket from one that was never resolved. HR would see it slide back
to `OPEN` with no signal that it had already been through them once — which is exactly
the ticket that needs attention most.

---

## What we need

### 1. Let the owner reopen their own ticket

```
POST /api/tickets/{id}/reopen
{ "reason": "The payslip still has the old deduction on it." }

→ 200  the updated ticket
```

- **Only the employee the ticket belongs to.** Not HR — HR already has status change.
- **`reason` required, non-blank.** A reopen with no explanation is worse than useless:
  it tells HR the fix failed but not how. The bot enforces a minimum too; this is the
  authoritative check.
- **Only from `RESOLVED`.** Reopening something already open is a no-op that just
  confuses the audit trail — answer `409`.
- The reason should land in the ticket's comment thread, attributed to the employee,
  so the whole history reads in order.

### 2. Mark it as reopened

Either is fine, and the second is less work:

- **A `REOPENED` status** in the enum, or
- Keep `OPEN` and add a counter — `reopenCount` — plus `reopenedAt`

What matters is that **HR can tell**. A ticket that has come back is not the same as a
new one, and it should be possible to filter and sort on it. If you take the counter
route, please return it on the ticket object so both clients can badge it.

### 3. Satisfaction, if it is cheap

When the employee says the fix *did* work, we currently do nothing with it. If a field
is easy — `resolutionAccepted: true/false` with a timestamp — it becomes the only
honest measure of whether HR resolutions actually land. If it is not cheap, skip it;
the reopen path is the valuable half.

---

## What we will build on top

- **The HR response, expandable.** Ticket comments already come back on the ticket, so
  this part needs nothing new — it can ship before any of the above.
- **"Did that help?"** under the response, on `RESOLVED` tickets only.
- **No → Reopen or Leave it.** Reopen asks for more detail before sending, with the
  same minimum length the ticket flow already applies.
- **The HRBP console** gains a reopened filter and a badge on the row.

---

## One thing worth deciding together

Should reopening be limited — say, twice — before it becomes a conversation rather
than a loop? A ticket bouncing between resolved and reopened four times is a sign that
the ticket is the wrong tool, and a cap gives HR a natural point to pick up the phone.
Not a technical question, but it needs an answer before this ships.
