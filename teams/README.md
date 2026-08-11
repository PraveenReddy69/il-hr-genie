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

## What this is not, yet

- **No SSO.** The bot calls the API as one configured employee, set in `.env`. Teams
  SSO through Entra replaces it: the real app reads the caller's identity from their
  token and never sees a password. Until then, **every user of this POC appears to the
  backend as that one account** — fine for a demo, wrong for anyone else.
- **No proactive messages.** When HR resolves a ticket, the Android app gets a push;
  here nothing arrives until you ask. Sending it needs the conversation reference
  stored per user at install, and the backend calling the bot when a ticket changes.
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
