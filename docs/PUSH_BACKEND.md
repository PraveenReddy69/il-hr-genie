# HR Genie — push notifications, backend handoff

**Goal:** HR marks a ticket resolved → the employee's phone buzzes → tapping the
notification opens that ticket.

The Android client is **finished and verified on a real device**. Everything below
is the server half, which the app cannot do itself.

---

## 1. Why the server has to send

FCM's HTTP v1 API authenticates with a **service-account private key**. That key
can mint pushes to every install of the app, so it must never ship inside an APK
or a browser bundle — anyone could decompile it and spam all employees.

So the phone can register itself, and it can receive. It cannot send. The web
console cannot send either, for the same reason. Only the backend can.

---

## 2. Firebase project

| | |
|---|---|
| Project name | IL HR Genie |
| Project ID | `il-hr-genie` |
| Project number | `873113193084` |
| Android package | `com.infinitylearn.hrgenie` |
| App ID | `1:873113193084:android:74eba9b29736c782c957f9` |

### Getting your credentials

Firebase Console → ⚙ **Project settings** → **Service accounts** → **Generate new
private key**. That downloads a JSON file.

Treat it like a database password: keep it out of git, load it from a secret store
or an env var in each environment. Ask me for console access if you don't have it —
I won't send the key over chat.

---

## 3. Auth — there is nothing extra to obtain

**The service-account JSON from §2 is the only credential you need.** You do not
request, buy or get issued an "OAuth2 bearer token" — it is *derived* from that JSON
at runtime, and if you use the Admin SDK (§8) you will never see one.

What happens inside the library:

```
service-account JSON  →  sign a JWT with its private key
                      →  exchange it at oauth2.googleapis.com for an access token
                      →  cache the token, reuse for ~1 hour, refresh automatically
```

So the whole of your code is `FirebaseMessaging.getInstance().send(message)`. Skip to
§8 and you are done — the rest of this section only matters if you want to call the
REST endpoint by hand.

### The raw endpoint (only if you are not using the SDK)

```
POST https://fcm.googleapis.com/v1/projects/il-hr-genie/messages:send
Authorization: Bearer <access token>
Content-Type: application/json
```

Mint the token with the Google auth library for your language rather than
hand-rolling the JWT exchange — it is fiddly to get right and easy to get subtly
wrong (clock skew, wrong audience, wrong scope):

```java
GoogleCredentials creds = GoogleCredentials
    .fromStream(new FileInputStream(System.getenv("FIREBASE_CREDENTIALS_PATH")))
    .createScoped("https://www.googleapis.com/auth/firebase.messaging");
creds.refreshIfExpired();
String bearer = creds.getAccessToken().getTokenValue();
```

Cache it. Minting one per push will get you rate-limited.

For a quick manual test from a terminal, `gcloud` will print one for you:

```bash
gcloud auth activate-service-account --key-file=service-account.json
gcloud auth print-access-token
```

### Not the legacy API

If a tutorial shows `POST /fcm/send` with an `Authorization: key=AAAA…` header, it is
out of date — that server-key API is **decommissioned** and will return 404. There is
no way to send with a static key any more; the service account is the only route.

---

## 4. The payload — exactly this shape

```json
{
  "message": {
    "token": "<device token from /api/devices>",
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

### Rules

**Data-only. Do not add a `notification` block.** This is the one that bites. With a
`notification` block, Android draws the notification itself while the app is
backgrounded and the app never sees the message — so the tap opens the home screen
instead of the ticket, and our styling and channel are ignored. Data-only means our
service is invoked in every app state and builds the notification with the deep link
attached.

**All values must be strings.** FCM rejects `data` maps containing numbers, booleans
or nested objects. `"status": "RESOLVED"`, never `"status": 1`.

**`android.priority: "high"`** so it wakes a dozing phone. Without it, Doze can hold
the message until the next maintenance window — minutes to hours.

### Field reference

| Key | Required | Notes |
|---|---|---|
| `type` | ✅ | Always `TICKET_STATUS`. The client drops anything else — it's the discriminator for future push types. |
| `ticketId` | ✅ | Client drops the message without it. Drives the deep link and de-duplication. |
| `employeeId` | ✅ | Client-side safety check, see below. |
| `status` | ✅ | `OPEN` \| `IN_PROGRESS` \| `RESOLVED`, exactly — it's parsed as an enum. |
| `title` | optional | Falls back to a per-status default. |
| `body` | optional | Falls back to a per-status default. |

`employeeId` is re-checked on the device: a shared demo phone signed in as someone
else drops the push rather than showing them a colleague's ticket. Send it even
though you're already addressing a specific token.

**Put the resolution note in `body`.** It's the thing the employee actually wants to
read, and it shows in full — the notification uses `BigTextStyle`, so a long note
expands rather than truncating.

One notification per ticket: a second update to the same ticket replaces the first
rather than stacking a second row.

---

## 5. Where to send from

On a **successful** `PATCH /api/tickets/{id}/status`, after the write commits. Push
to every device row for `ticket.employeeId` — one employee can have several.

Send **after** the commit, not inside the transaction: an FCM timeout must not roll
back a status change HR has already been told succeeded. Equally, don't fail the
PATCH if the push fails — the update is still visible in the app's My Tickets and
in chat. Log it and move on.

A queue/retry is nice but not needed for the hackathon.

---

## 6. Device registration

`POST /api/devices`

```json
{ "employeeId": "EMP3801", "token": "fcm-token…", "platform": "android" }
```

The app calls this at sign-in. Today it stops at a `// TODO` in `SignInFragment.kt`
because there's no endpoint — **tell me the URL and auth and I'll wire it in minutes.**

