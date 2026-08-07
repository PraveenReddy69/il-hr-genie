package com.infinitylearn.hrgenie.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.TicketStatus

/**
 * Receives ticket updates pushed by the backend.
 *
 * The server sends a **data-only** message, not a `notification` block — a
 * notification block is drawn by the system while the app is backgrounded and the
 * app never sees it, so the tap could not be routed to the right ticket. Data-only
 * means this service is called either way and builds the notification itself.
 *
 * Expected payload:
 * ```
 * { "type": "TICKET_STATUS",
 *   "ticketId": "HRG-0001",
 *   "employeeId": "EMP3801",
 *   "status": "RESOLVED",
 *   "title": "HR closed HRG-0001",
 *   "body": "Deduction reversed in the August run." }
 * ```
 */
class HrGenieMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != TYPE_TICKET_STATUS) {
            Log.w(TAG, "Ignoring push of unknown type ${data["type"]}")
            return
        }

        val ticketId = data["ticketId"].orEmpty()
        if (ticketId.isEmpty()) {
            Log.w(TAG, "Ticket push with no ticketId")
            return
        }

        // A shared demo phone can be signed in as someone else. Showing them a push
        // about a colleague's ticket would leak it, so it is dropped.
        val addressee = data["employeeId"]
        val signedIn = SessionStore(this).rememberedId()
        if (!addressee.isNullOrEmpty() && !addressee.equals(signedIn, ignoreCase = true)) {
            Log.i(TAG, "Push for $addressee ignored; $signedIn is signed in")
            return
        }

        val status = runCatching { TicketStatus.valueOf(data["status"].orEmpty()) }.getOrNull()

        TicketNotifications.show(
            context = this,
            ticketId = ticketId,
            title = data["title"] ?: defaultTitle(ticketId, status),
            body = data["body"] ?: defaultBody(status),
        )
    }

    /**
     * Fired when the token is minted or rotated. The backend needs it to address this
     * device, so it is kept locally and handed over on the next sign-in.
     */
    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM token refreshed")
        PushTokenStore(this).save(token)
    }

    private fun defaultTitle(ticketId: String, status: TicketStatus?): String = when (status) {
        TicketStatus.RESOLVED -> "HR closed $ticketId"
        TicketStatus.IN_PROGRESS -> "HR picked up $ticketId"
        TicketStatus.OPEN -> "$ticketId was reopened"
        null -> "Update on $ticketId"
    }

    private fun defaultBody(status: TicketStatus?): String = when (status) {
        TicketStatus.RESOLVED -> "Tap to see what they did."
        TicketStatus.IN_PROGRESS -> "Someone is on it now."
        TicketStatus.OPEN -> "It is back with HR."
        null -> "Tap to see the latest."
    }

    private companion object {
        const val TAG = "HrGeniePush"
        const val TYPE_TICKET_STATUS = "TICKET_STATUS"
    }
}
