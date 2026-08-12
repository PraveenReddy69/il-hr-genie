# Teams SSO — one endpoint the backend needs

Today the Teams bot signs in as **one configured employee**. `HRGENIE_EMPLOYEE_ID` and
`HRGENIE_PASSWORD` sit in the bot's `.env`, and every person who opens HR Genie in
Teams reads and writes that employee's data — their tickets, their mood check-ins,
their pulse answers.

That is fine for a demo and unshippable for anything else. It is the single reason the
app cannot be published to the org catalog: **anyone who installs it reads a
colleague's HR record.**

Teams SSO fixes it. The employee is already signed into Teams against Entra ID, so the
bot can obtain a token proving who they are — silently, after a one-time consent, with
no password anywhere. What is missing is somewhere to send that token.

---

## 1. What exists now

```
POST /api/auth/login    { employeeId, password }  →  JWT
```

That is the whole of authentication. There is no notion of an Entra identity, so SSO
cannot be finished on the Teams side alone.

**The join already exists:** every employee record carries `officialEmail`, and every
employee signs into Teams as that same `@infinitylearn.com` address. Entra email →
`officialEmail` → `employeeId`. Nothing new to model, no new column.

---

## 2. What to add

```
POST /api/auth/teams
{ "token": "<Entra access token, from Teams SSO>" }

→ 200 { "token": "<the usual HR Genie JWT>", "employee": { ...same shape as /auth/login } }
```

The bot calls it once per user, caches the JWT, and behaves exactly as it does today
from that point on. Every other route is unchanged.

### Validating the token — the part that is the security boundary

A JWT is base64, not a secret. Anyone can hand-write one claiming to be the CEO. **The
endpoint must verify, not decode.** Four checks, all standard, all library-supported:

| Check | Value |
|---|---|
| Signature | against Entra's JWKS at `https://login.microsoftonline.com/156a3c5b-d91e-4c1e-a519-1155bc2ff675/discovery/v2.0/keys` |
| Issuer (`iss`) | `https://login.microsoftonline.com/156a3c5b-d91e-4c1e-a519-1155bc2ff675/v2.0` |
| Audience (`aud`) | `api://<bot-entra-client-id>` — the exact App ID URI, no wildcards |
| Expiry (`exp`) | not expired |

Skipping the audience check is the subtle one: a token minted for *any* application in
the tenant would otherwise be accepted here, so a different app's token becomes a login
to HR Genie.

`156a3c5b-d91e-4c1e-a519-1155bc2ff675` is the **infinitylearn.com** tenant. Note that
`rankguru.com` is a *separate* Entra tenant (`50eba315-…`) — tokens from it must not be
accepted. Verify either at any time with:

```bash
curl https://login.microsoftonline.com/infinitylearn.com/v2.0/.well-known/openid-configuration
```

### Reading the identity

Take the email from `preferred_username`, falling back to `upn` then `email`. Compare
to `officialEmail` **case-insensitively** — Entra does not preserve case and HR records
will not match otherwise.

### Responses

| Status | When | Body |
|---|---|---|
| `200` | Verified, employee found | `{ token, employee }` |
| `401` | Token invalid, expired, wrong issuer or wrong audience | `{ error: "..." }` |
| `403` | Token valid, but no employee has that `officialEmail` | `{ error: "No employee record for <email>" }` |

Keep `401` and `403` distinct. The first is a broken integration; the second is a real
person missing from the directory, and the bot should say so plainly rather than
claiming a sign-in failure — that difference is the whole of the support conversation.

**Log the `403`s.** A cluster of them means the directory is out of step with Entra —
a joiner not yet added, or someone whose email changed. It is the only early warning
either system gets.

---

## 3. What this removes

- `HRGENIE_PASSWORD` comes out of the bot's `.env` entirely. No shared password, no
  credential to rotate, nothing to leak from a container image.
- Every user is themselves, which is what makes an org rollout safe rather than merely
  tidier. Until then the app stays sideloaded to one person.
- Mood notes stay private to the person who wrote them. Under the shared account they
  are not.

---

## 4. What happens on the Teams side

For context, so the two halves land together. None of it needs backend work:

1. An Entra app registration in the **infinitylearn.com** tenant, App ID URI
   `api://<bot-client-id>`, scope `access_as_user`.
2. `webApplicationInfo` in the Teams manifest — `id` = client id, `resource` = that URI.
3. `https://token.botframework.com` added to `validDomains`.
4. An OAuth connection setting on the Azure Bot, with the App ID URI as its Token
   Exchange URL.
5. Bot code handling the OAuth card and `tokenExchange`, then calling
   `POST /api/auth/teams` with what comes back.

Reference: [Enable SSO with Microsoft Entra ID](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-overview).

---

## 5. The one thing to check first

Confirm a real `officialEmail` matches the Teams sign-in for a handful of people —
ideally someone recently joined, and someone who has changed name. If HR records hold
anything other than the `@infinitylearn.com` address they sign into Teams with, this
whole design needs a mapping rule instead, and it is far cheaper to know that now than
at integration.
