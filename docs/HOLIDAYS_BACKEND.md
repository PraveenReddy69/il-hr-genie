# Holidays — the schema, and an endpoint that would serve it

The holiday calendar is **not in the API**. All three clients — the Android app, the
HRBP console and now the Teams bot — carry the same hard-coded list. That works until
a date changes, at which point three apps have to be rebuilt and re-released to say the
same thing.

This is the shape they already agree on, and the endpoint that would replace it.

---

## The record

```jsonc
{
  "name": "Independence Day",
  "isoDate": "2026-08-15",        // yyyy-MM-dd, no time, no timezone
  "kind": "FIXED",                // FIXED | OPTIONAL
  "region": "All India"           // "All India", "Telangana", …
}
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | As published. Shown verbatim. |
| `isoDate` | string | `yyyy-MM-dd`. **A date, not a timestamp** — a holiday is a day, and sending `2026-08-15T00:00:00Z` makes it the 14th for anyone west of UTC. |
| `kind` | `FIXED` \| `OPTIONAL` | Fixed = paid holiday everyone gets. Optional = chosen by the employee from a published list. |
| `region` | string | Some optional days are state-specific. Free text today; an enum would be better if the list is fixed. |

---

## The endpoint

```
GET /api/holidays?year=2026

→ 200
{
  "year": 2026,
  "years": [2025, 2026],          // years the calendar covers
  "holidays": [ /* the records above, in date order */ ]
}
```

- **Any signed-in employee**, not HR-only. The calendar is published information; every
  client needs it and none of them should need elevated rights to read it.
- **`year` optional**, defaulting to the current one.
- **`years`** lets a client offer only years it can actually show, rather than a picker
  that leads to an empty page.
- **Sorted by date.** Every client sorts anyway; doing it once server-side is cheaper
  and means they cannot disagree.
- An unknown year should be `200` with an empty list, not `404` — "nothing published
  yet" is a normal answer.

---

## Why it is worth doing

**One source of truth.** Right now a corrected date means editing three codebases and
shipping an Android release. With this, it is a data change.

**Optional-day tracking becomes possible later.** Once the calendar is served rather
than compiled in, "which optional day did this employee take?" becomes a question the
system can answer — the bot and console could then show a personal calendar rather than
the same list for everybody. Not needed now; worth not designing it out.

---

## Until it exists

Each client ships `HOLIDAY_CALENDAR` as a literal. In the bot that is
`teams/src/holidays.ts`, copied from the console's `web/src/api/holidays.ts`, and both
match the Android list. **If a date changes, all three must be updated together** —
which is precisely the argument for the endpoint.

When it lands, the change in the bot is confined to `holidaysJson()` in `tab.ts`: fetch
instead of read. No page changes.
