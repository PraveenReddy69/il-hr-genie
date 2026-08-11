package com.infinitylearn.hrgenie.push

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Whether this install may post notifications, and how to ask.
 *
 * The awkward part of POST_NOTIFICATIONS is that asking twice is the limit. After two
 * refusals the platform stops showing the dialog and answers "denied" immediately —
 * so a button that calls `launch()` looks broken rather than declined. [needsSettings]
 * spots that state so the ask can send them somewhere that actually works.
 */
object NotificationAccess {

    /** Below API 33 the permission does not exist and notifications simply post. */
    private val required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    fun isGranted(context: Context): Boolean {
        if (!required) return true
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * True when the system will no longer show its dialog, so the only way back is
     * app settings.
     *
     * Rationale is false both before the first ask and after the final refusal, which
     * is why [PushTokenStore] has to remember that we asked at all — the two states
     * are otherwise indistinguishable.
     */
    fun needsSettings(activity: Activity): Boolean {
        if (!required || isGranted(activity)) return false
        val canAskAgain = ActivityCompat.shouldShowRequestPermissionRationale(
            activity, Manifest.permission.POST_NOTIFICATIONS,
        )
        return !canAskAgain && PushTokenStore(activity).hasAskedForNotifications()
    }

    /** Opens this app's notification settings, for when the dialog will not appear. */
    fun openSettings(activity: Activity) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", activity.packageName, null))
        }
        runCatching { activity.startActivity(intent) }
    }

    const val PERMISSION = Manifest.permission.POST_NOTIFICATIONS
}
