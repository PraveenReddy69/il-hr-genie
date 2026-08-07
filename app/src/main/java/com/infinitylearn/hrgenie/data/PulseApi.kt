package com.infinitylearn.hrgenie.data

import android.content.Context
import android.util.Log
import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONObject

/** What [PulseRepository] needs from a backend. Implemented by [PulseApi]. */
interface PulseGateway {
    suspend fun forCycle(employeeId: String, cycle: String): Result<PulseEntry?>
    suspend fun submit(employeeId: String, cycle: String, answers: Map<String, String>): Result<PulseEntry>
    suspend fun questions(): Result<List<PulseQuestion>>
    /** Everyone's answers for a cycle. HR only. */
    suspend fun hrForCycle(cycle: String): Result<Map<String, PulseEntry>>
}

/** Swappable so screen tests never reach the network. */
object Pulses {

    @Volatile
    var gateway: (token: String?) -> PulseGateway = { token -> PulseApi(token) }
}

class PulseApi(private val token: String?) : PulseGateway {

    /** 404 means this employee has not answered this cycle yet. */
    override suspend fun forCycle(employeeId: String, cycle: String): Result<PulseEntry?> =
        HttpJson.get("$PATH?employeeId=$employeeId&cycle=$cycle", token)
            .map { it.toEntry() }
            .recoverIfNotFound()

    override suspend fun submit(
        employeeId: String,
        cycle: String,
        answers: Map<String, String>,
    ): Result<PulseEntry> =
        HttpJson.post(
            path = PATH,
            body = JSONObject()
                .put("employeeId", employeeId)
                .put("cycle", cycle)
                .put("answers", JSONObject(answers)),
            token = token,
        ).mapCatching {
            it.toEntry() ?: throw ApiException(ApiFailure.Unusable("pulse save returned no entry"))
        }

    override suspend fun questions(): Result<List<PulseQuestion>> =
        HttpJson.get("$PATH/questions", token).map { json ->
            val array = json.optJSONArray("questions") ?: return@map emptyList()
            (0 until array.length()).mapNotNull { index ->
                val row = array.optJSONObject(index) ?: return@mapNotNull null
                val options = row.optJSONArray("options")
                PulseQuestion(
                    id = row.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null,
                    text = row.optString("question"),
                    // The server carries no hint; the built-in bank supplies one where
                    // the question ids line up.
                    hint = HrGenieContent.PULSE_QUESTIONS
                        .firstOrNull { it.id == row.optString("id") }?.hint.orEmpty(),
                    options = (0 until (options?.length() ?: 0))
                        .mapNotNull { options?.optString(it)?.takeIf(String::isNotBlank) },
                )
            }
        }

    override suspend fun hrForCycle(cycle: String): Result<Map<String, PulseEntry>> =
        HttpJson.getArray("$HR_PATH?cycle=$cycle", token).map { rows ->
            buildMap {
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    val id = row.optString("employeeId").takeIf { it.isNotBlank() } ?: continue
                    row.toEntry()?.let { put(id, it) }
                }
            }
        }

    private fun JSONObject.toEntry(): PulseEntry? {
        val answers = optJSONObject("answers") ?: return null
        return PulseEntry(
            cycle = optString("cycle"),
            completedAtMillis = optLong("completedAtMillis", System.currentTimeMillis()),
            answers = answers.keys().asSequence().associateWith { answers.optString(it) },
        )
    }

    private companion object {
        const val PATH = "/api/pulse"
        const val HR_PATH = "/api/hr/pulse"
    }
}

/** Pulse, server-first with the device as a cache. */
class PulseRepository(context: Context, private val token: String?) {

    private val store = PulseStore(context)
    private val api = Pulses.gateway(token)

    fun cached(employeeId: String, cycle: String): PulseEntry? = store.entry(employeeId, cycle)

    fun hasCompleted(employeeId: String, cycle: String): Boolean =
        store.hasCompleted(employeeId, cycle)

    suspend fun refresh(employeeId: String, cycle: String): Boolean {
        if (token == null) return false
        return api.forCycle(employeeId, cycle)
            .onSuccess { entry ->
                if (entry == null) store.clear(employeeId, cycle)
                else store.save(employeeId, cycle, entry.answers, entry.completedAtMillis)
            }
            .onFailure { Log.w(TAG, "Could not refresh pulse for $employeeId", it) }
            .isSuccess
    }

    /** Saved on the device first, so submitting never waits on the network. */
    suspend fun submit(
        employeeId: String,
        cycle: String,
        answers: Map<String, String>,
        completedAtMillis: Long = System.currentTimeMillis(),
    ): Boolean {
        store.save(employeeId, cycle, answers, completedAtMillis)
        if (token == null) return false
        return api.submit(employeeId, cycle, answers)
            .onFailure { Log.w(TAG, "Pulse saved on device but not on the server", it) }
            .isSuccess
    }

    /** The question bank, falling back to the built-in one if the server cannot be asked. */
    suspend fun questions(): List<PulseQuestion> =
        api.questions().getOrNull()?.takeIf { it.isNotEmpty() }
            ?: HrGenieContent.PULSE_QUESTIONS

    suspend fun refreshForHr(cycle: String): Boolean {
        if (token == null) return false
        return api.hrForCycle(cycle)
            .onSuccess { rows ->
                rows.forEach { (employeeId, entry) ->
                    store.save(employeeId, cycle, entry.answers, entry.completedAtMillis)
                }
            }
            .onFailure { Log.w(TAG, "Could not refresh HR pulse for $cycle", it) }
            .isSuccess
    }

    private companion object {
        const val TAG = "HrGeniePulse"
    }
}
