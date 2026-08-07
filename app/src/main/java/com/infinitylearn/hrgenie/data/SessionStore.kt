package com.infinitylearn.hrgenie.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.infinitylearn.hrgenie.data.AuthApi.Companion.toEmployee
import org.json.JSONObject

/**
 * Remembers who is signed in across launches.
 *
 * The employee record now comes from the HRMS rather than [EmployeeDirectory], so the
 * id alone is no longer enough to restore a session — the record itself is stored,
 * along with the token that authorises further calls.
 *
 * That means personal details (name, work email, date of birth) sit in preferences.
 * These are app-private on a non-rooted device, and [forget] clears them on sign-out
 * or when "Keep me signed in" is off. Nothing here is world-readable, but it is worth
 * knowing it is on disk.
 */
class SessionStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    /** Who is signed in, or null if nobody is or the token has expired. */
    fun remembered(): Session? {
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        val employeeJson = prefs.getString(KEY_EMPLOYEE, null) ?: return null

        if (isExpired(token)) {
            Log.i(TAG, "Stored token has expired; signing out")
            forget()
            return null
        }

        return runCatching {
            val json = JSONObject(employeeJson)
            Session(json.toEmployee(), token, employeeJson)
        }.getOrElse {
            Log.w(TAG, "Stored session could not be read; signing out", it)
            forget()
            null
        }
    }

    /**
     * The signed-in id on its own.
     *
     * Cheaper than [remembered] and deliberately does not check expiry — the push
     * service uses it only to decide whether a notification is addressed to whoever
     * is on this phone, which stays true after a token lapses.
     */
    fun rememberedId(): String? = prefs.getString(KEY_EMPLOYEE_ID, null)

    /** The bearer token for API calls, or null once it has expired. */
    fun token(): String? = prefs.getString(KEY_TOKEN, null)?.takeUnless { isExpired(it) }

    fun remember(session: Session) {
        prefs.edit()
            .putString(KEY_EMPLOYEE_ID, session.employee.employeeId)
            .putString(KEY_EMPLOYEE, session.raw)
            .putString(KEY_TOKEN, session.token)
            .commit()
    }

    fun forget() {
        prefs.edit()
            .remove(KEY_EMPLOYEE_ID)
            .remove(KEY_EMPLOYEE)
            .remove(KEY_TOKEN)
            .commit()
    }

    /**
     * Reads `exp` out of the JWT payload.
     *
     * Checking here means an expired session shows the sign-in screen rather than a
     * populated app whose every call 401s. This is a convenience, not a security
     * control — the server validates the token regardless, and a token that cannot be
     * parsed is treated as good and left for the server to reject.
     */
    private fun isExpired(token: String): Boolean {
        val seconds = expirySeconds(token) ?: return false
        return System.currentTimeMillis() >= seconds * 1000L
    }

    private fun expirySeconds(token: String): Long? = runCatching {
        val payload = token.split('.').getOrNull(1) ?: return null
        val decoded = Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        JSONObject(String(decoded)).optLong("exp").takeIf { it > 0 }
    }.getOrNull()

    private companion object {
        const val TAG = "HrGenieAuth"
        const val FILE_NAME = "hr_genie_session"
        const val KEY_EMPLOYEE_ID = "employee_id"
        const val KEY_EMPLOYEE = "employee_json"
        const val KEY_TOKEN = "auth_token"
    }
}
