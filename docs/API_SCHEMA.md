# HR Genie — data schemas & API contract

Handoff for the backend team.

The Android app is feature-complete against **local storage** (`SharedPreferences`),
which is deliberately shaped like a REST API so the swap is mechanical. This document
lists (1) every entity the app already reads and writes, (2) the endpoints we need to
replace local storage with, and (3) the one live integration that already exists.

**Everything is keyed by `employeeId`.** There is no separate user id, no auth token
yet, and no server-side session.

---

## 0. Conventions

| Thing | Format | Example |
|---|---|---|
| Date | ISO-8601 date, no time | `2026-08-07` |
| Timestamp | epoch millis, UTC (`Long`) | `1754500000000` |
| Pulse cycle | `yyyy-MM` | `2026-08` |
| Ticket id | `HRG-%04d` | `HRG-0001` |
| Employee id | free string, case-insensitive | `EMP3801`, `HYD609552`, `HR000` |

- All enum values travel as the **uppercase constant name**, not the display label.
- Timezone: the client uses device local time for "today". Server should store UTC
  millis and return ISO dates already resolved to the employee's location.

---

## 1. Employee

Currently a hardcoded directory in the app (5 records). Needs to come from the HRMS.

```json
{
  "employeeId": "EMP3801",
  "name": "Gunapati Praveen Reddy",
  "title": "Tech Lead-2-Software Engineering",
  "department": "Experience",
  "gender": "Male",
  "bloodGroup": "O+",
  "mobile": "9000000000",
  "dateOfJoining": "2025-10-27",
  "officialEmail": "praveen.reddy@example.com",
  "dateOfBirth": "1994-01-01",
  "personalEmail": "praveen@example.com",
  "maritalStatus": "Married",
  "orgUnit": "RANKGURU TECHNOLOGY SOLUTIONS PRIVATE LIMITED>Learn 2.0>Technology>Experience",
  "reportees": 0,
  "isHr": false
}
```

**Client-side rules the server should own instead:**

- `isHr` — the app currently infers this from an `employeeId` starting with `HR`.
  **Please return an explicit role field.** The prefix rule is a demo shortcut.
  Suggested: `"role": "EMPLOYEE" | "HR"`.
- `orgUnit` is `>`-delimited, deepest last. The app doesn't parse it, only displays it.
- `reportees` drives a "manager" badge only.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | `{ employeeId, password }` → employee + token. **Not built yet** — the app has no password check at all today. |
| `GET` | `/api/employees/me` | The signed-in employee |
| `GET` | `/api/employees` | Directory. HR only — used for the dashboard roll-up. |

---

## 2. Ticket

**Fully implemented locally.** This is the piece most worth moving to the server first,
because two users (employee + HR) act on the same record.

```json
{
  "id": "HRG-0001",
  "employeeId": "EMP3801",
  "subject": "My salary got deducted",
  "category": "Payroll",
  "status": "OPEN",
  "createdAtMillis": 1754500000000,
  "updatedAtMillis": 1754503600000,
  "comments": [
    {
      "status": "RESOLVED",
      "text": "Deduction reversed in the August run.",
      "authorId": "HR000",
      "atMillis": 1754503600000
    }
  ]
}
```

**`status`** — `OPEN` | `IN_PROGRESS` | `RESOLVED`
(display labels: "Open", "In progress", "Resolved")

**`category`** — one of: `Payroll`, `Leave`, `IT & access`, `Insurance`,
`Facilities`, `Something else`. Currently a client constant; fine to serve from the
server so it can grow.

### Business rules (must be enforced server-side, not just in the app)

1. **Resolving requires a comment.** A `PATCH` to `RESOLVED` with an empty/blank
   comment must be rejected. The app enforces this in the store *and* the UI, but the
   server is the real authority. Suggested: `422` with
   `{ "error": "COMMENT_REQUIRED" }`.
2. `OPEN` and `IN_PROGRESS` transitions accept an optional comment.
3. Only HR may change status. Employees are read-only on their own tickets.
4. A comment is only appended when non-blank — no empty rows in the trail.

### Unread tracking

