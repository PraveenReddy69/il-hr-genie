package com.infinitylearn.hrgenie.data

import android.util.Log
import com.infinitylearn.hrgenie.data.net.ApiConfig
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

/** A policy document an answer was drawn from. */
data class KbSource(
    val documentTitle: String,
    val sourceUri: String,
    val score: Double,
) {
    /** "Leave_Policy_1786077681487.pdf" -> "Leave Policy" — the timestamp is noise. */
    val displayTitle: String
        get() = documentTitle
            .substringBeforeLast('.')
            .replace(Regex("_\\d{6,}$"), "")
            .replace('_', ' ')
            .trim()
            .ifEmpty { documentTitle }
}

data class KbAnswer(val answer: String, val sources: List<KbSource>)

/**
 * Why a lookup failed, in terms the chat copy can speak.
 *
 * [Unreachable] is the common one with a tunnelled prototype: the socket dies before
 * any status line arrives, so there is no HTTP code to report — only that nothing
 * answered.
 */
sealed interface KbFailure {
    /** Nothing answered: DNS miss, refused, reset, or a dropped tunnel. */
    data class Unreachable(val detail: String) : KbFailure

    /** Connected, but the answer never came. */
    data object Timeout : KbFailure

    /** A real HTTP status, with whatever the server said about it. */
    data class Server(val code: Int, val body: String?) : KbFailure

    /** 200, but nothing usable came back — empty body, HTML, or no answer field. */
    data class Unusable(val detail: String) : KbFailure
}

class KbException(val failure: KbFailure) : IOException(failure.toString())

/**
 * The HR policy knowledge base.
 *
 * Plain [HttpURLConnection] rather than a networking library: this is the app's only
 * HTTP call, and one request does not justify the dependency.
 */
class KbClient(private val baseUrl: String = KB_BASE_URL) {

    /**
     * Asks the knowledge base, retrying once on a transient transport failure — a
     * tunnel that has just been re-established drops the first connection often
     * enough to be worth one more attempt.
     *
     * Failures come back as [Result.failure] carrying a [KbException], so the caller
     * can say what went wrong rather than guessing.
     */
    suspend fun ask(question: String): Result<KbAnswer> = withContext(Dispatchers.IO) {
        var last: KbFailure? = null
        repeat(ATTEMPTS) { attempt ->
            when (val outcome = attempt(question)) {
                is Outcome.Success -> return@withContext Result.success(outcome.answer)
                is Outcome.Failed -> {
                    last = outcome.failure
                    Log.w(TAG, "Knowledge base attempt ${attempt + 1} failed: ${outcome.failure}")
                    // A status means the server spoke; asking again will not change it.
                    if (outcome.failure is KbFailure.Server) return@repeat
                    if (attempt < ATTEMPTS - 1) delay(RETRY_DELAY_MS)
                }
            }
        }
        Result.failure(KbException(last ?: KbFailure.Unreachable("no attempt completed")))
    }

    private sealed interface Outcome {
        data class Success(val answer: KbAnswer) : Outcome
        data class Failed(val failure: KbFailure) : Outcome
    }

    private fun attempt(question: String): Outcome {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$baseUrl$QUERY_PATH").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("accept", "*/*")
                // ngrok serves a browser interstitial without this, which would come
                // back as HTML instead of the JSON body.
                setRequestProperty("ngrok-skip-browser-warning", "true")
            }
            connection.outputStream.use { it.write(requestBody(question).toByteArray()) }

            // Reading the status is where a dead tunnel surfaces: there is no status
            // line to read, so this throws rather than returning a code.
            val code = connection.responseCode
            if (code !in 200..299) {
                return Outcome.Failed(KbFailure.Server(code, connection.errorStream.readOrNull()))
            }

            val body = connection.inputStream.readOrNull().orEmpty()
            if (body.isBlank()) {
                return Outcome.Failed(KbFailure.Unusable("empty body, HTTP $code"))
            }
            parse(body)
        } catch (e: SocketTimeoutException) {
            Outcome.Failed(KbFailure.Timeout)
        } catch (e: UnknownHostException) {
            Outcome.Failed(KbFailure.Unreachable("host not found: ${e.message}"))
        } catch (e: ConnectException) {
            Outcome.Failed(KbFailure.Unreachable("connection refused: ${e.message}"))
        } catch (e: SSLException) {
            Outcome.Failed(KbFailure.Unreachable("TLS failed: ${e.message}"))
        } catch (e: IOException) {
            // No status line, connection reset mid-flight, tunnel closed. This is the
            // "failed without a status" case.
            Outcome.Failed(KbFailure.Unreachable(e.message ?: e.javaClass.simpleName))
        } finally {
            connection?.disconnect()
        }
    }

    /** Never let a body read sink the request — a missing body is a failure kind. */
    private fun InputStream?.readOrNull(): String? = this?.let { stream ->
        runCatching { stream.bufferedReader().use(BufferedReader::readText) }.getOrNull()
    }

    private fun requestBody(question: String) = JSONObject()
        .put("question", question)
        .put("maxResults", MAX_RESULTS)
        .put("knowledgeBase", KNOWLEDGE_BASE)
        .put("modelId", MODEL_ID)
        .toString()

    private fun parse(body: String): Outcome {
        val json = try {
            JSONObject(body)
        } catch (e: JSONException) {
            // Usually an ngrok or proxy HTML page where JSON was expected.
            return Outcome.Failed(KbFailure.Unusable("not JSON: ${body.take(80)}"))
        }

        val answer = json.optString("answer").trim()
        if (answer.isEmpty()) {
            return Outcome.Failed(KbFailure.Unusable("no answer field"))
        }

        val array = json.optJSONArray("sources")
        val sources = (0 until (array?.length() ?: 0)).mapNotNull { index ->
            val source = array?.optJSONObject(index) ?: return@mapNotNull null
            KbSource(
                documentTitle = source.optString("documentTitle"),
                sourceUri = source.optString("sourceUri"),
                score = source.optDouble("score", 0.0),
            )
        }
        return Outcome.Success(KbAnswer(answer, sources))
    }

    companion object {
        /**
         * The policy service shares a host with the rest of the backend, so the
         * tunnel address lives in one place now.
         */
        const val KB_BASE_URL = ApiConfig.BASE_URL

        private const val TAG = "KbClient"
        private const val QUERY_PATH = "/api/kb/query"
        private const val KNOWLEDGE_BASE = "default"
        private const val MODEL_ID = "amazon.nova-lite-v1:0"
        private const val MAX_RESULTS = 15

        private const val ATTEMPTS = 2
        private const val RETRY_DELAY_MS = 600L
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 45_000
    }
}
