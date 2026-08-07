package com.infinitylearn.hrgenie.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.infinitylearn.hrgenie.MainActivity
import com.infinitylearn.hrgenie.R

/**
 * Posts the "HR moved your ticket" notification and wires the tap that opens it.
 *
 * The push carries the whole message, so nothing here reads local storage: the phone
 * may be asleep with the app dead when it arrives.
 */
object TicketNotifications {

    /** Extras a notification tap puts on MainActivity's intent. */
    const val EXTRA_TICKET_ID = "hr_genie.ticket_id"

    private const val CHANNEL_ID = "hr_genie_tickets"

    fun show(
        context: Context,
        ticketId: String,
        title: String,
        body: String,
    ) {
        // Android 13+ can refuse the post outright. Bail before building anything:
        // the update is not lost, it is still waiting in chat and on My tickets.
        // The check is inline rather than in a helper because lint only recognises
        // the guard when it sits in the same function as the notify().
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = NotificationManagerCompat.from(context)
        // Granted, but the user may still have muted the channel.
        if (!manager.areNotificationsEnabled()) return

        ensureChannel(context)

        // Opening from a notification should land on the ticket, not wherever the
        // app happened to be. SINGLE_TOP so a running app gets onNewIntent rather
        // than a second copy of itself.
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_TICKET_ID, ticketId)
        }
        val pending = PendingIntent.getActivity(
            context,
            ticketId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.blue_primary))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        // One notification per ticket: a second update replaces the first rather
        // than stacking two rows about the same thing.
        manager.notify(ticketId.hashCode(), notification)
    }

    /**
     * Created at process start as well as before each post: FCM's own fallback kicks
     * in if the channel named in the manifest does not exist by the time it draws.
     */
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_tickets),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_tickets_desc)
        }
        context.getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }
}
