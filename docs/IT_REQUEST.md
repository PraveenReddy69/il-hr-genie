# HR Genie for Microsoft Teams — access request

> **Working through this with an admin? Use [IT_ADMIN_RUNBOOK.md](IT_ADMIN_RUNBOOK.md)
> instead.** This document explains *what* is being asked for and why, which is what
> IT needs to approve it. The runbook is the click-by-click version for doing it.
>
> One correction: "Item 2 (Azure) is no longer needed" below holds for *testing only*.
> SSO needs an Azure Bot resource, because the OAuth connection that performs the token
> exchange exists nowhere else.

**Requested by:** `Praveen.Reddy@infinitylearn.com` — referenced throughout as
*the developer account*.

---

## What this is

An internal HR assistant for Infinity Learn employees, delivered as a Microsoft Teams
app: raise and track HR tickets, a daily check-in, and the monthly pulse. It talks to
our own HR Genie backend — the same service the HRBP console already uses. No
third-party service is involved.

**Organisation-only.** The bot is registered single-tenant: bound to our Entra tenant,
not installable by any other company, never listed in the public Teams store, and not
submitted to Microsoft for review.

Everything below is in the **infinitylearn.com** tenant:

```
Tenant ID   156a3c5b-d91e-4c1e-a519-1155bc2ff675
```

This is deliberately *not* the `rankguru.com` tenant
(`50eba315-1b8e-4f1d-b407-efcdb884200e`), which is a separate Entra directory.
Employees sign into Teams with their `@infinitylearn.com` identity, so a bot registered
in the other tenant could not authenticate any of our users.

**Cost: nil.** The Azure Bot free tier (F0) covers 10,000 messages a month and all
standard channels including Teams. No paid Azure service is required.

---

## What we have already confirmed ourselves

- **Custom app upload is NOT enabled.** Teams → Apps → Manage your apps → Upload an
  app offers only *"Submit an app to your org"*. There is no *Upload a custom app*
  option, which is the setting in item 1. This is the blocker.
- **Item 2 (Azure) is no longer needed.** The bot registration was created through the
  Teams Developer Portal instead, so no Azure subscription and no Azure portal access
  is required. Bot id `7c9867c8-3ab2-49c0-99e7-6794fea7ee9d`, endpoint configured,
  Teams channel enabled, and the registration authenticates correctly.
- **Item 3 (Entra app registration) is no longer needed** for testing — the Developer
  Portal created one. It is *multi-tenant*, so a single-tenant registration is still
  wanted before a real rollout, but nothing is blocked on it today.
- The Teams Developer Portal signs in correctly as this account under Varsity
  Education Management Pvt Ltd, so the tenant and identity are not in question.

---

## Phase 1 — enough for one developer to test

This phase makes the app visible to **one person only**. A sideloaded Teams app is
installed to that individual's own chat; it does not appear in any other employee's
Teams and is not published to the organisation's app store.

### 1. Teams admin center — allow custom app upload, for one account

Two settings. The first opens the capability for the tenant, the second controls who
has it.

| Where | Setting | Value |
|---|---|---|
| Teams apps → **Manage apps** → Org-wide app settings | Custom apps → *Allow interaction with custom apps* | **On** |
| Teams apps → **App setup policies** → new policy | *Upload custom apps* | **On** — assigned to the developer account only |

Please create a new policy assigned to that single account rather than modifying the
global policy.

### 2. Azure — somewhere to create the bot

Two possibilities, and the first is much lighter if it applies:

- **If Infinity Learn already has an Azure subscription:** a resource group (e.g.
  `rg-hrgenie-bot`) with the **Contributor** role for the developer account, scoped to
  that resource group only. No subscription-level access needed.
- **If there is no subscription:** one needs to be created. The bot itself incurs no
  charge, so a pay-as-you-go subscription with no other resources costs nothing.

### 3. Entra ID — an app registration for the bot

**Please check first whether self-service app registration is already enabled** for the
developer account — if it is, this item needs nothing from IT and we will create it
ourselves.

If it is restricted, either grant permission to register an application, or create one
and send us the values:

- **Name**: `HR Genie Bot`
- **Supported account types**: *Accounts in this organizational directory only (Single
  tenant)*

**What we need back:**

