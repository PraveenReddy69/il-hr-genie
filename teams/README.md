# HR Genie in Microsoft Teams — proof of concept

A Teams bot over the **same backend** the Android app and the HRBP console already use.
Nothing here replaces that service; it is a third client.

What works today: the welcome card, knowledge-base answers, the full ticket flow
(category → subject → preview → raise → receipt) and My tickets.

---

## Try it with no Microsoft account at all

The conversation logic is deliberately separate from the Teams plumbing, so it can be
driven from a terminal:

```bash
cd teams
npm install
cp .env.example .env    # fill in HRGENIE_EMPLOYEE_ID and HRGENIE_PASSWORD
npm run build && npm run try
```

That prints the whole exchange, calls the real backend, and asserts that pressing
**Raise it** twice files one ticket rather than two.

Without credentials it still runs — every backend call reports why it could not
answer, which is the same thing an employee would see if the service were down.

---

## Tests

```bash
npm test          # 110 tests, no network, no accounts
npm run test:images   # checks every card image actually loads
```

Three layers, and the split matters:

- **`conversation.test.ts`** — the flow, against a fake gateway. This is where the
  decisions live: one press files one ticket, a failed raise keeps what was typed,
  nothing is marked seen before it has been shown, the knowledge base never invents
  an answer.
- **`cards.test.ts`** — every card the bot can send, checked structurally. No blank
  text, no submit action carrying a `kind` the adapter cannot map, no image over
  plain http, every input has an id. Both bugs this layer exists for got past a human
  reading the code.
- **`images.test.ts`** — kept out of the default run because it needs the network.
  The artwork is served by the console's Pages site, so a bad deploy shows up here
  rather than as a card with holes in it in front of an employee.

What none of them cover: how the cards *look*, and whether the backend still returns
the shapes `api.ts` expects. The first needs eyes, the second needs a live account.

---

## Try it as a chat, still with no Teams

1. Install the **Bot Framework Emulator**.
2. `npm start` (listens on `http://localhost:3978/api/messages`).
3. In the Emulator, open that URL with **no** app id or password.

With `MICROSOFT_APP_ID` empty the adapter accepts unauthenticated calls, which is what
makes this work. This is the first point at which you see the cards render.

---

## Put it in Teams

**This app is for one organisation.** It goes in the tenant's own app catalog, not
the public Teams store — never listed publicly, never installable by another company,
no Microsoft review. Partner Center and the store are for apps you want the world to
have. The Azure Bot is registered **SingleTenant** for the same reason: it is bound to
one Entra tenant and will not authenticate anywhere else.

Three things are needed, in order:

1. **An Azure Bot registration.** Free tier is enough. Set its messaging endpoint to
   `https://<your-tunnel>/api/messages` and copy the app id and secret into `.env`.
2. **A tunnel** to your machine — a VS Code dev tunnel or ngrok. Teams cannot reach
   `localhost`.
3. **Sideloading.** Put the bot's app id into `appPackage/manifest.json` — both `id`
   and `bots[0].botId` — zip the three files in `appPackage/`, then in Teams:
   **Apps → Manage your apps → Upload an app → Upload a custom app**.

If that upload option is missing, your tenant has custom app upload switched off and
an admin has to enable it — or you use a separate tenant you own. Nothing in steps 1
and 2 needs corporate IT.

---

## Notifications — the contract for the backend

When HR moves a ticket, call this. It is the Teams equivalent of the FCM push the
Android app already receives, and it hangs off the same hook.

```
POST https://<bot-host>/notify
x-notify-secret: <the shared secret>
Content-Type: application/json

{
  "employeeId": "EMP3801",
  "ticketId": "HRG-0011",
  "status": "IN_PROGRESS",
  "comment": "Picked this up, chasing payroll today.",
  "subject": "My July payslip is missing",
  "category": "Payroll"
}
```

`employeeId`, `ticketId` and `status` are required; the rest improve the card.
`status` is case-insensitive.

### The daily check-in reminder

Same endpoint, different `type`. Teams gives no way to interrupt someone with a dialog
when they open the app — a pushed message is the closest thing, and it arrives as a
desktop toast, a badge on the app, and an Activity feed entry.

```
POST https://<bot-host>/notify
x-notify-secret: <the shared secret>

{ "type": "checkInReminder", "employeeId": "EMP3801", "firstName": "Praveen" }
```

The card carries the five faces, so answering is one tap rather than two.

**Your cron decides who to remind.** The bot does not check whether someone has
already checked in — the backend has everyone's mood data and the bot, until SSO,
does not. Send it only for people with no check-in today.

**The bot will not send twice in one day** regardless. A cron misconfigured to run
hourly would otherwise ask someone about their wellbeing twelve times, which is how an
app gets muted. A repeat answers `200` with `{"delivered": false, "reason": "already
reminded today"}` — nothing went wrong, and there is nothing to retry. A *failed*
delivery does not count, so a genuine retry still gets through.

Around 10am local is the sensible slot. Launch-triggered would be worse: you would be
pestering whoever opened Teams at 11pm.

| Response | Meaning | What to do |
|---|---|---|
| `200` | Delivered to their Teams chat | Nothing |
| `401` | Bad or missing `x-notify-secret` | Fix the secret |
| `404` | That employee has never opened HR Genie in Teams | Nothing — not fixable from your side. Teams forbids messaging someone before they install the app. |
| `422` | Body missing a required field | A bug in the call |
| `503` | Secret not configured, or the Bot Connector refused | Retry; log if it persists |

**Call it after the status write commits, and never fail the write on it.** A ticket
that HR has been told was updated must stay updated even if Teams is unreachable —
the employee still sees it in the app and in chat.

---

## What this is not, yet

- **No SSO.** The bot calls the API as one configured employee, set in `.env`. Teams
  SSO through Entra replaces it: the real app reads the caller's identity from their
  token and never sees a password. Until then, **every user of this POC appears to the
  backend as that one account** — fine for a demo, wrong for anyone else.
- **Proactive messages are built but unverified.** `POST /notify` and the conversation
  store are done and tested offline; delivery itself goes through the Bot Connector,
  which needs a real Azure Bot registration. Until then the endpoint answers `404` for
  everyone, because no conversation has ever been recorded.
- **State is in memory.** A restart forgets half-finished drafts.
- **Placeholder icons.** `appPackage/*.png` are drawn by `scripts/make-icons.mjs`
  because there was no image tooling to hand. Replace them with the real brand assets.

---

## Layout

| File | What it is |
|---|---|
| `src/api.ts` | The HR Genie backend. Knows nothing about Teams. |
| `src/cards.ts` | Adaptive Cards. JSON only — paste one into the Adaptive Cards Designer to edit it. |
| `src/conversation.ts` | What the bot says, and when. No Bot Framework types, which is why `try` can drive it. |
| `src/bot.ts` | The Teams shell: activity in, activity out. |
| `src/index.ts` | The HTTP endpoint. |
| `scripts/try.ts` | Drives the whole flow from the command line. |
