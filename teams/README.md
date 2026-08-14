# HR Genie — Teams bot service

An internal HR assistant for Infinity Learn, delivered as a Microsoft Teams app: raise
and track HR tickets, a daily check-in, the monthly pulse, holidays, and team
celebrations.

It is a **client**, not a system of record. Everything it shows comes from the HR Genie
API — the same service the Android app and the HRBP console use. It stores no employee
data of its own.

Employees are identified by their own Teams sign-in through Entra SSO. There is no
shared account and no password anywhere in this service.

---

## Deploying

**[docs/DEPLOY.md](docs/DEPLOY.md)** — runtime, hostname, environment variables, the one
piece of persistent state, and what the HR Genie API needs to call. Start there.

```bash
npm ci
npm run build
npm start
```

Node 20 or newer. Three runtime dependencies, none native. A `Dockerfile` is included if
that is easier than systemd.

---

## What it serves

| Route | For |
|---|---|
| `POST /api/messages` | Microsoft's Bot Connector. This is the bot |
| `GET /tab/*` | Four pages Teams embeds — tickets, pulse, holidays, celebrations |
| `GET /icons/*` | Card artwork, from `assets/icons` |
| `POST /notify` | The HR Genie API calls this when a ticket moves |
| `GET /healthz` | `{"ok":true}` — no auth, safe to poll |

---

## Configuration

Environment variables. `.env.example` lists every one with a note on what it does, and
the deployment brief has the values. Two are secret: the bot's client secret, and the
shared secret the HR Genie API uses to call `/notify`.

`.env` is never committed.

---

## Tests

```bash
npm test              # 196 tests — no network, no accounts
npm run test:images   # every glyph a card references is actually shipped
```

Neither needs a deployment, a Microsoft account, or the backend.

---

## Also here

- **[docs/DEPLOY.md](docs/DEPLOY.md)** — hosting, configuration, go-live sequence.
- **[docs/TEAMS_SSO_BACKEND.md](docs/TEAMS_SSO_BACKEND.md)** — the sign-in endpoint on
  the HR Genie API, and how the token it receives is verified.
