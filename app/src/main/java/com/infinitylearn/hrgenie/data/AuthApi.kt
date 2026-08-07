package com.infinitylearn.hrgenie.data

import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONObject

/**
 * A signed-in account: who they are, and the token that proves it.
 *
 * [raw] is the server's own employee JSON, kept so [SessionStore] can persist and
 * re-read a session through the same mapper that built it — one parser, no drift
 * between what login produced and what a restart restores.
 */
data class Session(val employee: Employee, val token: String, val raw: String)

/**
 * Sign-in against the HRMS.
 *
 * The server answers a bad password and an unknown employee id with the same 401, on
 * purpose — a different response for each would let anyone test whether an id exists.
 * So the app cannot tell them apart either, and says so in one message.
 */
/**
 * How the app signs in.
 *
 * A seam rather than a direct [AuthApi] call so the screen tests can drive sign-in
 * without a server, the same way chat swaps its knowledge base. Production never
 * reassigns it — there is no offline sign-in, because only the server knows the
 * password.
 */
object Auth {

    @Volatile
    var gateway: suspend (employeeId: String, password: String) -> Result<Session> =
        { employeeId, password -> AuthApi().login(employeeId, password) }

    suspend fun signIn(employeeId: String, password: String): Result<Session> =
        gateway(employeeId, password)
}

class AuthApi {

    suspend fun login(employeeId: String, password: String): Result<Session> =
        HttpJson.post(
            path = LOGIN_PATH,
            body = JSONObject()
                .put("employeeId", employeeId)
                .put("password", password),
        ).mapCatching { json -> json.toSession() }

    private fun JSONObject.toSession(): Session {
        val token = optString("token").takeIf { it.isNotBlank() }
            ?: throw ApiException(ApiFailure.Unusable("login response carried no token"))
        val employee = optJSONObject("employee")
            ?: throw ApiException(ApiFailure.Unusable("login response carried no employee"))
        return Session(employee.toEmployee(), token, employee.toString())
    }

    companion object {
        private const val LOGIN_PATH = "/api/auth/login"

        /**
         * Builds an [Employee] from the API's record.
         *
         * Everything comes from the server. Nothing is topped up from
         * [EmployeeDirectory]: a field the HRMS does not hold is left empty and the
         * profile drops that row, rather than showing a value the HRMS never sent.
         */
        fun JSONObject.toEmployee(): Employee = Employee(
            employeeId = optString("employeeId"),
            name = optString("name"),
            // Two shapes come back from this API: most records carry `designation`,
            // but the HR accounts carry `title`. Reading both keeps HR's own profile
            // from rendering a blank job title.
            title = optString("designation").ifBlank { optString("title") },
            department = optString("department"),
            subDepartment = optString("subDepartment"),
            salutation = optString("salutation"),
            gender = optString("gender"),
            dateOfJoining = optString("dateOfJoining"),
            officialEmail = optString("officialEmail"),
            dateOfBirth = optString("dateOfBirth"),
            // Same story: an `orgUnitPath` array on some records, a pre-joined
            // `orgUnit` string on others.
            orgUnit = optJSONArray("orgUnitPath")
                ?.takeIf { it.length() > 0 }
                ?.let { path ->
                    (0 until path.length()).joinToString(" › ", transform = path::optString)
                }
                ?: optString("orgUnit").replace(">", " › "),
            reportees = optInt("reportees"),
            accessRole = when (optString("role").uppercase()) {
                "HR" -> AccessRole.HR
                else -> AccessRole.EMPLOYEE
            },
        )
    }
}
