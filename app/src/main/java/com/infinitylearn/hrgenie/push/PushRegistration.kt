package com.infinitylearn.hrgenie.push

import android.content.Context
import android.util.Log
import com.infinitylearn.hrgenie.HrGenieApp
import com.infinitylearn.hrgenie.data.Devices
import com.infinitylearn.hrgenie.data.SessionStore
import kotlinx.coroutines.launch

/**
 * Telling the backend where to push, from the two places that learn something new.
 *
 * Sign-in knows a new employee is on this install; [HrGenieMessagingService] knows the
 * token itself has rotated. Both end up here so the two paths cannot drift.
 *
 * Everything is fire-and-forget. A failure is logged and dropped: push is additive, so
 * a device that never pairs still sees every ticket update in the app, and a pairing
 * error must never be something an employee has to think about.
 */
object PushRegistration {

    /**
     * After signing in, with the session's own bearer — it may not be persisted yet.
     *
     * Also called on cold start for a remembered session, because an install that
     * failed to pair before the endpoint existed would otherwise never try again: the
     * record of who a token was registered for is only written on success, so this
     * is a no-op once it has worked.
     */
    fun pair(context: Context, employeeId: String, authToken: String) {
        val tokens = PushTokenStore(context)
        tokens.refresh { token ->
            if (!tokens.needsRegistering(employeeId)) return@refresh
            send(tokens, employeeId, token, authToken)
        }
    }

    /**
     * After Firebase rotates the token.
     *
     * Only possible while a session is on disk, which means "keep me signed in" was
     * ticked. Without one there is no bearer to authenticate with, so the new token
     * simply waits for the next sign-in — which will send it, because saving a token
     * clears the record of who it was registered for.
     */
    fun pairAfterRefresh(context: Context, token: String) {
        val session = SessionStore(context)
        val employeeId = session.rememberedId() ?: return
        val authToken = session.token() ?: return
        send(PushTokenStore(context), employeeId, token, authToken)
    }

    /**
     * On sign-out, so this phone stops receiving that employee's tickets.
     *
     * Fired before the session is cleared, because the call needs its bearer. The
     * local record is dropped either way: if the server never hears about it, the
     * worst case is a stale row it will clean up on the next `UNREGISTERED` from FCM,
     * and re-registering on the next sign-in costs one request.
     */
    fun unpairOnSignOut(context: Context, authToken: String?) {
        val tokens = PushTokenStore(context)
        val token = tokens.token()
        tokens.clearRegistration()
        if (token == null || authToken == null) return
        HrGenieApp.backgroundScope.launch {
            Devices.unregister(token, authToken)
                .onSuccess { Log.i(TAG, "Device unpaired") }
                .onFailure { error -> Log.i(TAG, "Unpair failed: ${error.message}") }
        }
    }

    private fun send(
        tokens: PushTokenStore,
        employeeId: String,
        token: String,
        authToken: String,
    ) {
        Log.i(TAG, "Pairing device: employeeId=$employeeId token=${token.take(12)}…")
        HrGenieApp.backgroundScope.launch {
            Devices.register(token, authToken)
                .onSuccess {
                    tokens.markRegistered(employeeId)
                    Log.i(TAG, "Device paired for $employeeId")
                }
                // Expected until the endpoint ships. Logged, never shown.
                .onFailure { error -> Log.i(TAG, "Device pairing unavailable: ${error.message}") }
        }
    }

    private const val TAG = "HrGeniePush"
}