- Upsert on `token`, not on `employeeId`. The token identifies the *install*, and
  re-signing in on the same phone must not create a duplicate row.
- A token can move between employees (shared demo phone). The newest `employeeId`
  for a token wins — reassign, don't insert.
- Tokens rotate on reinstall, restore-to-new-device and app-data clear. The client
  re-registers when that happens; just accept the new one.

Suggested table:

```sql
CREATE TABLE device_token (
  token        VARCHAR(255) PRIMARY KEY,
  employee_id  VARCHAR(32)  NOT NULL,
  platform     VARCHAR(16)  NOT NULL,
  updated_at   TIMESTAMP    NOT NULL,
  INDEX (employee_id)
);
```

---

## 7. Handling the response

| FCM response | Meaning | Do this |
|---|---|---|
| `200` | Accepted for delivery | Nothing. Note: accepted ≠ delivered. |
| `404` / `UNREGISTERED` | App uninstalled, or token rotated | **Delete the row.** Otherwise dead tokens accumulate forever. |
| `400` / `INVALID_ARGUMENT` | Malformed payload | A bug in your payload — usually a non-string value in `data`. Log loudly; retrying won't help. |
| `403` / `SENDER_ID_MISMATCH` | Token belongs to another Firebase project | Delete the row. |
| `429` / `QUOTA_EXCEEDED` | Rate limited | Back off and retry. |
| `503` / `UNAVAILABLE` | FCM hiccup | Retry with exponential backoff. |

Only `429` and `503` are worth retrying. Everything else is permanent.

---

## 8. Reference implementation

Use the Firebase Admin SDK. It handles the token minting, caching and refresh from
§3 for you — the service-account JSON goes in, and you write no auth code at all.

### Java / Spring

```xml
<dependency>
  <groupId>com.google.firebase</groupId>
  <artifactId>firebase-admin</artifactId>
  <version>9.4.1</version>
</dependency>
```

```java
// Once, at startup.
FirebaseApp.initializeApp(FirebaseOptions.builder()
    .setCredentials(GoogleCredentials.fromStream(
        new FileInputStream(System.getenv("FIREBASE_CREDENTIALS_PATH"))))
    .build());

// After the status write commits.
public void notifyStatusChange(Ticket ticket, String note) {
    for (String token : deviceTokens.findByEmployeeId(ticket.employeeId())) {
        Message message = Message.builder()
            .setToken(token)
            .putData("type", "TICKET_STATUS")
            .putData("ticketId", ticket.id())
            .putData("employeeId", ticket.employeeId())
            .putData("status", ticket.status().name())
            .putData("title", "HR closed " + ticket.id())
            .putData("body", note)
            .setAndroidConfig(AndroidConfig.builder()
                .setPriority(AndroidConfig.Priority.HIGH)
                .build())
            .build();
        try {
            FirebaseMessaging.getInstance().send(message);
        } catch (FirebaseMessagingException e) {
            if (e.getMessagingErrorCode() == MessagingErrorCode.UNREGISTERED) {
                deviceTokens.delete(token);      // dead install, stop trying
            } else {
                log.warn("Push failed for ticket {}", ticket.id(), e);
            }
            // Never rethrow — the PATCH already succeeded.
        }
    }
}
```

### Node

```bash
npm install firebase-admin
```

```js
import admin from 'firebase-admin'

admin.initializeApp({
  credential: admin.credential.cert(process.env.FIREBASE_CREDENTIALS_PATH),
})

export async function notifyStatusChange(ticket, note) {
  const tokens = await db.deviceTokens.findByEmployeeId(ticket.employeeId)
  for (const token of tokens) {
    try {
      await admin.messaging().send({
        token,
        data: {
          type: 'TICKET_STATUS',
          ticketId: ticket.id,
          employeeId: ticket.employeeId,
          status: ticket.status,
          title: `HR closed ${ticket.id}`,
          body: note,
        },
        android: { priority: 'high' },
      })
    } catch (e) {
      if (e.code === 'messaging/registration-token-not-registered') {
        await db.deviceTokens.delete(token)
      } else {
        console.warn('Push failed for', ticket.id, e)
      }
    }
  }
}
```

---

## 9. How to test your side

1. Get a real device token: sign into the app, then
   `adb logcat -s HrGeniePush` — it's logged at sign-in.
2. Send the §4 payload to that token from your service.
3. The phone should show **"HR closed HRG-0001"**; tapping it should land directly
   on that ticket, not the home screen.

To confirm it took our path rather than Android's fallback:

```bash
adb shell dumpsys notification | grep -A3 hrgenie
```

You want `channel=hr_genie_tickets`. If you see
`fcm_fallback_notification_channel`, you sent a `notification` block — remove it.

### Already verified

This exact payload was sent from the Firebase console to a Samsung device on
2026-08-08 and produced:

```
Notification(channel=hr_genie_tickets  color=0xff2b8cff
             category=status  flags=AUTO_CANCEL)
```

— our own notification, our channel, deep link attached. So if it doesn't work
from your service, the difference is in the send, not in the app.

---

## 10. What I need from you

1. The `POST /api/devices` URL and its auth header — the client TODO is waiting on it.
2. A heads-up when the send is live, so we can run the full HR-resolves → employee-taps
   path end to end before the demo.
