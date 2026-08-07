package com.infinitylearn.hrgenie.data

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.concurrent.TimeUnit

/** What the account may see. The server decides this; the app never infers it. */
enum class AccessRole { EMPLOYEE, HR }

data class Employee(
    val employeeId: String,
    val name: String,
    /** Designation as it appears in Teams, e.g. "Tech Lead-1-Software Engineering". */
    val title: String,
    val department: String,
    val gender: String,
    /** ISO-8601, so it sorts and subtracts without a parser at every call site. */
    val dateOfJoining: String,
    val officialEmail: String,
    val dateOfBirth: String,
    val orgUnit: String,
    val reportees: Int = 0,
    /** "Mr." / "Ms." — sent by the API, absent on the local demo records. */
    val salutation: String = "",
    /** The team within [department], e.g. "Experience" under "Technology". */
    val subDepartment: String = "",
    /**
     * What the server said this account may see. Null for the local demo records,
     * which fall back to the id-prefix rule below.
     */
    val accessRole: AccessRole? = null,
) {
    val firstName: String get() = name.substringBefore(' ')

    /** The team under this person, if any — surfaced only for managers. */
    val isManager: Boolean get() = reportees > 0

    /**
     * HR accounts see the HRBP dashboard instead of the employee app.
     *
     * The server is the authority. The "HR" id-prefix rule is only a fallback for the
     * demo records in [EmployeeDirectory], which predate the auth API — a real account
     * always arrives with [accessRole] set.
     */
    val isHr: Boolean
        get() = accessRole?.let { it == AccessRole.HR }
            ?: employeeId.startsWith(HR_PREFIX, ignoreCase = true)

    /** "2026-04-15" -> "15 Apr 2026", as the HRMS profile card renders it. */
    val dateOfJoiningLabel: String get() = displayDate(dateOfJoining)

    val dateOfBirthLabel: String get() = displayDate(dateOfBirth)

    /**
     * Header subtitle, matching how Teams presents it: title then team.
     *
     * Named apart from [accessRole] on purpose — this is what someone does, that is
     * what they may see.
     */
    val roleLine: String get() = "$title • ${team.ifEmpty { department }}"

    /** The most specific team name available: "Experience" over "Technology". */
    val team: String get() = subDepartment.ifEmpty { department }

    private fun displayDate(iso: String): String {
        val calendar = parseIso(iso) ?: return iso
        return DISPLAY.format(calendar.time)
    }

    /** Days between joining and [today], for the Home subline. */
    fun tenureDays(today: String): Long {
        val start = parseIso(dateOfJoining) ?: return 0
        val end = parseIso(today) ?: return 0
        return TimeUnit.MILLISECONDS.toDays(end.timeInMillis - start.timeInMillis)
    }

    private fun parseIso(value: String): Calendar? = runCatching {
        val parsed = ISO.parse(value) ?: return null
        Calendar.getInstance().apply { time = parsed }
    }.getOrNull()

    private companion object {
        const val HR_PREFIX = "HR"

        // java.time needs API 26 (minSdk is 24), so stay on the legacy formatter.
        val ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val DISPLAY = SimpleDateFormat("dd MMM yyyy", Locale.US)
    }
}

/**
 * The workforce the HR dashboard reports on.
 *
 * **No longer used for sign-in** — that is the HRMS's job now, and the signed-in
 * person's details come entirely from `POST /api/auth/login`. What is left here is
 * the roster the HR side needs to say "3 of 4 checked in", plus the names shown
 * against ticket comments. Both go once there is a directory endpoint.
 *
 * Only the fields those two jobs need are kept. Contact details (mobile, personal
 * email, blood group, marital status) were dropped when the profile stopped showing
 * them — no reason to hold colleagues' personal data the app never displays.
 *
 * **Emails and dates of birth here are placeholders.** The names and roles are real
 * colleagues so the demo reads truthfully, but this repository is public and those
 * two fields are the ones worth protecting. Do not paste the real values back in —
 * git keeps them forever. The signed-in person's real details come from the HRMS at
 * sign-in and are never committed.
 */
object EmployeeDirectory {

    val EMPLOYEES = listOf(
        Employee(
            employeeId = "HYD609552",
            name = "Aamy C P",
            title = "Assistant Manager - HRBP",
            department = "Human Resource & Administration",
            gender = "Female",
            dateOfJoining = "2026-04-15",
            officialEmail = "aamy.cp@example.com",
            dateOfBirth = "1999-01-01",
            orgUnit = "RANKGURU TECHNOLOGY SOLUTIONS PRIVATE LIMITED › Learn 2.0 › " +
                "Human Resources & Administration › HR Business Partner",
        ),
        Employee(
            employeeId = "EMP3801",
            name = "Gunapati Praveen Reddy",
            title = "Tech Lead-2-Software Engineering",
            department = "Technology",
            subDepartment = "Experience",
            gender = "Male",
            dateOfJoining = "2025-10-27",
            officialEmail = "praveen.reddy@example.com",
            dateOfBirth = "1994-01-01",
            orgUnit = "RANKGURU TECHNOLOGY SOLUTIONS PRIVATE LIMITED › Learn 2.0 › " +
                "Technology › Experience",
        ),
        Employee(
            employeeId = "HYD600902",
            name = "Manikanteswar Patnaikuni",
            title = "Tech Lead-1-Software Engineering",
            department = "Technology",
            subDepartment = "Experience",
            gender = "Male",
            dateOfJoining = "2022-08-01",
            officialEmail = "manikanteswar@example.com",
            dateOfBirth = "1995-01-01",
            orgUnit = "RANKGURU TECHNOLOGY SOLUTIONS PRIVATE LIMITED › Learn 2.0 › " +
                "Technology › Experience",
        ),
        Employee(
            employeeId = "HYD600071",
            name = "Mohd Faiyaz",
            title = "Assistant Manager - Graphic Designer",
            department = "Brand Marketing",
            gender = "Male",
            dateOfJoining = "2021-02-01",
            officialEmail = "faiyaz.md@example.com",
            dateOfBirth = "1990-01-01",
            // Inferred from the Teams card: his HRMS profile was cut off above ORGUNIT.
            orgUnit = "RANKGURU TECHNOLOGY SOLUTIONS PRIVATE LIMITED › Learn 2.0 › " +
                "Brand Marketing",
            reportees = 2,
        ),
        // The HR demo account, kept until the HRMS issues real HR logins.
        Employee(
            employeeId = "HR000",
            name = "Aamy C P",
            title = "HR Business Partner",
            department = "Human Resource & Administration",
            gender = "Female",
            dateOfJoining = "2019-06-01",
            officialEmail = "hr@infinitylearn.com",
            dateOfBirth = "1988-01-01",
            orgUnit = "RANKGURU TECHNOLOGY SOLUTIONS PRIVATE LIMITED › Learn 2.0 › " +
                "Human Resources & Administration",
            reportees = 4,
        ),
    )

    /** Everyone the HR dashboard reports on — HR accounts are not their own subject. */
    val WORKFORCE: List<Employee> get() = EMPLOYEES.filterNot { it.isHr }

    /** Case-insensitive so "hyd609552" resolves the same as "HYD609552". */
    fun find(employeeId: String): Employee? =
        EMPLOYEES.firstOrNull { it.employeeId.equals(employeeId.trim(), ignoreCase = true) }

    const val HR_EMAIL = "hr@infinitylearn.com"
}
