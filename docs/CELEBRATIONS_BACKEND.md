# Celebrations — one field needed for the Wish button

`GET /api/employees/celebrations` drives the "Today at Infinity Learn" card in Teams.
It works, and the card now lists each person with their id and job title.

The one thing missing is a **work email**, and without it a feature is dark.

---

## What is needed

Add the employee's work email to each entry, in all three arrays:

```jsonc
{
  "date": "2026-08-12",
  "windowDays": 5,
  "birthdays": [
    {
      "employeeId": "EMP3805",
      "name": "Chinthalapudi Dheeraj Reddy",
      "designation": "Senior Manager",
      "department": "Technology",
      "dateOfBirth": "1998-08-12",
      "officialEmail": "dheeraj.reddy@infinitylearn.com"   // <- this
    }
  ],
  "workAnniversaries": [ /* same, plus "years" */ ],
  "newJoiners": [ /* same */ ]
}
```

The client already reads `officialEmail`, falling back to `email` then `upn`, so any
of those three names works. The field exists on the employee record the directory
returns — it is simply not projected into this response.

### Why the client cannot just read the directory instead

It was the first thing tried. With an employee's token:

```
GET /api/employees            403  "This action requires the HR role."
GET /api/employees/EMP3805    404  (no route)
GET /api/employees/me         200  own record only
```

That restriction is right and should stay — an employee should not be able to
enumerate the whole workforce's contact details. Which is exactly why the field
belongs on **this** response instead: `/api/employees/celebrations` is already a short,
curated list of people the employee is being invited to greet today. Adding one work
email to a handful of colleagues having a birthday is a far narrower disclosure than
opening the directory, and it is the minimum that makes the feature possible.

---

## Why

Each person gets a **Wish** button that opens a Teams chat with them, with the message
already typed:

```
https://teams.microsoft.com/l/chat/0/0?users=<email>&message=Happy%20birthday%2C%20Dheeraj!%20%F0%9F%8E%82
```

Teams identifies people by their sign-in address, which for us is the
`@infinitylearn.com` work email. There is no way to open a chat from an employee id.

**Without the field the button hides itself** rather than opening an empty chat, so
nothing is broken today — the feature is just invisible.

### Why a deep link and not a message from the bot

The bot could, in principle, message the recipient itself. It should not:

- It would arrive **from HR Genie**, not from the colleague, so the recipient can see
  the wish was sent by a machine on someone's behalf. That is worse than no wish.
- It would only reach people who have already installed the bot.

The deep link writes the words and leaves the send to a human. No extra permission,
nothing required of the recipient.

---

## Two smaller things

**`newJoiners` is always empty.** Over several days of testing it has never returned a
row while `birthdays` returned ten. Either nobody has joined inside the five-day
window, or the query does not populate it. Worth a check — the section is built and
will appear as soon as data arrives.

**`windowDays` is 5.** Fine for birthdays. For new joiners, five days is narrow enough
that most people will never see a welcome; 14 or 30 would suit that group better if it
can be set per group.

---

## What the console now needs

There is a Celebrations page in the HRBP console. It shows **today** from this endpoint
and **the month ahead** computed from `dateOfJoining` in the directory. Two things would
make it better, and one of them is a correctness issue.

### 1. `department` on each celebrant (correctness)

HRBPs are scoped to their own departments — see `docs/ACCESS_CONTROL.md`. This response
carries no department, so the console joins each celebrant against the directory by
`employeeId` to work out whether an HRBP should see them.

That join fails silently for anyone the directory does not return, and the console
resolves it by hiding them. The safe direction, but it means a real celebrant can
vanish for reasons nobody can see from the page.

One field per person fixes it:

```jsonc
{ "employeeId": "EMP3801", "name": "...", "department": "Experience" }
```

Better still, **scope the response server-side** by the caller's departments, the way
the ticket list should be. Then the console does no filtering at all and the rule lives
in one place.

### 2. A date of birth the console can look ahead on

Birthdays are the one kind that cannot appear in the month-ahead list. Anniversaries and
joiners come off `dateOfJoining`, which the directory already returns; there is no
equivalent for birthdays, so they can only be known on the day.

The page says so plainly rather than showing a list that looks complete. If HR wants to
plan a week ahead — which is the point of the page — the endpoint needs either a
`daysAhead` parameter or a `birthdayIso` (month and day are enough; the year is not
needed and is more personal data than the job requires).

**Not the full date of birth on `/api/employees`.** The directory is deliberately
work-facing; adding a birth date to it would put personal data in front of every HR
account for the sake of a card. Month and day, on the celebrations endpoint only.
