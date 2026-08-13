# `POST /api/auth/teams` — implementation spec

> ## ✅ Shipped and verified end to end, 13 August 2026
>
> A real employee signed in from Teams, the token was validated, and the bot returned
> that person's own session. The spec below is kept as the record of what was built.
>
> **The token this endpoint actually receives**, confirmed against a live sign-in:
>
> ```
> aud   7c9867c8-3ab2-49c0-99e7-6794fea7ee9d          ← the bare client ID
> iss   https://login.microsoftonline.com/156a3c5b-…/v2.0
> tid   156a3c5b-d91e-4c1e-a519-1155bc2ff675
> ver   2.0
> scp   access_as_user
> preferred_username   <employee>@infinitylearn.com
> ```
>
> **`aud` is the bare client ID**, not the `api://botid-…` form. Both are in the
> accepted list; only the first is ever seen in practice.
>
> **The one trap, for anyone reconfiguring this later:** the audience is decided by the
> **Scopes** field on the Azure OAuth connection. Bare OIDC scopes
> (`openid profile email offline_access`) return a **Microsoft Graph** token, which no
> third party can validate — this endpoint correctly rejects it with *"signature
> verification failed"*. Azure's own **Test Connection** passes either way, so it does
> not catch the mistake. The connection must name our API:
> `api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d/access_as_user`.

**One new endpoint.** It accepts a Microsoft Entra token proving who an employee is,
and returns the same session `/api/auth/login` already returns. Nothing else changes:
every other route, guard and JWT stays exactly as it is.

Everything Microsoft-side is configured and tested — Azure Bot, Entra app registration,
OAuth connection, admin consent, all completed 13 August 2026.

---

## Why this exists

Today the Teams bot authenticates as **one shared employee** whose ID and password sit
in the bot's config. Everyone who opens HR Genie in Teams reads and writes that one
person's tickets, mood check-ins and pulse answers.

That is why the app cannot be published to the organisation: **anyone who installs it
reads a colleague's HR record.** Mood notes in particular are supposed to be private,
and under a shared account they are not.

Employees are already signed into Teams against Entra ID. This endpoint turns that
existing identity into an HR Genie session — no password, nothing to rotate, nothing
stored.

---

## The contract

### Request

```http
POST /api/auth/teams
Content-Type: application/json

{ "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIs..." }
```

No `Authorization` header. The Entra token in the body **is** the credential — the
caller has no session yet, which is the whole point.

### Response — 200

```json
{
  "token": "<the usual HR Genie JWT, identical to /api/auth/login>",
  "employee": { "employeeId": "EMP3801", "name": "Gunapati Praveen", "...": "same shape as /api/auth/login" }
}
```

The bot reads exactly two fields — `employee.employeeId` and `employee.name` — and
treats `token` as opaque. Returning the same employee object `/api/auth/login` returns
is simplest and is what the client expects.

### Response — errors

| Status | When | Body |
|---|---|---|
| `401` | Token invalid, expired, wrong signature, wrong issuer, wrong audience, wrong tenant | `{ "message": "..." }` |
| `403` | Token **valid**, but no employee has that email | `{ "message": "No employee record for <email>" }` |

**Keep 401 and 403 distinct.** A 401 is a broken integration; a 403 is a real person
missing from the HR directory. The bot says something different for each, and that
difference is the entire support conversation.

**Log every 403 with the email.** A cluster of them means the HR directory has drifted
from Entra — a joiner not yet added, or someone whose address changed. It is the only
early warning either system gets.

---

## Validating the token — the security boundary

A JWT is base64, **not** a secret. Anyone can hand-write one claiming to be the CEO.
The endpoint must **verify**, never merely decode.

### Exact values

```
JWKS URI    https://login.microsoftonline.com/156a3c5b-d91e-4c1e-a519-1155bc2ff675/discovery/v2.0/keys
Issuer      https://login.microsoftonline.com/156a3c5b-d91e-4c1e-a519-1155bc2ff675/v2.0
Audience    api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d
Tenant      156a3c5b-d91e-4c1e-a519-1155bc2ff675
Algorithm   RS256
```

