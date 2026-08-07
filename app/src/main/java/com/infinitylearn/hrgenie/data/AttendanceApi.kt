package com.infinitylearn.hrgenie.data

import android.content.Context
import android.util.Log
import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONArray
import org.json.JSONObject

/** One day as the server reports it, already carrying the status it derived. */
data class ServerWorkDay(
    val dateIso: String,
    val status: AttendanceStatus?,
    val checkInMillis: Long?,
    val checkOutMillis: Long?,
    val regularized: Boolean,
)

/** What [AttendanceRepository] needs from a backend. Implemented by [AttendanceApi]. */
interface AttendanceGateway {
    suspend fun range(employeeId: String, from: String, to: String): Result<List<ServerWorkDay>>
    suspend fun checkIn(employeeId: String): Result<ServerWorkDay>
    suspend fun checkOut(employeeId: String): Result<ServerWorkDay>
    suspend fun regularize(employeeId: String, dates: Set<String>): Result<Unit>
    /** Everyone's days in a range. HR only. */
    suspend fun hrRange(from: String, to: String): Result<Map<String, List<ServerWorkDay>>>
}

/** Swappable so screen tests never reach the network. */
object Attendances {

    @Volatile
    var gateway: (token: String?) -> AttendanceGateway = { token -> AttendanceApi(token) }
}

class AttendanceApi(private val token: String?) : AttendanceGateway {

    override suspend fun range(
        employeeId: String,
        from: String,
        to: String,
    ): Result<List<ServerWorkDay>> =
        HttpJson.get("$PATH?employeeId=$employeeId&from=$from&to=$to", token)
            .map { it.optJSONArray("days").toDays() }

    override suspend fun checkIn(employeeId: String): Result<ServerWorkDay> = punch("check-in", employeeId)

    override suspend fun checkOut(employeeId: String): Result<ServerWorkDay> = punch("check-out", employeeId)

    private suspend fun punch(action: String, employeeId: String): Result<ServerWorkDay> =
        HttpJson.post(
            path = "$PATH/$action",
            body = JSONObject().put("employeeId", employeeId),
            token = token,
        ).mapCatching { it.toDay() ?: error("$action returned no day") }

    override suspend fun regularize(employeeId: String, dates: Set<String>): Result<Unit> =
        HttpJson.post(
            path = "$PATH/regularize",
            body = JSONObject()
                .put("employeeId", employeeId)
                .put("dates", JSONArray(dates.toList())),
            token = token,
        ).map { }

    override suspend fun hrRange(
        from: String,
        to: String,
    ): Result<Map<String, List<ServerWorkDay>>> =
        HttpJson.get("$HR_PATH?from=$from&to=$to", token).map { json ->
            val rows = json.optJSONArray("items") ?: json.optJSONArray("records")
            buildMap<String, MutableList<ServerWorkDay>> {
                for (index in 0 until (rows?.length() ?: 0)) {
                    val row = rows?.optJSONObject(index) ?: continue
                    val id = row.optString("employeeId").takeIf { it.isNotBlank() } ?: continue
                    // Either one row per day, or one row per person carrying `days`.
                    val days = row.optJSONArray("days")?.toDays()
                        ?: listOfNotNull(row.toDay())
                    getOrPut(id) { mutableListOf() } += days
                }
            }
        }

    private fun JSONArray?.toDays(): List<ServerWorkDay> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { optJSONObject(it)?.toDay() }
    }

    private fun JSONObject.toDay(): ServerWorkDay? {
        val date = optString("dateIso").takeIf { it.isNotBlank() } ?: return null
        return ServerWorkDay(
            dateIso = date,
            status = runCatching { AttendanceStatus.valueOf(optString("status")) }.getOrNull(),
            // 0 rather than null would read as "checked in at the epoch".
            checkInMillis = optLong("checkInMillis").takeIf { it > 0 },
            checkOutMillis = optLong("checkOutMillis").takeIf { it > 0 },
            regularized = optBoolean("regularized"),
        )
    }

    private companion object {
        const val PATH = "/api/attendance"
        const val HR_PATH = "/api/hr/attendance"
    }
}

/**
 * Attendance, server-first with the device as a cache.
 *
 * The punches themselves go to the server first, unlike mood: a check-in is the one
 * record HR pays people against, so it must not exist only on a phone. The local copy
 * is written from the server's answer, which also fixes the clock — the server's
 * timestamp wins over the device's.
 */
class AttendanceRepository(context: Context, private val token: String?) {

    private val store = AttendanceStore(context)
    private val api = Attendances.gateway(token)

    fun cachedToday(employeeId: String, todayIso: String): WorkDay? =
        store.today(employeeId, todayIso)

    fun cachedWeek(employeeId: String, todayIso: String): List<WorkDay?> =
        store.week(employeeId, todayIso)

    suspend fun refresh(employeeId: String, from: String, to: String): Boolean {
        if (token == null) return false
        return api.range(employeeId, from, to)
            .onSuccess { it.forEach { day -> mirror(employeeId, day) } }
            .onFailure { Log.w(TAG, "Could not refresh attendance for $employeeId", it) }
            .isSuccess
    }

    suspend fun checkIn(employeeId: String, todayIso: String, atMillis: Long): Boolean {
        val result = if (token == null) Result.failure(IllegalStateException("No token")) else api.checkIn(employeeId)
        return result
            .onSuccess { mirror(employeeId, it) }
            .onFailure {
                Log.w(TAG, "Check-in did not reach the server; recording locally", it)
                store.checkIn(employeeId, todayIso, atMillis)
            }
            .isSuccess
    }

    suspend fun checkOut(employeeId: String, todayIso: String, atMillis: Long): Boolean {
        val result = if (token == null) Result.failure(IllegalStateException("No token")) else api.checkOut(employeeId)
        return result
            .onSuccess { mirror(employeeId, it) }
            .onFailure {
                Log.w(TAG, "Check-out did not reach the server; recording locally", it)
                store.checkOut(employeeId, todayIso, atMillis)
            }
            .isSuccess
    }

    suspend fun regularize(employeeId: String, dates: Set<String>): Boolean {
        store.requestRegularization(employeeId, dates)
        if (token == null) return false
        return api.regularize(employeeId, dates)
            .onFailure { Log.w(TAG, "Regularisation saved on device but not on the server", it) }
            .isSuccess
    }

    suspend fun refreshForHr(from: String, to: String): Boolean {
        if (token == null) return false
        return api.hrRange(from, to)
            .onSuccess { byEmployee ->
                byEmployee.forEach { (employeeId, days) ->
                    days.forEach { mirror(employeeId, it) }
                }
            }
            .onFailure { Log.w(TAG, "Could not refresh HR attendance", it) }
            .isSuccess
    }

    /** A day with no punch is cleared, so a deleted record does not linger locally. */
    private fun mirror(employeeId: String, day: ServerWorkDay) {
        val checkIn = day.checkInMillis
        if (checkIn == null) {
            store.clear(employeeId, day.dateIso)
            return
        }
        store.checkIn(employeeId, day.dateIso, checkIn)
        day.checkOutMillis?.let { store.checkOut(employeeId, day.dateIso, it) }
        if (day.regularized) store.requestRegularization(employeeId, setOf(day.dateIso))
    }

    private companion object {
        const val TAG = "HrGenieAttendance"
    }
}
