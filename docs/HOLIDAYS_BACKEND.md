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

## Writing to it

The console now has an editor behind the `holidays.edit` permission — Admin and Main
Head, not HRBPs. See `docs/ACCESS_CONTROL.md`. It writes to `localStorage` today and
says so on the page, so the shapes below are already agreed and the swap is mechanical.

**Everything in this section has to be enforced on the server.** The console refuses the
same things early, but only so an Admin is told why before they type; none of it
survives a curl command.

### Add

```http
POST /api/holidays
{ "name": "Diwali", "isoDate": "2026-11-08", "kind": "FIXED", "region": "Telangana" }

→ 201  the created record
```

### Change

```http
PATCH /api/holidays/{id}
{ "name": "Deepavali" }

→ 200  the updated record
```

This needs an **id**, which the current record does not have. Date plus region is unique
and would work as a key, but it is also exactly what an edit changes — moving a holiday
by a day would be a delete and a create, and the audit trail would show it as two
unrelated events rather than one correction. A stable `id` on the record, please.

### Remove

```http
DELETE /api/holidays/{id}

→ 204
```

---

## What may not be changed

A holiday people have already taken cannot be edited or removed. Two rules:

| Case | Answer |
|---|---|
| A date in a **past year** | `409` — the year is closed |
| A date **earlier this year** | `409` — the day has passed |
| **Today** | Allowed |
| Anything ahead | Allowed |

Today is deliberately still open. The day is not over, and a correction made this
morning to this evening's entry is the case the rule has to allow — `<=` here would
refuse it.

The reason is not tidiness. Editing a holiday after the fact rewrites a leave balance
somebody has already spent, and there is no honest way to show that to the employee who
took the day. A past calendar is a record.

**Return `409` with a message, not `403`.** The caller has the right to edit holidays;
this particular one is settled. A message the console can show verbatim saves it
guessing which of the two rules was hit.

---

## Regions

`region` is free text today and that is why the console could not build a filter from
the data — one `"Telangana "` with a trailing space becomes a second option in the
dropdown that matches nothing anybody meant.

The console now offers a fixed list:

```
All India, Telangana, Andhra Pradesh, Karnataka, Tamil Nadu,
Maharashtra, Delhi NCR, West Bengal
```

Please serve it rather than have three clients keep their own copy:

```http
GET /api/holidays/regions
→ 200 { "regions": ["All India", "Telangana", ...] }
```

Validate `region` against that list on write, and reject anything else with `422`.

**One rule the filter depends on:** `"All India"` is not a region alongside the others,
it is all of them. Filtering to Telangana returns the Telangana days **and** every
national one, because that is what somebody in Hyderabad actually observes. If the
filter ever moves server-side, it has to work the same way — returning only the
state-specific handful would show a two-day calendar.

---

## Two regions, one date

A state holiday landing on a national one is normal, so the uniqueness constraint is
**(date, region)** and not the date alone. Keying on the date would reject every state
calendar the first time one overlapped.

---

## Who may do what

| | HRBP | Admin | Main Head |
|---|:--:|:--:|:--:|
| `GET /api/holidays` | yes | yes | yes |
| `POST`, `PATCH`, `DELETE` | | yes | yes |

The read stays open to **any signed-in employee**, not just HR — the app and the bot
both need it and neither should require elevated rights to show a published calendar.

Writes are `holidays.edit`. An HRBP calling one gets `403`.

---

## Until it exists

Each client ships `HOLIDAY_CALENDAR` as a literal. In the bot that is
`teams/src/holidays.ts`, copied from the console's `web/src/api/holidays.ts`, and both
match the Android list. **If a date changes, all three must be updated together** —
which is precisely the argument for the endpoint.

When it lands, the change in the bot is confined to `holidaysJson()` in `tab.ts`: fetch
instead of read. No page changes.
