# HR Genie — HRBP console

The web half of HR Genie. Employees use the Android app; HR uses this.

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

Sign in with **HR000**. There is no password check yet — the auth endpoint is still
being built, and the console refuses any account whose role is not `HR`.

## Running on mock data

With `VITE_API_BASE_URL` unset, every call is served from `src/api/mock.ts` and the
console runs with no backend at all. The mock is deliberately imperfect: mood has
gaps on days nobody answered, one department has no responses, and the current pulse
cycle is half done. A console tuned on flawless data falls apart on the first real
payload.

It is generated from a fixed seed, so a reload shows the same fortnight.

## Pointing at the backend

```bash
cp .env.example .env.local     # set VITE_API_BASE_URL
npm run dev
```

`src/api/client.ts` is the only file that talks to a server. Nothing above it knows
whether it got a mock or a response, so no page or component changes when the
backend lands. The paths it calls are exactly those in
[`../docs/API_SCHEMA.md`](../docs/API_SCHEMA.md).

Endpoints used:

| Method | Path |
|---|---|
| `POST` | `/api/auth/login` |
| `GET` | `/api/hr/stats` |
| `GET` | `/api/hr/mood?date=` |
| `GET` | `/api/hr/mood/history?days=` |
| `GET` | `/api/hr/pulse?cycle=` |
| `GET` | `/api/hr/pulse/detail?cycle=` |
| `GET` | `/api/hr/pulse/history?cycles=` |
| `GET` | `/api/tickets` |
| `PATCH` | `/api/tickets/{id}/status` |

## What is here

- **Dashboard** — engagement and pulse KPIs, today at a glance, mood breakdown,
  department sentiment, weekly attendance, attention signals. Every headline figure
  opens the people behind it.
- **Tickets** — status-mix donut, filters, and the full queue. Clicking a ticket
  opens it for a status change.
- **History** — mood day by day over a fortnight, pulse completion by month, and how
  a chosen cycle answered question by question.

## Rules the UI keeps

These are enforced here *and* must be enforced server-side — the console is a client,
not the authority.

- **Resolving a ticket requires a note.** The employee cannot ask about a closed
  request afterwards, so it has to say what was done.
- **Cohorts report at 5 or more.** Below that the attention card explains why it is
  empty rather than inventing a signal.
- **`engagementScore` is `null`, never `0`, when nobody has checked in.** The console
  renders an em dash — a zero would read as "everyone is miserable".
- **Written check-in notes are never shown.** The app promises employees that; any
  HR-facing payload must omit the field rather than rely on this client hiding it.

## Notes

- Design tokens in `src/styles.css` mirror the Android app's `colors.xml`, so the two
  look like one product.
- Chart colours are the reserved status palette, validated for colourblind
  separation, and every slice is named in the legend beside it — never colour alone.
- `npm run typecheck` before pushing; the build runs `tsc` first and will fail on a
  type error.
