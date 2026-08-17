# Ticket updates in Teams — one call from the HR Genie API

**One HTTP call, at a place in your code that already exists.** When HR moves a ticket
you already send an FCM push for the Android app; this adds a second call beside it so
the same update reaches the employee in Microsoft Teams.

Nothing else changes. No new dependency, no schema change, no retry logic.

---

## Why Firebase cannot do this

The natural assumption is that the Teams notification is another FCM topic or token.
It is not, and the difference is not a detail:

**Firebase delivers to devices. Teams messages go through Microsoft's Bot Connector**,
and only a registered bot may send one. There is no device token, no topic, and no
Firebase path into a Teams chat.

So the Teams bot has to send it, and the bot only knows a ticket moved when you tell
it. Your existing FCM push stays exactly as it is — this sits next to it.

---

## The call

```http
POST https://hrgenie-bot.devinfinitylearn.in/notify
x-notify-secret: <the shared secret>
Content-Type: application/json

{
  "employeeId": "EMP3801",
  "ticketId": "HRG-0027",
  "status": "RESOLVED",
  "comment": "Reversed in the August run.",
  "subject": "My March payslip is missing the shift allowance",
  "category": "Payroll"
}
```

| Field | Required | Notes |
|---|---|---|
| `employeeId` | **Yes** | The same id the rest of the API uses |
| `ticketId` | **Yes** | `HRG-0027` |
| `status` | **Yes** | `OPEN`, `IN_PROGRESS` or `RESOLVED`. Case-insensitive |
| `comment` | No | What HR wrote. Optional, and the whole point of the message |
| `subject` | No | So the card names the ticket rather than only its reference |
| `category` | No | Shown on the card |

**`comment` is what makes this worth sending.** A card saying "HRG-0027 is now
resolved" is a status change; a card carrying "Reversed in the August run" is an
answer. Send it whenever there is one.

---

## Where it goes in your code

Beside the FCM push, **after the status write commits**:

```ts
// after the status write commits, beside the existing FCM push
void this.teamsBot.notifyTicketMoved(ticket).catch((error) => {
  // Never fail the ticket write on this. A ticket HR has been told was updated must
  // stay updated even if Teams is unreachable.
  this.logger.warn(`Teams notify failed for ${ticket.id}: ${error.message}`)
})
```

```ts
async notifyTicketMoved(ticket: Ticket): Promise<void> {
  await fetch(`${process.env.HRGENIE_BOT_URL}/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-notify-secret': process.env.HRGENIE_NOTIFY_SECRET,
    },
    body: JSON.stringify({
      employeeId: ticket.employeeId,
      ticketId: ticket.id,
      status: ticket.status,
      comment: ticket.latestComment,
      subject: ticket.subject,
      category: ticket.category,
    }),
  })
}
```

**Fire and forget.** No retry, no queue, no failing the transaction. If Teams is
unreachable the employee still sees the update in the app and in their ticket list —
the notification is a convenience, not the record.

---

## Configuration

```
HRGENIE_BOT_URL       = https://hrgenie-bot.devinfinitylearn.in
HRGENIE_NOTIFY_SECRET = <shared secret — sent separately, not in this document>
```

The secret is the same value the bot has. It exists so that only you can push a
message that looks like it came from HR into an employee's Teams chat.

---

## What comes back

| Response | Meaning | What to do |
|---|---|---|
| `200 {"delivered":true}` | It is in their Teams chat | Nothing |
| `200 {"delivered":false,"reason":"..."}` | That person has never opened HR Genie | **Nothing.** Not fixable from your side — Teams forbids messaging someone before they install the app |
| `401` | Bad or missing `x-notify-secret` | Check the header |
| `422` | A required field is missing | A bug in the call |
| `503` | The bot could not reach the Bot Connector | Log it; retry is optional |

**Call it for everyone, not only known Teams users.** The `delivered:false` case exists
so that people who have never opened the bot cost you one ignored request rather than
an error to handle.

---

## Testing it

Before wiring anything, prove the endpoint works with a real employee id — a card
appears in that person's Teams chat within a second:

```bash
curl -s -X POST https://hrgenie-bot.devinfinitylearn.in/notify \
  -H 'Content-Type: application/json' \
  -H 'x-notify-secret: <the secret>' \
  -d '{"employeeId":"EMP3801","ticketId":"HRG-0027","status":"IN_PROGRESS",
       "comment":"Picked this up, chasing payroll today.",
       "subject":"About Leave Balance","category":"Leave"}'
```

Then check the two failure paths, which are cheaper to see now than in production:

```bash
# wrong secret -> 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://hrgenie-bot.devinfinitylearn.in/notify \
  -H 'Content-Type: application/json' -H 'x-notify-secret: nope' -d '{}'

# missing fields -> 422
curl -s -X POST https://hrgenie-bot.devinfinitylearn.in/notify \
  -H 'Content-Type: application/json' -H 'x-notify-secret: <the secret>' -d '{}'
```

---

## Later, if you want it: the daily check-in reminder

Same endpoint, different `type`. Worth treating as a second phase — land the ticket
updates first.

```http
POST https://hrgenie-bot.devinfinitylearn.in/notify
x-notify-secret: <the shared secret>

{ "type": "checkInReminder", "employeeId": "EMP3801", "firstName": "Praveen" }
```

The card carries the five mood faces, so answering is one tap.

**Your cron decides who to remind.** You know who has no check-in today; the bot does
not. Send it only for those people, around 10am local — launch-triggered would pester
whoever opens Teams at 11pm.

**The bot will not send twice in one day regardless.** A cron misconfigured to run
hourly would otherwise ask someone about their wellbeing twelve times, which is how an
app gets muted. A repeat answers `200 {"delivered": false, "reason": "already reminded
today"}` — nothing went wrong and there is nothing to retry. A *failed* delivery does
not count, so a genuine retry still gets through.

---

## Also outstanding, unrelated to notifications

**`officialEmail` on celebrants.** The celebrations response carries no work email, so
the "Wish" button on birthdays and work anniversaries has nobody to open a chat with
and hides itself. One field per person on the existing response.
