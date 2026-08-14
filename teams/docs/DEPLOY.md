# HR Genie Teams bot — deployment brief

For whoever runs `hrgenie-api.devinfinitylearn.in`. The bot is a small Node service
that wants to sit **beside** that API, on its own hostname.

It is currently running on a developer laptop behind a temporary tunnel. That has to
stop before anyone else uses it: the tunnel dies when the laptop sleeps, and its URL is
baked into Microsoft-side configuration that only an administrator can change.

**Scale: four people to start.** No load concerns; this is about being always-on and
having a permanent address.

---

## What it is

| | |
|---|---|
| Runtime | **Node 20 LTS or newer** (developed on 24) |
| Framework | Express — one HTTP listener, no worker processes |
| Dependencies | `botbuilder`, `express`, `dotenv`. Nothing native, nothing to compile |
| Database | **None.** It calls the HR Genie API for everything |
| Build | `npm ci && npm run build` (TypeScript → `dist/`) |
| Run | `npm start` → `node dist/index.js` |
| Port | `PORT`, default `3978` |

Source lives in the `teams/` directory of the HR Genie repository.

---

## What we need

### 1. A hostname with HTTPS

```
hrgenie-bot.devinfinitylearn.in        (or whatever fits your naming)
```

**HTTPS with a publicly trusted certificate is mandatory, not a preference.** Microsoft's
Bot Connector calls this endpoint from the internet and refuses plain HTTP or a
self-signed certificate. It must also be reachable from outside the corporate network —
the traffic originates from Microsoft, not from an employee's browser.

**The hostname cannot change afterwards without an administrator.** It gets written into
the Entra application registration and the Teams app package, so please treat the first
choice as permanent.

### 2. Always-on

The bot delivers proactive messages — when HR moves a ticket, the backend calls it and
it pushes a card into the employee's Teams chat. A process that sleeps when idle misses
those. No autoscaling needed; **one instance** is right (see *State* below).

### 3. Inbound

| | |
|---|---|
| `443` from the internet → the app's port | Microsoft calls `POST /api/messages` |
| Also serves | `/tab/*` — four small pages Teams embeds, same origin as their data |
| Health check | `GET /healthz` → `{"ok":true}`. No auth, safe to poll |

### 4. Outbound

| Host | For |
|---|---|
| `login.microsoftonline.com` | Token validation and sign-in |
| `*.botframework.com`, `token.botframework.com` | The Bot Connector and its token service |
| `hrgenie-api.devinfinitylearn.in` | The HR Genie API |
| `praveenreddy69.github.io` | Card icons (moving in-house later) |

### 5. Configuration

Environment variables, **not** a file in the repository. Four are secret.

| Variable | Value | Secret |
|---|---|---|
| `MICROSOFT_APP_ID` | `7c9867c8-3ab2-49c0-99e7-6794fea7ee9d` | No |
| `MICROSOFT_APP_PASSWORD` | The bot's client secret | **Yes** |
| `MICROSOFT_APP_TYPE` | `SingleTenant` | No |
| `MICROSOFT_APP_TENANT_ID` | `156a3c5b-d91e-4c1e-a519-1155bc2ff675` | No |
| `SSO_CONNECTION_NAME` | `hrgenie-sso` | No |
| `HRGENIE_BASE_URL` | `https://hrgenie-api.devinfinitylearn.in` | No |
| `PUBLIC_BASE_URL` | `https://<the hostname above>` | No |
| `NOTIFY_SECRET` | A new random string — share with the API team | **Yes** |
| `REFERENCES_FILE` | Path on the persistent volume, below | No |
| `PORT` | Whatever the platform expects | No |

There is deliberately **no employee id or password**. Every user is identified by their
own Teams sign-in.

### 6. A little persistent storage

One JSON file, a few KB, holding where each person's chat lives so notifications can be
delivered. Lose it and nobody gets a ticket update until they next open the chat.

```
REFERENCES_FILE=/var/lib/hrgenie/references.json
```

Any writable path that survives a restart and a redeploy. **No database.**

---

## State, and why one instance

Half-finished work — a ticket draft being typed, a check-in mid-answer — is held **in
memory**. Two consequences worth knowing:

- **A restart drops anything in progress.** The person retypes a sentence. Nothing that
  reached the HR API is affected.
- **A second instance would not share it**, so a draft started on one could be finished
  on the other and lost. Run **one instance** until this moves to a shared store.

Fine for four people. It is on our list before a wider rollout.

---

## Deploying

Whatever you already use for the API is fine. The build produces a plain directory:

```bash
npm ci
npm run build
npm start
```

Any of: a systemd unit, a container (`node:20-slim`, copy, build, run), or your existing
pipeline. **What we need from you is the deploy path** — a pipeline we can trigger, a
registry to push to, or credentials for the host.

There is no state to migrate and no downtime window needed.

---

## Also from the API team

Two things on the HR Genie API side, unrelated to hosting:

**1. Call the bot when a ticket moves.** This is what turns HR's reply into a message in
the employee's Teams chat. After the status write commits, and never allowed to fail the
write:

```http
POST https://<the bot hostname>/notify
x-notify-secret: <NOTIFY_SECRET>
Content-Type: application/json

{ "employeeId": "EMP3801", "ticketId": "HRG-0012", "status": "RESOLVED",
  "comment": "Reversed in the August run.", "subject": "...", "category": "Payroll" }
```

Returns `200 {"delivered":true}`, or `200 {"delivered":false,"reason":"..."}` if that
person has never opened the bot. Treat any failure as ignorable — it must never break a
ticket update.

**2. `officialEmail` on celebrants.** The celebrations response has no work email, so the
"Wish" button has nobody to open a chat with and hides itself. See
`docs/CELEBRATIONS_BACKEND.md`.

---

## What happens once you give us a hostname

In order, and steps 2–4 are a coordinated ten minutes rather than four separate days:

1. **You** deploy and confirm `https://<host>/healthz` answers.
2. **Entra admin** changes the Application ID URI to `api://<host>/botid-7c9867c8-…`.
3. **We** update the Azure Bot's messaging endpoint and its OAuth connection to match.
4. **We** repackage the Teams app against the new hostname and reinstall it.
5. **Teams admin** grants app upload to the other three testers.

Between steps 2 and 3, sign-in is briefly broken — which is why they run together.