| Value | Where | Sensitive |
|---|---|---|
| Application (client) ID | Overview blade | No — an identifier |
| Directory (tenant) ID | Overview blade | No — already known, above |
| **Client secret value** | Certificates & secrets → New client secret | **Yes** |

The secret is displayed **once**, at creation, and cannot be retrieved afterwards.
Please share it via a password manager or secure file share — **not** by email or Teams
message. Please also note the expiry date so it can be rotated before it lapses; 12 or
24 months is fine.

---

## Phase 2 — required before any second person uses it

Until this is done the bot authenticates to the HR backend as a **single shared
account**, meaning anyone who installed it would read that one person's HR records.
That is precisely why Phase 1 is limited to one tester and why organisation-wide
publishing is not being requested.

Teams SSO resolves it: the employee is already signed into Teams, so the bot receives a
token from Entra proving who they are and acts as that person. No password is stored or
transmitted anywhere.

### 4. On the same app registration

| Setting | Value |
|---|---|
| Manifest → `requestedAccessTokenVersion` | `2` |
| Expose an API → Application ID URI | `api://botid-<application-client-id>` |
| Expose an API → Add a scope | `access_as_user`, consent by **Admins only** |
| Authentication → Add a platform → Web → Redirect URI | `https://token.botframework.com/.auth/web/redirect` |

The `api://botid-…` form is what Microsoft specifies for a standalone bot. The plain
`api://<app-id>` that the portal pre-fills does **not** work for this case.

### 5. Pre-authorised client applications

Under **Expose an API → Authorized client applications**, add both of the following,
each granted the `access_as_user` scope. Without them, every employee is prompted to
consent individually, which defeats the purpose of SSO:

| Client ID | Client |
|---|---|
| `1fec8e78-bce4-4aaf-ab1b-5451cc387264` | Teams desktop and mobile |
| `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` | Teams web |

These are Microsoft's published values and are identical in every tenant.

### 6. Admin consent

Grant admin consent for the application, so employees are not each shown a consent
dialog on first use.

---

## Not being requested

Stated explicitly so the scope is unambiguous:

- **Publishing to the organisation's app catalog.** Deliberately excluded. It would
  make the app discoverable by every employee, and it should not be until Phase 2 is
  complete and tested.
- **Preinstalling or pinning** the app for users.
- Any access in the `rankguru.com` tenant.
- Any Microsoft Graph permissions (see below).

When we reach a pilot, the request will be to publish with availability scoped to a
named security group — not to the whole organisation.

---

## Questions IT usually asks

**What data does the app access?**
Only what the employee types into it, plus their own HR Genie records. It reads and
writes through our existing HR Genie API, which already holds this data and already
serves the HRBP console and the mobile app.

**What Microsoft 365 or Graph data does it read?**
**None.** No Graph permissions are requested. SSO is used solely to learn the signed-in
user's identity — their email address — so the bot can act as the right employee
instead of a shared account. It does not read mail, files, calendar, chats or the
directory.

**Where is the bot hosted?**
During Phase 1, on the developer's machine behind a temporary HTTPS tunnel. For a pilot
it moves to a company-controlled host (Azure App Service or equivalent). The Azure Bot
resource only stores the messaging endpoint URL — no employee data passes through or
rests in it.

**Does data leave our control?**
Messages travel employee → Teams → Microsoft Bot Connector → our bot → our HR Genie
API. The Bot Connector is the standard Microsoft transport used by every Teams bot;
nothing is sent to any non-Microsoft third party.

**Can other organisations install it?**
No. Single-tenant registration means the bot will not authenticate outside this tenant,
even if the app package were shared externally.

**What is the cost?**
Nil for the bot (F0 free tier). Hosting for the pilot phase would be the only future
cost, and can run on an existing App Service plan.

---

## Summary

| # | Item | Owner | Blocks |
|---|---|---|---|
| 1 | Custom app upload for one account | Teams admin | Any testing in Teams |
| 2 | Resource group + Contributor (or a subscription) | Azure admin | Creating the bot |
| 3 | Entra app registration + client secret | Entra admin | Bot authentication |
| 4 | App ID URI, scope, redirect URI | Entra admin | SSO |
| 5 | Pre-authorised Teams client IDs | Entra admin | Silent SSO |
| 6 | Admin consent | Entra admin | Per-user consent prompts |

**Items 1–3 unblock testing by one developer. Items 4–6 are required before a second
person uses the app.**
