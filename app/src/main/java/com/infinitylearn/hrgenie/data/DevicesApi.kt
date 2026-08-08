package com.infinitylearn.hrgenie.data

import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONObject

/**
 * Handing this install's FCM token to the backend, so it knows where to push.
 *
 * The contract is the backend team's: the body carries only the token, and the
 * employee it belongs to is taken from the bearer. That is the better design — it
 * cannot be spoofed into pairing someone else's device — so nothing here sends an
 * employee id even though the app knows it.
 */
object Devices {

    @Volatile
    var gateway: suspend (token: String, authToken: String?) -> Result<Unit> =
        { token, authToken -> DevicesApi().register(token, authToken) }

    @Volatile
    var unregisterGateway: suspend (token: String, authToken: String?) -> Result<Unit> =
        { token, authToken -> DevicesApi().unregister(token, authToken) }

    suspend fun register(token: String, authToken: String?): Result<Unit> =
        gateway(token, authToken)

    suspend fun unregister(token: String, authToken: String?): Result<Unit> =
        unregisterGateway(token, authToken)
}

class DevicesApi {

    /**
     * Registration is an upsert on the token, so repeating it is harmless — which is
     * what lets a failure here be dropped rather than retried or surfaced. Push is
     * additive; an employee whose device never registers still sees every update in
     * My Tickets and in chat.
     */
    suspend fun register(token: String, authToken: String?): Result<Unit> = HttpJson.post(
        path = FCM_TOKEN_PATH,
        body = JSONObject().put("token", token),
        token = authToken,
    ).map { }

    /**
     * Stops pushes reaching this install.
     *
     * Called on sign-out. Without it the phone keeps buzzing with the tickets of
     * someone who has signed off — and if a colleague signs in on the same device,
     * they see the previous person's ticket updates on the lock screen.
     */
    suspend fun unregister(token: String, authToken: String?): Result<Unit> = HttpJson.delete(
        path = FCM_TOKEN_PATH,
        body = JSONObject().put("token", token),
        token = authToken,
    ).map { }

    companion object {
        /** Confirmed against the deployed OpenAPI spec: POST and DELETE, bearer auth. */
        const val FCM_TOKEN_PATH = "/api/employees/fcm-token"
    }
}
