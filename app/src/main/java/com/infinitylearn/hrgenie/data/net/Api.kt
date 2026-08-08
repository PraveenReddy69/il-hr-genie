package com.infinitylearn.hrgenie.data.net

import android.util.Log
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Where the backend lives. **This is the one line to update.**
 *
 * No trailing slash: paths are concatenated raw and every one of them starts with a
 * slash of its own.
 *
 * HTTPS via sslip.io, which resolves a dashed IP to that address and carries a valid
 * certificate for it — so the same host works for the app and for the browser console,
 * which cannot call plain HTTP from an HTTPS page at all.
 */
object ApiConfig {
    const val BASE_URL = "https://35-161-200-62.sslip.io"
}

/**
 * Why a call failed, in terms the UI can speak.
 *
 * [Unreachable] is the common one behind a tunnel: the socket dies before any status
 * line arrives, so there is no HTTP code to report — only that nothing answered.
 * Keeping it distinct from [Http] is what lets the app say "we could not reach HR
 * Genie" rather than inventing a server error that never happened.
 */
sealed interface ApiFailure {
    /** Nothing answered: DNS miss, refused, reset, or a dropped tunnel. */
    data class Unreachable(val detail: String) : ApiFailure

    /** Connected, but the answer never came. */
    data object Timeout : ApiFailure

    /** A real HTTP status. [message] is the server's own text, when it sent any. */
    data class Http(val code: Int, val message: String?) : ApiFailure

    /** 2xx, but nothing usable came back — empty body, HTML, or a missing field. */
    data class Unusable(val detail: String) : ApiFailure
}

class ApiException(val failure: ApiFailure) : IOException(failure.toString())

/**
 * JSON over HTTP for the HR Genie backend.
 *
 * Plain [HttpURLConnection] rather than a networking library, matching
 * [com.infinitylearn.hrgenie.data.KbClient] — the app makes a handful of calls and
 * one more dependency is not worth it.
 */
object HttpJson {

    /**
     * POSTs [body] to [path] and returns the parsed response.
     *
     * No retry: unlike a knowledge-base lookup, these calls are not all safe to repeat
     * blind, and the caller knows better than this function whether a second attempt
     * is wanted.
     */
    suspend fun post(
        path: String,
        body: JSONObject,
        token: String? = null,
    ): Result<JSONObject> = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = open(path, "POST", token)
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            read(connection)
        } catch (e: Exception) {
            fail(path, transportFailure(e))
        } finally {
            connection?.disconnect()
        }
    }

    /** PATCHes [body] to [path]. Same failure vocabulary as [post]. */
    suspend fun patch(
        path: String,
        body: JSONObject,
        token: String? = null,
    ): Result<JSONObject> = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = open(path, "PATCH", token)
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            read(connection)
        } catch (e: Exception) {
            fail(path, transportFailure(e))
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * DELETEs [path] with a body. Same failure vocabulary as [post].
     *
     * A body on a DELETE is unusual but is what the unregister endpoint takes, and
     * HttpURLConnection will send one as long as output is opened explicitly.
     */
    suspend fun delete(
        path: String,
        body: JSONObject,
        token: String? = null,
    ): Result<JSONObject> = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = open(path, "DELETE", token)
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            read(connection)
        } catch (e: Exception) {
            fail(path, transportFailure(e))
        } finally {
            connection?.disconnect()
        }
    }

    /** GETs [path]. Same failure vocabulary as [post]. */
    suspend fun get(
        path: String,
        token: String? = null,
    ): Result<JSONObject> = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = open(path, "GET", token)
            read(connection)
        } catch (e: Exception) {
            fail(path, transportFailure(e))
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * GETs [path] where the response is a bare JSON array rather than an object.
     *
     * Wrapped and unwrapped so array and object endpoints share one code path — the
     * alternative is a second copy of the status, timeout and body handling.
     */
    suspend fun getArray(path: String, token: String? = null): Result<JSONArray> =
        get(path, token, wrapArrayAs = ARRAY_KEY).mapCatching { json ->
            json.optJSONArray(ARRAY_KEY)
                ?: throw ApiException(ApiFailure.Unusable("expected a JSON array"))
        }

    private suspend fun get(
        path: String,
        token: String?,
        wrapArrayAs: String,
    ): Result<JSONObject> = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = open(path, "GET", token)
            read(connection, wrapArrayAs)
        } catch (e: Exception) {
            fail(path, transportFailure(e))
        } finally {
            connection?.disconnect()
        }
    }

    private fun open(path: String, method: String, token: String?): HttpURLConnection =
        (URL("${ApiConfig.BASE_URL}$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("accept", "*/*")
            // ngrok serves a browser interstitial without this, which would come back
            // as HTML where JSON was expected.
            setRequestProperty("ngrok-skip-browser-warning", "true")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
        }

    private fun read(
        connection: HttpURLConnection,
        wrapArrayAs: String? = null,
    ): Result<JSONObject> {
        // Reading the status is where a dead tunnel surfaces: there is no status line
        // to read, so this throws rather than returning a code.
        val code = connection.responseCode
        if (code !in 200..299) {
            val body = connection.errorStream.readOrNull()
            return fail(connection.url.path, ApiFailure.Http(code, serverMessage(body)))
        }

        val body = connection.inputStream.readOrNull().orEmpty()
        if (body.isBlank()) {
            return fail(connection.url.path, ApiFailure.Unusable("empty body, HTTP $code"))
        }
        return try {
            Result.success(
                if (wrapArrayAs != null && body.trimStart().startsWith('[')) {
                    JSONObject().put(wrapArrayAs, JSONArray(body))
                } else {
                    JSONObject(body)
                }
            )
        } catch (e: JSONException) {
            // Usually an ngrok or proxy HTML page where JSON was expected.
            fail(connection.url.path, ApiFailure.Unusable("not JSON: ${body.take(80)}"))
        }
    }

    /** The backend reports errors as `{ message, error, statusCode }`. */
    private fun serverMessage(body: String?): String? = body
        ?.let { runCatching { JSONObject(it).optString("message") }.getOrNull() }
        ?.takeIf { it.isNotBlank() }

    private fun transportFailure(e: Exception): ApiFailure = when (e) {
        is SocketTimeoutException -> ApiFailure.Timeout
        is UnknownHostException -> ApiFailure.Unreachable("host not found: ${e.message}")
        is ConnectException -> ApiFailure.Unreachable("connection refused: ${e.message}")
        is SSLException -> ApiFailure.Unreachable("TLS failed: ${e.message}")
        // No status line, connection reset mid-flight, tunnel closed.
        is IOException -> ApiFailure.Unreachable(e.message ?: e.javaClass.simpleName)
        else -> ApiFailure.Unusable(e.message ?: e.javaClass.simpleName)
    }

    private fun fail(path: String, failure: ApiFailure): Result<JSONObject> {
        Log.w(TAG, "$path failed: $failure")
        return Result.failure(ApiException(failure))
    }

    /** Never let a body read sink the call — a missing body is a failure kind. */
    private fun InputStream?.readOrNull(): String? = this?.let { stream ->
        runCatching { stream.bufferedReader().use(BufferedReader::readText) }.getOrNull()
    }

    /** Internal key a bare-array response is parked under; never seen by callers. */
    private const val ARRAY_KEY = "__array"

    private const val TAG = "HrGenieApi"
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 30_000
}
