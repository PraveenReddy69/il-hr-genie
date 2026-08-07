package com.infinitylearn.hrgenie.data

import com.infinitylearn.hrgenie.data.AuthApi.Companion.toEmployee
import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONArray

/** Someone with a birthday or a work anniversary in the next few days. */
data class Celebration(
    val employee: Employee,
    val kind: Kind,
    val dateIso: String,
    /** Years completed, for an anniversary. Zero for a birthday or a new joiner. */
    val years: Int = 0,
) {
    enum class Kind { BIRTHDAY, ANNIVERSARY, NEW_JOINER }
}

/** What [Employees] serves. Implemented by [EmployeeApi]. */
interface EmployeeGateway {
    suspend fun me(): Result<Employee>
    /** The directory. HR sees everyone; an employee sees only themselves. */
    suspend fun list(): Result<List<Employee>>
    suspend fun celebrations(): Result<List<Celebration>>
}

/** Swappable so screen tests never reach the network. */
object Employees {

    @Volatile
    var gateway: (token: String?) -> EmployeeGateway = { token -> EmployeeApi(token) }
}

class EmployeeApi(private val token: String?) : EmployeeGateway {

    override suspend fun me(): Result<Employee> =
        HttpJson.get("$PATH/me", token).map { it.toEmployee() }

    /**
     * The directory.
     *
     * `/employees` is HR-only and returns the whole workforce as a bare array; the
     * paged `/employees/list` works for everyone but caps at 200 a page and, for an
     * employee, holds only their own record. Try the full one, fall back to the paged.
     */
    override suspend fun list(): Result<List<Employee>> =
        HttpJson.getArray(PATH, token)
            .map { it.toEmployees() }
            .recoverCatching {
                HttpJson.get("$PATH/list?page=1&limit=$PAGE_LIMIT", token)
                    .map { json -> json.optJSONArray("items").toEmployees() }
                    .getOrThrow()
            }

    /**
     * Today's birthdays, anniversaries and new joiners.
     *
     * The response splits them into three arrays rather than tagging each row, so the
     * kind comes from which array it arrived in.
     */
    override suspend fun celebrations(): Result<List<Celebration>> =
        HttpJson.get("$PATH/celebrations", token).map { json ->
            val today = json.optString("date")
            buildList {
                addAll(json.optJSONArray("birthdays").toCelebrations(Celebration.Kind.BIRTHDAY, today))
                addAll(
                    json.optJSONArray("anniversaries")
                        .toCelebrations(Celebration.Kind.ANNIVERSARY, today)
                )
                addAll(
                    json.optJSONArray("newJoiners")
                        .toCelebrations(Celebration.Kind.NEW_JOINER, today)
                )
            }
        }

    private fun JSONArray?.toEmployees(): List<Employee> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { index ->
            optJSONObject(index)?.toEmployee()?.takeIf { it.employeeId.isNotBlank() }
        }
    }

    private fun JSONArray?.toCelebrations(
        kind: Celebration.Kind,
        today: String,
    ): List<Celebration> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { index ->
            val row = optJSONObject(index) ?: return@mapNotNull null
            val employee = row.toEmployee().takeIf { it.employeeId.isNotBlank() }
                ?: return@mapNotNull null
            val date = when (kind) {
                Celebration.Kind.BIRTHDAY -> employee.dateOfBirth
                else -> employee.dateOfJoining
            }
            Celebration(
                employee = employee,
                kind = kind,
                dateIso = date.ifBlank { today },
                years = row.optInt("years"),
            )
        }
    }

    private companion object {
        const val PATH = "/api/employees"

        /** The server rejects anything above 200. */
        const val PAGE_LIMIT = 200
    }
}
