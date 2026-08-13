# HR Genie SSO — configuration script for the IT administrator

**Everything in this document is performed by the IT administrator.** The developer
(`Praveen.Reddy@infinitylearn.com`) sits alongside to verify each step and receives two
non-secret values at the end. Nothing is owned by, or depends on, an individual
developer account.

Expect **45–60 minutes**. Steps run in the order given — later steps consume values
produced by earlier ones.

> Supersedes the Azure section of [IT_REQUEST.md](IT_REQUEST.md), which says the Azure
> item is "no longer needed". That was true while the bot was only being *tested*. SSO
> requires an Azure Bot resource: the OAuth connection that performs the token exchange
> exists nowhere else.

---

## What this achieves

Employees are already signed into Teams. SSO lets the bot receive a token from Entra
proving who the employee is, so it serves that person's own HR records.

Without it, the bot authenticates to the HR backend as **one shared account**, and
everybody who installs it reads that one person's records. That is why the app is
currently restricted to a single tester, and why this work gates any wider rollout.

**No Microsoft Graph permissions are requested.** SSO is used solely to learn the
signed-in user's email address. No mail, files, calendar, chats or directory access.

---

## Before you start

### Roles the administrator needs

| Role | For |
|---|---|
| **Teams Administrator** | Part E — sideloading policy |
| **Application Administrator** or **Cloud Application Administrator** | Parts B and D — app registration, consent |
| **Contributor** on an Azure subscription | Part A — creating the Azure Bot |

### Reference values

None of these are secret.

```
Tenant (infinitylearn.com)   156a3c5b-d91e-4c1e-a519-1155bc2ff675
Existing bot / app ID        7c9867c8-3ab2-49c0-99e7-6794fea7ee9d
Application ID URI           api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d
Redirect URI                 https://token.botframework.com/.auth/web/redirect
Messaging endpoint           https://dw9fm7wf-3978.inc1.devtunnels.ms/api/messages
Scope to expose              access_as_user
```

Teams' own client IDs, published by Microsoft and identical in every tenant:

```
1fec8e78-bce4-4aaf-ab1b-5451cc387264    Teams desktop and mobile
5e3ce6c0-2b1f-4285-8d4b-75ee78787346    Teams web
```

> ⚠️ **Tenant check.** This is the `infinitylearn.com` directory, **not**
> `rankguru.com` (`50eba315-1b8e-4f1d-b407-efcdb884200e`), which is separate and was
> used for the Windows app. Employees sign into Teams with `@infinitylearn.com`, so
> work done in the other directory authenticates nobody. Confirm the directory name in
> the top-right of every portal before typing.

---

## Decision before you begin

An app registration already exists, created through the Teams Developer Portal:
`7c9867c8-3ab2-49c0-99e7-6794fea7ee9d`.

An Entra app registration is a **tenant object** — it belongs to the directory, not to
the person who created it. It does not leave when they do. Ownership is a separate
property and is fixed in **B1** by adding administrator owners.

| Option | Consequence |
|---|---|
| **Reuse it — recommended** | Ownership corrected in B1. Bot ID unchanged, so the installed Teams app keeps working and nothing is reinstalled. |
| **Create a fresh registration** | Cleanest paper trail, but the bot ID changes: the developer must reconfigure and repackage, and every tester reinstalls the app. Adds ~10 minutes. |

Reuse is recommended. Tell the developer which was chosen — it changes what happens
afterwards. If a fresh registration is created, **every `7c9867c8-…` below becomes the
new ID**.

---

## Part A — Azure: the Bot resource

The OAuth connection lives on this resource. Without it there is no SSO.

### A1. Resource group

