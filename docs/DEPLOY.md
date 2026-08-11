# Deploying the HR console to GitHub Pages

Only `web/` is deployed. The Android app is built and installed separately.

Everything in the repo is ready; these are the steps that need your GitHub account.

---

## Before you push: what becomes public

A GitHub Pages **project site requires a public repository** unless the account is
on Pro, Team or Enterprise. On a public repo:

- **`EmployeeDirectory` and `web/src/api/mock.ts` contain four colleagues' real work
  emails and dates of birth.** That is their personal data, not yours, and pushing it
  publishes it permanently — git history keeps it even if a later commit removes it.
- The **backend address is baked into the published bundle**, and the API allows any
  origin (`Access-Control-Allow-Origin: *`), so anyone who finds the page can call it.
- Seeded accounts use the password `123456`, so anyone can sign in as any employee.

Pick one before pushing:

| | What to do |
|---|---|
| **Private repo** | Needs GitHub Pro or Team. Nothing else changes. |
| **Strip the details** | Replace the emails and dates of birth in `Employee.kt` and `mock.ts` with placeholders **before the first commit** — rewriting history afterwards is far more work. |
| **Publish only `web/`** | Push `web/` as its own repo. The console does not import anything from `app/`. |
| **Accept it** | Reasonable only if the four people have agreed. |

---

## 1. Create the repository and push

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

The workflow triggers on pushes to `main` that touch `web/`.

## 2. Point Pages at Actions

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Not "Deploy from a branch" — the workflow uploads an artifact instead.

## 3. Set the API address

**Settings → Secrets and variables → Actions → Variables → New repository variable**

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://hrgenie-api.devinfinitylearn.in` |

A **variable**, not a secret: it is compiled into the bundle and visible to anyone
who opens the page, so treating it as secret would be pretending. The build fails
with a clear message if it is missing, rather than shipping a console that cannot
reach anything.

## 4. Deploy

Push to `main`, or **Actions → Deploy HR console to GitHub Pages → Run workflow**.

The site lands at `https://<you>.github.io/<repo>/`.

---

## When the backend address changes

The address is compiled into the published bundle, so a change needs a rebuild on
both sides:

1. Update the `VITE_API_BASE_URL` variable, then **Actions → Run workflow**.
2. Update `ApiConfig.BASE_URL` in
   `app/src/main/java/com/infinitylearn/hrgenie/data/net/Api.kt` and ship a new APK.

**It must be HTTPS.** The console is served over HTTPS from Pages, and a browser will
not let an HTTPS page call a plain-HTTP API — the requests are blocked as mixed
content, with no override. The Android app has no such restriction, which is why the
two could briefly disagree; they should not be allowed to drift apart again.

The address moved several times before landing on a real one. It **must** be HTTPS:
the console is served over HTTPS from Pages, and a browser will not let an HTTPS page
call a plain-HTTP API at all.

---

## How the Pages specifics are handled

Two things break SPAs on Pages, both already dealt with:

**The site is served from `/<repo>/`, not the domain root.** The workflow passes the
repo name as `VITE_BASE_PATH`; `vite.config.ts` normalises it, and `main.tsx` gives
the same value to the router as its `basename`. Without both, either the assets or
the routes would 404.

**There is no SPA fallback.** Refreshing on `/tickets` asks Pages for a file that does
not exist. The build copies `index.html` to `404.html`, so Pages serves the app as its
404 page and the router takes over. The response carries a 404 status — that is
expected and browsers render it normally.

## Checking a build locally

```bash
cd web
VITE_BASE_PATH=/your-repo/ VITE_API_BASE_URL=https://hrgenie-api.devinfinitylearn.in npm run build
```

Serve `dist/` from a `your-repo/` subdirectory. Note that `npx http-server` does **not**
serve `404.html`, so deep links appear broken under it while working fine on Pages.