The app keeps a local map of `ticketId → last status the employee was shown`, so chat
can announce *"HR has closed HRG-0001"* exactly once. Server equivalent:

```json
{ "ticketId": "HRG-0001", "lastSeenStatus": "OPEN" }
```

Raising a ticket marks it seen immediately (the employee watched it happen), so their
own action never announces back at them.

### Endpoints

| Method | Path | Body / notes |
|---|---|---|
| `GET` | `/api/tickets?employeeId=` | Employee's own. Newest first. |
| `GET` | `/api/tickets` | All. **HR only.** Newest first. |
| `POST` | `/api/tickets` | `{ employeeId, subject, category }` → created ticket. Server assigns `id`, sets `status: OPEN`, both timestamps. |
| `PATCH` | `/api/tickets/{id}/status` | `{ status, comment, authorId }`. Enforce rule 1. |
| `GET` | `/api/tickets/unseen?employeeId=` | Tickets whose status moved since last seen |
| `POST` | `/api/tickets/seen` | `{ employeeId }` — mark all current statuses seen |

---

## 3. Mood check-in

One per employee per day.

```json
{
  "employeeId": "EMP3801",
  "dateIso": "2026-08-07",
  "mood": "OKAY",
  "reasons": ["Workload", "Deadlines"],
  "note": "Release week is heavy."
}
```

**`mood`** — `GREAT` | `GOOD` | `OKAY` | `STRESSED` | `BURNT_OUT`

Each maps to a 0–10 `trendValue` used for the engagement score:

| Key | Label | trendValue |
|---|---|---|
| `GREAT` | Great | 9 |
| `GOOD` | Good | 8 |
| `OKAY` | Okay | 6 |
| `STRESSED` | Stressed | 4 |
| `BURNT_OUT` | Burnt out | 3 |

**`reasons`** — zero or more of: `Workload`, `Deadlines`, `My manager`, `My team`,
`Recognition`, `Clarity on goals`, `Work–life balance`, `Something outside work`.
(Note the en-dash in "Work–life balance".)

### ⚠️ Privacy rule — please implement this on the server