[portal.azure.com](https://portal.azure.com) → **Resource groups** → **+ Create**.

| Field | Value |
|---|---|
| Subscription | A **company** subscription — never a personal one |
| Name | `rg-hrgenie-bot` |
| Region | Any; `Central India` is fine |

### A2. Grant access through a group, not a person

Create or choose a security group — for example `HR Genie Engineers` — and add the
developer to it.

On `rg-hrgenie-bot` → **Access control (IAM)** → **+ Add role assignment**:

| Field | Value |
|---|---|
| Role | **Contributor** |
| Assign access to | **User, group, or service principal** |
| Member | The `HR Genie Engineers` **group** |

Assigning the role to the group rather than the individual is what makes offboarding a
group-membership change instead of a permissions archaeology exercise.

**✅ Verify:** the role assignment lists the group, not a person.

### A3. Create the Azure Bot

**Create a resource** → search **Azure Bot** → **Create**.

| Field | Value |
|---|---|
| Bot handle | `hrgenie-bot` (any unused name) |
| Subscription / Resource group | As created in A1 |
| Pricing tier | **F0 — Free** |
| Type of App | **Single Tenant** |
| Creation type | **Use existing app registration** |
| App ID | `7c9867c8-3ab2-49c0-99e7-6794fea7ee9d` |
| App tenant ID | `156a3c5b-d91e-4c1e-a519-1155bc2ff675` |

> ### If Azure rejects the app ID as already registered
>
> The Developer Portal registration owns it. Either:
>
> **A — preferred.** At [dev.teams.microsoft.com](https://dev.teams.microsoft.com) →
> **Tools** → **Bot management**, delete the bot entry for `7c9867c8-…`, then retry.
> The Entra app registration is a **different object** and is unaffected — do not delete
> that.
>
> **B — fallback.** Create the Azure Bot with a **new** app registration. The bot ID
> changes; see the decision table above.

### A4. Endpoint and channel

On the new resource:

- **Settings → Configuration** → Messaging endpoint:
  `https://dw9fm7wf-3978.inc1.devtunnels.ms/api/messages`
- **Channels** → **Microsoft Teams** → enable if not already on.

**✅ Verify:** the resource shows the app ID above, and the Teams channel is listed as
running.

---

## Part B — Entra: the app registration

[entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → **All
applications** → search `7c9867c8`.

> Search **All applications**, not *Owned applications* — a Developer Portal
> registration is not owned by the administrator until B1 is done.

### B1. Owners — do this first

**Owners** → **+ Add owners**. Add:

- the IT administrator performing this work,
- a second administrator or a shared/service account,
- the developer, so routine changes do not require a ticket.

**Three or more owners, always.** Entra app registrations cannot be owned by a group,
which is precisely why several named owners are needed. This is the step that makes the
object independent of any one person.

**✅ Verify:** the Owners list shows at least three accounts.

### B2. Application ID URI

**Expose an API** → beside *Application ID URI*, **Add** → **Edit**.

The portal pre-fills `api://7c9867c8-3ab2-49c0-99e7-6794fea7ee9d`. **Replace it** with:

```
api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d
```

The `botid-` prefix is what Microsoft specifies for a standalone bot. The pre-filled
form does not work, and the failure appears much later as a silent token-exchange error
pointing nowhere near this screen. Check the spelling now.

### B3. Add the scope

**Expose an API** → **+ Add a scope**.

| Field | Value |
|---|---|
| Scope name | `access_as_user` |
| Who can consent | **Admins and users** |
| Admin consent display name | `Access HR Genie as the signed-in user` |
| Admin consent description | `Allows HR Genie to read the signed-in employee's identity so it can act as them.` |
| User consent display name | `Access HR Genie as you` |
| User consent description | `Allows HR Genie to act as you when you use it in Teams.` |
| State | **Enabled** |

### B4. Pre-authorise the Teams clients

**+ Add a client application**, twice — once per ID, each ticking the `access_as_user`
scope:

```
1fec8e78-bce4-4aaf-ab1b-5451cc387264
5e3ce6c0-2b1f-4285-8d4b-75ee78787346
```

Omitting these is the usual cause of every employee being shown an individual consent
dialog, which is the thing SSO exists to remove.

### B5. Redirect URI

**Authentication** → **+ Add a platform** → **Web** → Redirect URI:

```
https://token.botframework.com/.auth/web/redirect
```

This is Microsoft's token service, not our server. Leave the implicit-grant checkboxes
alone.

### B6. Token version

**Manifest** → set `requestedAccessTokenVersion` to `2` → **Save**. If it reads `null`,
change it to `2`.

### B7. Client secret

**Certificates & secrets** → **+ New client secret**.

| Field | Value |
|---|---|
| Description | `HR Genie bot — OAuth connection` |
| Expires | **24 months** (or 12) |

**The value is displayed once and cannot be retrieved afterwards.**

- Copy it now and keep the tab open — it is typed into **C1** in a few minutes.
- Store it in the company password manager or Key Vault.
- **Do not send it to the developer.** It is not needed and should not be shared.
- Record the expiry date and set a **team-owned** calendar reminder two weeks before it.
  An expired secret stops the bot dead, months later, with no warning.

**✅ Verify:** Expose an API shows the `api://botid-…` URI, one enabled scope, and two
authorised client applications.

---

## Part C — the OAuth connection

Back on the Azure Bot resource → **Settings → Configuration** → **Add OAuth Connection
Settings**.

### C1. Fill it in

| Field | Value |
|---|---|
| **Name** | `hrgenie-sso` |
| Service Provider | **Azure Active Directory v2** |
| Client id | `7c9867c8-3ab2-49c0-99e7-6794fea7ee9d` |
| Client secret | *the value from B7* |
| **Token Exchange URL** | `api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d` |
| Tenant ID | `156a3c5b-d91e-4c1e-a519-1155bc2ff675` |
| **Scopes** | `api://botid-7c9867c8-3ab2-49c0-99e7-6794fea7ee9d/access_as_user` |

Three fields carry the risk:

- **Name** — record it exactly, capitalisation included. This is one of the two values
  handed to the developer.
- **Token Exchange URL** — the field that makes sign-in *silent*. Left empty, SSO still
  functions but every employee first sees a **Sign in** button. It must match the
  Application ID URI from B2 character for character.
- **Scopes** — must name **our own API**, not bare OIDC scopes. Configured as
  `openid profile email offline_access` this appears to work — Test Connection passes —
  but the token that comes back is minted for **Microsoft Graph**, which no third party
  can validate. The backend then rejects every sign-in with *"signature verification
  failed"*, and nothing on this screen suggests why. Cost us an hour on 13 August 2026.

### C2. Test it

Save, reopen the connection, click **Test Connection**.

**✅ This must pass before continuing.** If it fails here it will fail in Teams, and the
error on this page is far more diagnostic than anything visible later. See
Troubleshooting.

---

## Part D — admin consent

App registration → **API permissions** → **Grant admin consent for Varsity Education
Management Pvt Ltd** → **Yes**.

**✅ Verify:** every row under *Status* reads **Granted for …**.

Without this, each employee sees a consent prompt on first use. It still works — it just
is not seamless.

---

## Part E — Teams: sideloading policy

Independent of A–D; can be done at any point.

**Likely already in place** — the app is currently installed and working. Ask the
developer to check: Teams → **Apps** → **Manage your apps** → **Upload an app**. If
*Upload a custom app* appears, this part is complete.

If only *Submit an app to your org* appears, at
[admin.teams.microsoft.com](https://admin.teams.microsoft.com):

| Where | Setting | Value |
|---|---|---|
| Teams apps → **Manage apps** → Org-wide app settings | *Allow interaction with custom apps* | **On** |
| Teams apps → **App setup policies** → **+ Add** | *Upload custom apps* | **On** |

Assign the new policy to `Praveen.Reddy@infinitylearn.com` only — not the Global policy,
which would grant it to every employee.

> Policy changes take **up to 24 hours** to apply.

---

## Part F — hand back

Send the developer these two values:

```
SSO_CONNECTION_NAME = hrgenie-sso
App registration    = reused 7c9867c8-…   (or the new ID, if one was created)
```

**Do not send the client secret.** It stays in Azure and the password manager.

The developer then configures the connection name, restarts the bot, repackages the
Teams app — SSO is only declared in the manifest once configured — and reinstalls it to
confirm a real sign-in.

---

## What this does not finish

**This configuration delivers the employee's verified identity to the bot. It does not
complete login.**

The HR Genie backend must accept that identity. `POST /api/auth/teams` currently returns
**404** on the live service. It has to validate the Entra token against Microsoft's
public keys, map the verified email to an employee record, and return a session. That is
the backend team's work, specified in [TEAMS_SSO_BACKEND.md](TEAMS_SSO_BACKEND.md), and
it proceeds in parallel with this. Neither half alone produces a working login.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Backend rejects every token: *"signature verification failed"* | Connection **Scopes** name OIDC scopes, so the exchange returns a **Graph** token | C1 — Scopes must be `api://botid-<appid>/access_as_user`. Test Connection passes either way, so it does not catch this |
| Test Connection fails, `AADSTS650057` | Application ID URI wrong | B2 — must be `api://botid-<appid>` |
| Test Connection fails, `invalid_client` | Wrong or expired secret | New secret (B7), re-enter in C1 |
| Employees see a **Sign in** button | Token Exchange URL empty or mismatched | C1 — must equal the App ID URI exactly |
| Each employee gets a consent prompt | Teams client IDs not pre-authorised, or no admin consent | B4 and D |
| Bot answers as the wrong employee | SSO not active; still the shared account | Connection name not configured, or package predates SSO |
| `Cannot POST /api/auth/teams` | Backend endpoint not built | Not an IT issue — backend team |
| Azure will not accept the app ID | Developer Portal owns the registration | A3 — path A or B |

---

## Not being requested

- **No Microsoft Graph permissions.** None at all.
- **No publishing to the organisation app catalog.** The app stays sideloaded to one
  account until this and the backend work are complete. A future pilot would be scoped
  to a named security group, not the whole organisation.
- **No preinstalling or pinning** for users.
- **No access in the `rankguru.com` tenant.**
- **No cost.** Azure Bot F0 is free and covers 10,000 messages a month including the
  Teams channel.

---

## Checklist

- [ ] A1 — resource group in a **company** subscription
- [ ] A2 — Contributor assigned to a **security group**, not a person
- [ ] A3 — Azure Bot created, F0, Single Tenant, existing app ID
- [ ] A4 — messaging endpoint set, Teams channel on
- [ ] B1 — **three or more owners** on the app registration
- [ ] B2 — App ID URI is `api://botid-7c9867c8-…`
- [ ] B3 — `access_as_user` scope, enabled
- [ ] B4 — both Teams client IDs pre-authorised
- [ ] B5 — redirect URI added
- [ ] B6 — `requestedAccessTokenVersion` is `2`
- [ ] B7 — secret created, stored in password manager, expiry diarised
- [ ] C1 — OAuth connection saved
- [ ] C2 — **Test Connection passed**
- [ ] D — admin consent granted
- [ ] E — *Upload a custom app* visible to the developer
- [ ] F — connection name and app ID sent to the developer
