package com.infinitylearn.hrgenie

import android.content.Context
import com.infinitylearn.hrgenie.data.AttendanceGateway
import com.infinitylearn.hrgenie.data.AttendanceStore
import com.infinitylearn.hrgenie.data.Celebration
import com.infinitylearn.hrgenie.data.Employee
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.EmployeeGateway
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.MoodEntry
import com.infinitylearn.hrgenie.data.MoodGateway
import com.infinitylearn.hrgenie.data.MoodStore
import com.infinitylearn.hrgenie.data.PulseEntry
import com.infinitylearn.hrgenie.data.PulseGateway
import com.infinitylearn.hrgenie.data.PulseQuestion
import com.infinitylearn.hrgenie.data.PulseStore
import com.infinitylearn.hrgenie.data.ServerWorkDay

/**
 * The mood, pulse, attendance and employee endpoints, standing in for the real ones.
 *
 * Each is backed by the same local store the screens read, so a fake round trip
 * returns what the screen just wrote — which is what the tests are asserting about.
 * Without these, every screen test would make real network calls.
 */

class FakeMoodGateway(context: Context) : MoodGateway {

    private val store = MoodStore(context)

    override suspend fun forDate(employeeId: String, dateIso: String): Result<MoodEntry?> =
        Result.success(store.entry(employeeId, dateIso))

    override suspend fun upsert(
        employeeId: String,
        dateIso: String,
        entry: MoodEntry,
    ): Result<MoodEntry> = Result.success(entry)

    override suspend fun hrForDate(dateIso: String): Result<Map<String, MoodEntry>> =
        Result.success(
            EmployeeDirectory.WORKFORCE.mapNotNull { employee ->
                store.entry(employee.employeeId, dateIso)?.let { employee.employeeId to it }
            }.toMap()
        )
}

class FakePulseGateway(context: Context) : PulseGateway {

    private val store = PulseStore(context)

    override suspend fun forCycle(employeeId: String, cycle: String): Result<PulseEntry?> =
        Result.success(store.entry(employeeId, cycle))

    override suspend fun submit(
        employeeId: String,
        cycle: String,
        answers: Map<String, String>,
    ): Result<PulseEntry> =
        Result.success(PulseEntry(cycle, System.currentTimeMillis(), answers))

    override suspend fun questions(): Result<List<PulseQuestion>> =
        Result.success(HrGenieContent.PULSE_QUESTIONS)

    override suspend fun hrForCycle(cycle: String): Result<Map<String, PulseEntry>> =
        Result.success(
            EmployeeDirectory.WORKFORCE.mapNotNull { employee ->
                store.entry(employee.employeeId, cycle)?.let { employee.employeeId to it }
            }.toMap()
        )
}

/**
 * Attendance, punching against the local store.
 *
 * Unlike mood and pulse, the real repository treats the server as the authority for a
 * punch and only falls back locally on failure — so this fake has to actually record
 * the punch, or the card would never show a check-in during a test.
 */
class FakeAttendanceGateway(context: Context) : AttendanceGateway {

    private val store = AttendanceStore(context)

    override suspend fun range(
        employeeId: String,
        from: String,
        to: String,
    ): Result<List<ServerWorkDay>> = Result.success(emptyList())

    override suspend fun checkIn(employeeId: String): Result<ServerWorkDay> {
        val now = System.currentTimeMillis()
        store.checkIn(employeeId, HrGenieContent.todayIso, now)
        return Result.success(
            ServerWorkDay(HrGenieContent.todayIso, null, now, null, regularized = false)
        )
    }

    override suspend fun checkOut(employeeId: String): Result<ServerWorkDay> {
        val now = System.currentTimeMillis()
        val day = store.today(employeeId, HrGenieContent.todayIso)
        store.checkOut(employeeId, HrGenieContent.todayIso, now)
        return Result.success(
            ServerWorkDay(
                dateIso = HrGenieContent.todayIso,
                status = null,
                checkInMillis = day?.checkInMillis ?: now,
                checkOutMillis = now,
                regularized = false,
            )
        )
    }

    override suspend fun regularize(employeeId: String, dates: Set<String>): Result<Unit> =
        Result.success(Unit)

    override suspend fun hrRange(
        from: String,
        to: String,
    ): Result<Map<String, List<ServerWorkDay>>> = Result.success(emptyMap())
}

class FakeEmployeeGateway : EmployeeGateway {

    override suspend fun me(): Result<Employee> =
        Result.success(EmployeeDirectory.EMPLOYEES.first())

    override suspend fun list(): Result<List<Employee>> =
        Result.success(EmployeeDirectory.EMPLOYEES)

    override suspend fun celebrations(): Result<List<Celebration>> = Result.success(emptyList())
}