`note` is **free text the employee is told stays private.** The app's HR view
deliberately never returns or displays it — HR sees the mood and the `reasons` tags
only. Any HR-facing endpoint must omit `note` from its response payload entirely,
rather than relying on the client not to render it.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/mood?employeeId=&date=` | Today's entry, or 404 |
| `POST` | `/api/mood` | Upsert for that employee + date |
| `GET` | `/api/hr/mood?date=` | **HR only. Must exclude `note`.** |

---

## 4. Monthly pulse

One per employee per `yyyy-MM` cycle.

```json
{
  "employeeId": "EMP3801",
  "cycle": "2026-08",
  "completedAtMillis": 1754500000000,
  "answers": {
    "experience": "Mostly fine",
    "workload": "Stretched",
    "manager": "Usually"
  }
}
```

- `answers` is `questionId → chosen option`. **A skipped question is absent from the
  map**, not present with a null/empty value.
- HR *can* see these answers against the employee's name (a product decision — the app
  copy now tells employees so explicitly).

### Question bank

Currently client-side; serve it so it can change without an app release.

| id | question | options |
|---|---|---|
| `experience` | How has your work experience been this month? | Genuinely good / Mostly fine / Up and down / Rough, honestly |
| `workload` | Is your workload manageable right now? | Comfortable / Busy but okay / Stretched / Not sustainable |
| `manager` | Do you feel supported by your manager? | Always / Usually / Sometimes / Rarely |
| `attrition` | Have you thought about looking elsewhere recently? | Not at all / Passing thought / Somewhat / Actively looking |

### Endpoints

| Method | Path |
|---|---|
| `GET` | `/api/pulse/questions` |
| `GET` | `/api/pulse?employeeId=&cycle=` |
| `POST` | `/api/pulse` |
| `GET` | `/api/hr/pulse?cycle=` (HR only) |

---

## 5. Attendance

One record per employee per day.

```json
{
  "employeeId": "EMP3801",
  "dateIso": "2026-08-07",
  "checkInMillis": 1754530000000,
  "checkOutMillis": null
}
```

`checkOutMillis: null` means still on the clock.

### Derived status — the client computes this today; server should own it

| Status | Code | Rule |
|---|---|---|
| `PRESENT` | P | Worked ≥ 8h |
| `HALF_DAY` | HD | Checked out under 8h |
| `MIS_PUNCH` | MIS | Checked in, never checked out, **and the day has ended** |
| `ABSENT` | A | No record and the date has passed |
| `WEEK_OFF` | WO | Saturday / Sunday |
| `HOLIDAY` | H | Matches the holiday calendar |
| `IN_PROGRESS` | IN | Today, still on the clock |
| `PENDING` | `--` | Today before check-in, or a future date |

**Constants:** full day = **8h**, full week = **40h** (5 × 8h).

**The day-end rule:** an open shift is capped at **23:59:59.999 of the check-in date**.
Worked time never runs past midnight, and after that point the shift becomes a
`MIS_PUNCH`. This matters for the hours roll-up — please match it exactly.

**Week:** Monday-first, 7 days.

### Regularisation

Employees can flag `MIS_PUNCH` / `ABSENT` days for correction. Currently just a stored
set of dates with no workflow behind it.

```json
{ "employeeId": "EMP3801", "dates": ["2026-08-04", "2026-08-05"] }
```

### Endpoints

| Method | Path |
|---|---|
| `GET` | `/api/attendance?employeeId=&from=&to=` |
| `POST` | `/api/attendance/check-in` |
| `POST` | `/api/attendance/check-out` |
| `POST` | `/api/attendance/regularize` |
| `GET` | `/api/hr/attendance?from=&to=` (HR only) |

---

## 6. HR dashboard aggregate

The app currently computes this on-device from the four stores above. A single
server-side endpoint would remove a lot of client work.

`GET /api/hr/stats?date=&cycle=` →

```json
{
  "headcount": 4,
  "checkedInToday": 2,
  "onTheClock": 1,
  "moodResponsesToday": 2,
  "engagementScore": 7.0,
  "moodBreakdown": { "GREAT": 0, "GOOD": 1, "OKAY": 1, "STRESSED": 0, "BURNT_OUT": 0 },
  "pulseCompleted": 1,
  "departments": [
    { "name": "Experience", "headcount": 2, "responses": 1, "score": 6.0 }
  ],
  "weekPresent": 6,
  "weekHalfDays": 1,
  "weekMisPunches": 0,
  "weekAbsences": 1,
  "weekHoursMillis": 66000000,
  "ticketsOpen": 2,
  "ticketsInProgress": 1,
  "ticketsResolved": 3
}
```

- `engagementScore` = mean `trendValue` of **today's** mood entries. **`null` when
  nobody has checked in** — the app renders "—" rather than 0.
- `departments[].score` = same mean within a department, `null` when no responses.
- **HR accounts are excluded from every figure.** They are not their own subject.
  Headcount here is 4, not 5.
- **Cohort minimum is 5.** Below that the app refuses to show attention signals at
  all. Keep this on the server for anything it aggregates.

---

## 7. Holiday calendar

Static list, currently client-side.

```json
{
  "name": "Independence Day",
  "isoDate": "2026-08-15",
  "dateLabel": "Sat, 15 Aug",
  "monthLabel": "August"
}
```

`dateLabel` / `monthLabel` are pre-formatted for display; the client can derive them
from `isoDate` if you'd rather only send that.

`GET /api/holidays?year=2026`

---

## 8. Knowledge base — ALREADY INTEGRATED ✅

This one is live in the app and working against your endpoint. **No change needed** —
documented so the contract is on record.

`POST {BASE_URL}/api/kb/query`

**Request**

```json
{
  "question": "What are the different types of leaves?",
  "maxResults": 1,
  "knowledgeBase": "default",
  "modelId": "amazon.nova-lite-v1:0"
}
```

Headers: `Content-Type: application/json`, `accept: */*`,
`ngrok-skip-browser-warning: true`.

**Response** (only `answer` and `sources[].documentTitle` are consumed today)

```json
{
  "knowledgeBaseId": "SSEP6FMBAJ",
  "modelId": "amazon.nova-lite-v1:0",
  "question": "What are the different types of leaves?",
  "answer": "Based on the provided policy excerpts...",
  "sources": [
    {
      "documentTitle": "Leave_Policy_1786077681487.pdf",
      "sourceUri": "https://il-policy-bucket.s3.us-west-2.amazonaws.com/Leave_Policy_1786077681487.pdf",
      "score": 0.5964640378952026,
      "excerpt": "1. Purpose To provide employees with a break from work..."
    }
  ]
}
```

**Client behaviour worth knowing:**

- `answer` is rendered as markdown — `**bold**` and `- ` bullets are the only syntax
  handled. Anything else shows literally.
- Only the highest-`score` source is credited under the answer.
- Timeouts: 10s connect, 45s read. One automatic retry on transport failure.
- **Please return a proper HTTP status on failure.** The current failure mode is the
  connection dying with no status line at all, which the client can only report as
  "nothing came back". A `5xx` with a JSON error body would let us show something
  specific.

---

## 8b. Push notifications (FCM) — CLIENT DONE & VERIFIED, SERVER NEEDED ⚠️

> **Full spec: [PUSH_BACKEND.md](PUSH_BACKEND.md)** — credentials, endpoint, error
> handling and copy-paste Java/Node implementations. This section is the summary.

Firebase project: **IL HR Genie** (`il-hr-genie`). The Android client is complete and
verified on a real device: it registers a token, receives the message, posts the
notification and routes the tap to the ticket.

**The send half has to be the backend.** A phone cannot push to another phone — FCM's
HTTP v1 API needs the service-account key, which must never ship in an app. So
"HR resolves → employee is notified" only works once the server does the sending.

### 1. Store the device token

`POST /api/devices`

```json
{ "employeeId": "EMP3801", "token": "fcm-token…", "platform": "android" }
```

The app calls this at sign-in (currently logged, not sent — see `SignInFragment`).
One employee may have several devices; push to all of them. Drop a token when FCM
replies `UNREGISTERED`.

### 2. Send on status change

When `PATCH /api/tickets/{id}/status` succeeds, push to every device belonging to
`ticket.employeeId`:

```json
{
  "message": {
    "token": "…",
    "data": {
      "type": "TICKET_STATUS",
      "ticketId": "HRG-0001",
      "employeeId": "EMP3801",
      "status": "RESOLVED",
      "title": "HR closed HRG-0001",
      "body": "Deduction reversed in the August run."
    },
    "android": { "priority": "high" }
  }
}
```

**Data-only — do not include a `notification` block.** With one, Android draws the
notification itself while the app is backgrounded, the app never sees the message,
and the tap cannot be routed to the right ticket. Data-only means our service is
called in every state and builds the notification with the right deep link.

`title` and `body` are optional; the client writes sensible defaults per status if
they are absent. `body` is a good place for the resolution note — it is what the
employee actually wants to read.

`employeeId` is checked client-side: a shared demo phone signed in as someone else
drops the push rather than showing them a colleague's ticket.

All `data` values must be strings — FCM rejects numbers and booleans in that map.

### 3. Testing without the backend

Firebase Console → Cloud Messaging → **Send test message**, paste the device token
(logged at sign-in under tag `HrGeniePush`), and add the `data` keys above. That
exercises the entire client path — it is how the client half was verified.

---

## 9. What we need first

Suggested order, by how much it unblocks:

1. **Auth** — there is no password check in the app at all right now.
2. **Tickets** — the only genuinely multi-user flow; two people act on one record.
3. **Employee directory** — with an explicit `role`, replacing the `HR` prefix rule.
4. **Mood + Pulse + Attendance** — single-writer, so local storage holds up longer.
5. **HR stats** — nice-to-have; the client can keep computing it from 4.

## 10. Open questions for you

1. Auth mechanism — JWT? Session cookie? Does the HRMS already issue one?
2. Is `employeeId` the right key, or is there an internal numeric id we should use?
3. Should ticket categories and pulse questions be server-configurable?
4. Who is "HR" — a role, a specific set of ids, or an org-unit lookup?
5. Retention on mood notes and pulse answers — any policy we should enforce?
