package com.infinitylearn.hrgenie

import android.app.Application
import com.infinitylearn.hrgenie.push.TicketNotifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Exists to create the notification channel at process start.
 *
 * The manifest names `hr_genie_tickets` as FCM's default channel. If a message
 * arrives carrying a `notification` block, the SDK draws it itself — and if the
 * channel does not exist yet it silently falls back to `fcm_fallback_notification_channel`,
 * which ignores our name, description and importance. Creating it here means the
 * channel is ready whichever path posts the notification.
 */
class HrGenieApp : Application() {

    override fun onCreate() {
        super.onCreate()
        TicketNotifications.ensureChannel(this)
    }

    companion object {
        /**
         * For work that must outlive the screen that started it.
         *
         * Device pairing is the case: it is kicked off from sign-in and the very next
         * line navigates away, which would cancel a fragment-scoped call mid-flight.
         * Nothing here touches the UI, so there is no leak to worry about.
         */
        val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