### Checks, all required

| # | Check | Why |
|---|---|---|
| 1 | **Signature** against the JWKS above | Proves Entra minted it |
| 2 | **`iss`** equals the issuer above | Proves it came from our tenant's authority |
| 3 | **`aud`** equals the audience above | Proves it was minted *for HR Genie* |
| 4 | **`tid`** equals the tenant above | Belt and braces alongside `iss` |
| 5 | **`exp` / `nbf`** current | Not expired, not future-dated |
| 6 | **`scp`** contains `access_as_user` | Proves it came through the intended scope |

**Check 3 is the one that is easy to skip and expensive to skip.** Without it, a token
minted for *any* application in the tenant is accepted here — so any other app's token
becomes a valid HR Genie login for whoever holds it.

> ⚠️ **`156a3c5b-…` is the `infinitylearn.com` tenant.** `rankguru.com` is a **separate**
> Entra directory (`50eba315-1b8e-4f1d-b407-efcdb884200e`) and its tokens must be
> rejected. Confirm at any time:
> ```bash
> curl https://login.microsoftonline.com/infinitylearn.com/v2.0/.well-known/openid-configuration
> ```

### A note on `aud`

Entra may present the audience either as the App ID URI or as the bare client ID,
depending on how the resource was requested. Accepting both is reasonable; accepting
anything else is not.

```
api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d     ← expected
7c9867c8-3ab2-49c0-99e7-6794fea7ee9d                 ← also acceptable
```

Put both in config, reject everything else. **Never** use a wildcard or a
`startsWith`.

---

## Reading the identity

Take the email from `preferred_username`, falling back to `upn`, then `email`:

```ts
const email = claims.preferred_username ?? claims.upn ?? claims.email
```

Then join to the existing employee record:

```
Entra email  →  employee.officialEmail  →  employeeId
```

**The join already exists.** Every employee record carries `officialEmail`, and every
employee signs into Teams as that same `@infinitylearn.com` address. No new column, no
new table, no migration.

**Compare case-insensitively.** Entra does not preserve case in these claims, and HR
records will not match otherwise. This is the single most likely cause of a spurious
403 in testing.

---

## Reference implementation (NestJS)

