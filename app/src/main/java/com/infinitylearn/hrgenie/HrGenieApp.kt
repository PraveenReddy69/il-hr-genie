package com.infinitylearn.hrgenie

import android.app.Application
import com.infinitylearn.hrgenie.push.TicketNotifications

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
}
