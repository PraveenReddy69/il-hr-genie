package com.infinitylearn.hrgenie.data

import android.content.Context
import android.util.Log
import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONArray
import org.json.JSONObject

/** What [MoodRepository] needs from a backend. Implemented by [MoodApi]. */
interface MoodGateway {
    suspend fun forDate(employeeId: String, dateIso: String): Result<MoodEntry?>
    suspend fun upsert(employeeId: String, dateIso: String, entry: MoodEntry): Result<MoodEntry>
    /** Everyone's mood for a date. HR only; the server answers 403 otherwise. */
    suspend fun hrForDate(dateIso: String): Result<Map<String, MoodEntry>>
}

/** Swappable so screen tests never reach the network. See [Tickets] for the pattern. */
object Moods {

    @Volatile
    var gateway: (token: String?) -> MoodGateway = { token -> MoodApi(token) }
}

class MoodApi(private val token: String?) : MoodGateway {

    /**
     * The server answers 404 when nobody has checked in that day. That is an ordinary
     * "nothing yet", not a failure, so it maps to null rather than an error.
     */
    override suspend fun forDate(employeeId: String, dateIso: String): Result<MoodEntry?> =
        HttpJson.get("$PATH?employeeId=$employeeId&date=$dateIso", token)
            .map { it.toEntry() }
            .recoverIfNotFound()

    override suspend fun upsert(
        employeeId: String,
        dateIso: String,
        entry: MoodEntry,
    ): Result<MoodEntry> =
        HttpJson.post(
            path = PATH,
            body = JSONObject()
                .put("employeeId", employeeId)
                .put("dateIso", dateIso)
                .put("mood", entry.mood.name)
                .put("reasons", JSONArray(entry.reasons.toList()))
                .apply { if (entry.note.isNotBlank()) put("note", entry.note) },
            token = token,
        ).mapCatching {
            it.toEntry() ?: throw ApiException(ApiFailure.Unusable("mood save returned no entry"))
        }

    /**
     * HR's view, keyed by employee.
     *
     * The note is deliberately absent — confirmed against the live endpoint, which
     * returns only employeeId, dateIso, mood, reasons and trendValue. HR sees the mood
     * and the reason tags, never what someone wrote for themselves.
     */
    override suspend fun hrForDate(dateIso: String): Result<Map<String, MoodEntry>> =
        HttpJson.getArray("$HR_PATH?date=$dateIso", token).map { rows ->
            buildMap {
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    val id = row.optString("employeeId").takeIf { it.isNotBlank() } ?: continue
                    row.toEntry()?.let { put(id, it) }
                }
            }
        }

    private fun JSONObject.toEntry(): MoodEntry? {
        val mood = runCatching { MoodKey.valueOf(optString("mood")) }.getOrNull() ?: return null
        val reasons = optJSONArray("reasons")
        return MoodEntry(
            dateIso = optString("dateIso"),
            mood = mood,
            reasons = (0 until (reasons?.length() ?: 0))
                .mapNotNull { reasons?.optString(it)?.takeIf(String::isNotBlank) }
                .toSet(),
            note = optString("note"),
        )
    }

    private companion object {
        const val PATH = "/api/mood"
        const val HR_PATH = "/api/hr/mood"
    }
}

/**
 * Mood, server-first with the device as a cache.
 *
 * Same shape as [TicketRepository]: screens render synchronously off the local store,
 * so each fetch mirrors the server's answer into it. Mood matters across devices
 * because HR reads it from theirs.
 */
class MoodRepository(context: Context, private val token: String?) {

    private val store = MoodStore(context)
    private val api = Moods.gateway(token)

    fun cached(employeeId: String, dateIso: String): MoodEntry? = store.entry(employeeId, dateIso)

    fun hasCheckedIn(employeeId: String, dateIso: String): Boolean =
        store.hasCheckedIn(employeeId, dateIso)

    suspend fun refresh(employeeId: String, dateIso: String): Boolean {
        if (token == null) return false
        return api.forDate(employeeId, dateIso)
            .onSuccess { entry ->
                if (entry == null) store.clear(employeeId, dateIso)
                else store.save(employeeId, dateIso, entry.mood, entry.reasons, entry.note)
            }
            .onFailure { Log.w(TAG, "Could not refresh mood for $employeeId", it) }
            .isSuccess
    }

    /**
     * Saves locally first, then to the server.
     *
     * Local-first because a check-in is a two-second interaction the employee should
     * never have to wait on, and because the private note lives on this device anyway.
     * The return value says whether the server also has it.
     */
    suspend fun save(
        employeeId: String,
        dateIso: String,
        mood: MoodKey,
        reasons: Set<String>,
        note: String,
    ): Boolean {
        store.save(employeeId, dateIso, mood, reasons, note)
        if (token == null) return false
        return api.upsert(employeeId, dateIso, MoodEntry(dateIso, mood, reasons, note))
            .onFailure { Log.w(TAG, "Mood saved on device but not on the server", it) }
            .isSuccess
    }

    /** HR's read of everyone's mood for a date, mirrored so the dashboard can total it. */
    suspend fun refreshForHr(dateIso: String): Boolean {
        if (token == null) return false
        return api.hrForDate(dateIso)
            .onSuccess { rows ->
                rows.forEach { (employeeId, entry) ->
                    store.save(employeeId, dateIso, entry.mood, entry.reasons, note = "")
                }
            }
            .onFailure { Log.w(TAG, "Could not refresh HR mood for $dateIso", it) }
            .isSuccess
    }

    private companion object {
        const val TAG = "HrGenieMood"
    }
}

/** 404 means "nothing recorded", which is an answer rather than a failure. */
internal fun <T> Result<T?>.recoverIfNotFound(): Result<T?> = recoverCatching { error ->
    val failure = (error as? ApiException)?.failure
    if (failure is ApiFailure.Http && failure.code == 404) null else throw error
}