Using [`jose`](https://github.com/panva/jose) — no native dependencies, caches and
rotates JWKS automatically.

```bash
npm install jose
```

### `teams-token.service.ts`

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const TENANT = '156a3c5b-d91e-4c1e-a519-1155bc2ff675'
const BOT_APP_ID = '7c9867c8-3ab2-49c0-99e7-6794fea7ee9d'

const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`
const AUDIENCES = [`api://botid-${BOT_APP_ID}`, BOT_APP_ID]

/**
 * Cached across requests on purpose: it fetches Entra's signing keys once and
 * refreshes them on rotation. Constructing it per request would hammer Microsoft
 * and get rate-limited.
 */
const jwks = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`),
)

export interface TeamsIdentity {
  email: string
  name?: string
  objectId?: string
}

@Injectable()
export class TeamsTokenService {
  async verify(token: string): Promise<TeamsIdentity> {
    let payload: JWTPayload
    try {
      // Verifies signature, issuer, audience, exp and nbf in one call.
      ;({ payload } = await jwtVerify(token, jwks, {
        issuer: ISSUER,
        audience: AUDIENCES,
        algorithms: ['RS256'],
        clockTolerance: 60,
      }))
    } catch (error) {
      throw new UnauthorizedException(`Teams token failed validation: ${error.message}`)
    }

    if (payload.tid !== TENANT) {
      throw new UnauthorizedException('Token is from a different Entra tenant')
    }

    const scopes = String(payload.scp ?? '').split(' ')
    if (!scopes.includes('access_as_user')) {
      throw new UnauthorizedException('Token does not carry the access_as_user scope')
    }

    const email =
      (payload.preferred_username as string) ??
      (payload.upn as string) ??
      (payload.email as string)

    if (!email) {
      throw new UnauthorizedException('Token carries no email claim')
    }

    return {
      email: email.toLowerCase(),
      name: payload.name as string | undefined,
      objectId: payload.oid as string | undefined,
    }
  }
}
```

### `auth.controller.ts`

```ts
@Post('teams')
@HttpCode(200)
async teams(@Body() body: { token?: string }) {
  if (!body?.token) {
    throw new BadRequestException('token is required')
  }

  const identity = await this.teamsTokens.verify(body.token)

  // Case-insensitive on purpose — Entra does not preserve case.
  const employee = await this.employees.findByOfficialEmail(identity.email)

  if (!employee) {
    this.logger.warn(`Teams sign-in with no employee record: ${identity.email}`)
    throw new ForbiddenException(`No employee record for ${identity.email}`)
  }

  // Reuse whatever /api/auth/login already issues. Do not invent a second token type.
  const token = await this.auth.issueToken(employee)

  return { token, employee: this.auth.toEmployeeDto(employee) }
}
```

### The lookup

```ts
findByOfficialEmail(email: string) {
  return this.repo
    .createQueryBuilder('e')
    .where('LOWER(e.officialEmail) = LOWER(:email)', { email })
    .getOne()
}
```

Index `officialEmail` if it isn't already — this runs on every cold sign-in.

---

## Testing without Teams

You do not need the bot, Teams, or a real token to build this.

**1. Malformed token — expect 401**

```bash
curl -i -X POST https://hrgenie-api.devinfinitylearn.in/api/auth/teams \
  -H 'Content-Type: application/json' \
  -d '{"token":"not-a-jwt"}'
```

**2. Well-formed but unsigned token — expect 401, not 200**

Mint one at [jwt.io](https://jwt.io) with the right `iss`, `aud` and a fake signature.
**If this returns 200, verification is not actually running** — that is the bug this
test exists to catch.

**3. Missing body — expect 400**

```bash
curl -i -X POST https://hrgenie-api.devinfinitylearn.in/api/auth/teams \
  -H 'Content-Type: application/json' -d '{}'
```

**4. Real token — end to end.** Tell us when the endpoint is deployed and we will run a
real Teams sign-in against it within minutes. Our side is already built, tested and
waiting; we have 8 automated tests asserting this exact contract over a real socket.

---

## Check this before you start

**Confirm `officialEmail` matches the Teams sign-in for a handful of real people** —
ideally someone who joined recently and someone who has changed their name.

If HR records hold anything other than the `@infinitylearn.com` address people sign
into Teams with, this whole design needs a mapping rule instead. That is far cheaper to
discover now than at integration.

```sql
SELECT employeeId, officialEmail FROM employees
WHERE officialEmail IS NULL
   OR officialEmail NOT LIKE '%@infinitylearn.com'
LIMIT 50;
```

Anything this returns is a person who will get a **403** on their first Teams sign-in.

---

## What this unlocks

- The shared password comes out of the bot's config entirely — no credential to rotate,
  nothing to leak from an image.
- Every user is themselves, which is what makes an organisation-wide rollout safe rather
  than merely tidier.
- Mood notes become genuinely private to the person who wrote them.
- The app can be published to the org catalog. Until this ships it stays sideloaded to
  one person.

---

## Checklist

- [ ] `jose` installed
- [ ] `TeamsTokenService` verifying signature, `iss`, `aud`, `tid`, `exp`, `scp`
- [ ] `POST /api/auth/teams` returning `{ token, employee }`
- [ ] Case-insensitive `officialEmail` lookup, column indexed
- [ ] 401 vs 403 distinct, 403s logged with the email
- [ ] Unsigned-token test returns 401, not 200
- [ ] `officialEmail` audit query run, gaps reported
- [ ] Deployed — then tell us and we test end to end
