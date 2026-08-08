package com.infinitylearn.hrgenie.push

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging

/**
 * The device's FCM token, and whether the backend has been told about it.
 *
 * The token identifies this install, not the person: it is minted before anyone signs
 * in and survives sign-out. Which employee it belongs to is the pairing the server
 * needs, so [markRegistered] records who it was last handed over for — a different
 * employee signing in on the same phone has to re-register.
 */
class PushTokenStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    fun token(): String? = prefs.getString(KEY_TOKEN, null)

    fun save(token: String) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            // A new token has been registered for nobody yet.
            .remove(KEY_REGISTERED_FOR)
            .commit()
    }

    /**
     * True when this employee still needs their device paired on the server.
     *
     * A build shipped before the endpoint existed wrote [KEY_REGISTERED_FOR] without
     * ever calling anything, so on those installs the flag is a lie and the device
     * would never register. [KEY_SCHEMA] invalidates it exactly once.
     */
    fun needsRegistering(employeeId: String): Boolean {
        if (token() == null) return false
        if (prefs.getInt(KEY_SCHEMA, 0) < SCHEMA) return true
        return prefs.getString(KEY_REGISTERED_FOR, null) != employeeId
    }

    /** Only ever called after the server has accepted the token. */
    fun markRegistered(employeeId: String) {
        prefs.edit()
            .putString(KEY_REGISTERED_FOR, employeeId)
            .putInt(KEY_SCHEMA, SCHEMA)
            .commit()
    }

    /** Forgets who this token was paired for, so the next sign-in registers again. */
    fun clearRegistration() {
        prefs.edit().remove(KEY_REGISTERED_FOR).commit()
    }

    /**
     * Asks Firebase for the current token, if Firebase is set up at all.
     *
     * Without google-services.json the SDK is present but uninitialised, so this
     * fails rather than crashing the app around it — push is additive, not required.
     */
    fun refresh(onToken: (String) -> Unit = {}) {
        runCatching {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    save(token)
                    onToken(token)
                }
                .addOnFailureListener { error ->
                    Log.w(TAG, "Could not fetch an FCM token: ${error.message}")
                }
        }.onFailure {
            Log.i(TAG, "Firebase is not configured; push is off. ${it.message}")
        }
    }

    private companion object {
        const val TAG = "HrGeniePush"
        const val FILE_NAME = "hr_genie_push"
        const val KEY_TOKEN = "fcm_token"
        const val KEY_REGISTERED_FOR = "registered_for"
        const val KEY_SCHEMA = "registered_schema"

        /** Bump when a stored "registered" flag can no longer be trusted. */
        const val SCHEMA = 1
    }
}
