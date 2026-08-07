package com.infinitylearn.hrgenie.data

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.Random
import java.util.concurrent.TimeUnit

/**
 * Backfills a fortnight of history so the HR screens have something to show.
 *
 * Demo tooling, not a feature: it is only reachable from a debug build, and it writes
 * to the same stores the app writes to, so nothing here is a special case downstream.
 *
 * The data is generated from a fixed seed, so a reseed produces the same fortnight
 * every time — a demo that reshuffles under you is worse than no demo.
 */
class DemoSeeder(private val context: Context) {

    private val moods = MoodStore(context)
    private val pulses = PulseStore(context)
    private val attendance = AttendanceStore(context)
    private val tickets = TicketStore(context)

    /**
     * Writes [days] of mood, attendance, several pulse cycles and a few tickets.
     *
     * Today is left alone: whoever is demoing has usually just checked in by hand,
     * and overwriting that under them is disorienting.
     */
    fun seed(days: Int = DAYS, today: String = HrGenieContent.todayIso): Int {
        val random = Random(SEED)
        val workforce = EmployeeDirectory.WORKFORCE
        var written = 0

        // Oldest first so the ticket ids come out in a sensible order.
        (days downTo 1).forEach { ago ->
            val date = shift(today, -ago) ?: return@forEach
            if (isWeekend(date)) return@forEach

            workforce.forEachIndexed { index, employee ->
                written += seedDay(employee, date, ago, index, random)
            }
        }

        seedPulses(workforce, today, random)
        seedTickets(workforce, today)
        return written
    }

    // ------------------------------------------------------------- one day, one person

    private fun seedDay(
        employee: Employee,
        date: String,
        ago: Int,
        index: Int,
        random: Random,
    ): Int {
        // Not everyone answers every day — the gaps are what make the trend honest.
        if (random.nextInt(100) < SKIP_PERCENT) return 0

        moods.save(
            employeeId = employee.employeeId,
            dateIso = date,
            mood = moodFor(ago, index, random),
            reasons = reasonsFor(random),
            note = "",
        )
        seedAttendance(employee, date, ago, random)
        return 1
    }

    /**
     * A dip in the middle of the window, recovering towards today. A flat trend shows
     * the chart works; a shaped one shows what it is for.
     */
    private fun moodFor(ago: Int, index: Int, random: Random): MoodKey {
        val dip = ago in DIP_RANGE
        val roll = random.nextInt(100) + if (dip) -35 else 0
        return when {
            roll >= 70 -> MoodKey.GREAT
            roll >= 45 -> MoodKey.GOOD
            roll >= 20 -> MoodKey.OKAY
            roll >= 0 -> MoodKey.STRESSED
            // One person carries the rough patch, so a department average moves.
            index == 0 -> MoodKey.BURNT_OUT
            else -> MoodKey.STRESSED
        }
    }

    private fun reasonsFor(random: Random): Set<String> =
        HrGenieContent.REASONS.shuffled(kotlin.random.Random(random.nextLong()))
            .take(random.nextInt(3))
            .toSet()

    private fun seedAttendance(employee: Employee, date: String, ago: Int, random: Random) {
        val start = atHour(date, IN_HOUR, random.nextInt(50)) ?: return

        // One forgotten check-out and one short day across the fortnight, so the
        // attendance roll-up has something other than clean full days in it.
        val misPunch = ago == MIS_PUNCH_DAY && employee.employeeId == MIS_PUNCH_EMPLOYEE
        val halfDay = ago == HALF_DAY_DAY && employee.employeeId == HALF_DAY_EMPLOYEE

        attendance.checkIn(employee.employeeId, date, start)
        if (misPunch) return

        val worked = if (halfDay) HALF_DAY_HOURS else FULL_DAY_HOURS
        attendance.checkOut(
            employee.employeeId,
            date,
            start + TimeUnit.HOURS.toMillis(worked) + TimeUnit.MINUTES.toMillis(
                random.nextInt(40).toLong()
            ),
        )
    }

    // ------------------------------------------------------------------------ pulses

    /** Past cycles run high; the current one is deliberately left half done. */
    private fun seedPulses(workforce: List<Employee>, today: String, random: Random) {
        val current = HrGenieContent.currentCycle
        val cycles = (PULSE_CYCLES downTo 1).mapNotNull { shiftMonths(current, -it) } + current

        cycles.forEach { cycle ->
            val isCurrent = cycle == current
            workforce.forEachIndexed { index, employee ->
                if (isCurrent && index % 2 == 1) return@forEachIndexed
                if (!isCurrent && random.nextInt(100) < PULSE_SKIP_PERCENT) return@forEachIndexed

                pulses.save(
                    employeeId = employee.employeeId,
                    cycle = cycle,
                    answers = HrGenieContent.PULSE_QUESTIONS.associate { question ->
                        question.id to question.options[random.nextInt(question.options.size)]
                    },
                    completedAtMillis = atHour(cycleDate(cycle, today), 11, 0) ?: 0L,
                )
            }
        }
    }

    /** The 5th of that month, or today when the cycle is the current one. */
    private fun cycleDate(cycle: String, today: String): String =
        if (cycle == HrGenieContent.currentCycle) today else "$cycle-05"

    // ----------------------------------------------------------------------- tickets

    private fun seedTickets(workforce: List<Employee>, today: String) {
        if (tickets.all().isNotEmpty()) return

        val now = atHour(today, 10, 0) ?: System.currentTimeMillis()
        val raised = SAMPLE_TICKETS.mapIndexed { index, (subject, category) ->
            val employee = workforce[index % workforce.size]
            tickets.raise(
                employeeId = employee.employeeId,
                subject = subject,
                category = category,
                now = now - TimeUnit.DAYS.toMillis((index + 1).toLong()),
            )
        }

        raised.getOrNull(0)?.let {
            tickets.updateStatus(
                it.id, TicketStatus.IN_PROGRESS,
                comment = "Chased payroll — they are re-running it this cycle.",
                authorId = HR_ACTOR, now = now - TimeUnit.HOURS.toMillis(20),
            )
        }
        raised.getOrNull(2)?.let {
            tickets.updateStatus(
                it.id, TicketStatus.RESOLVED,
                comment = "New access granted. Sign out and back in to pick it up.",
                authorId = HR_ACTOR, now = now - TimeUnit.HOURS.toMillis(6),
            )
        }
    }

    /** Wipes everything this seeder writes, so a demo can be run again clean. */
    fun clear() {
        val workforce = EmployeeDirectory.WORKFORCE
        val today = HrGenieContent.todayIso
        (0..DAYS).forEach { ago ->
            val date = shift(today, -ago) ?: return@forEach
            workforce.forEach { employee ->
                moods.clear(employee.employeeId, date)
                attendance.clear(employee.employeeId, date)
            }
        }
        val current = HrGenieContent.currentCycle
        ((PULSE_CYCLES downTo 0).mapNotNull { shiftMonths(current, -it) }).forEach { cycle ->
            workforce.forEach { pulses.clear(it.employeeId, cycle) }
        }
        tickets.clear()
    }

    // ---------------------------------------------------------------------- plumbing

    private fun shift(dateIso: String, days: Int): String? {
        val calendar = calendarFor(dateIso) ?: return null
        calendar.add(Calendar.DAY_OF_YEAR, days)
        return ISO.format(calendar.time)
    }

    private fun shiftMonths(cycle: String, months: Int): String? {
        val parsed = runCatching { CYCLE.parse(cycle) }.getOrNull() ?: return null
        val calendar = Calendar.getInstance().apply { time = parsed }
        calendar.add(Calendar.MONTH, months)
        return CYCLE.format(calendar.time)
    }

    private fun atHour(dateIso: String, hour: Int, minute: Int): Long? {
        val calendar = calendarFor(dateIso) ?: return null
        calendar.set(Calendar.HOUR_OF_DAY, hour)
        calendar.set(Calendar.MINUTE, minute)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis
    }

    private fun calendarFor(dateIso: String): Calendar? =
        runCatching { ISO.parse(dateIso) }.getOrNull()
            ?.let { Calendar.getInstance().apply { time = it } }

    private companion object {
        /** Fixed, so reseeding reproduces the same fortnight. */
        const val SEED = 20260807L

        const val DAYS = 14
        const val PULSE_CYCLES = 4

        /** Share of working days a person does not check in. */
        const val SKIP_PERCENT = 28
        const val PULSE_SKIP_PERCENT = 20

        /** Days ago that the mood dips, so the trend has a shape worth reading. */
        val DIP_RANGE = 6..9

        const val IN_HOUR = 9
        const val FULL_DAY_HOURS = 8L
        const val HALF_DAY_HOURS = 4L
        const val MIS_PUNCH_DAY = 4
        const val MIS_PUNCH_EMPLOYEE = "HYD600902"
        const val HALF_DAY_DAY = 8
        const val HALF_DAY_EMPLOYEE = "HYD600071"

        const val HR_ACTOR = "HR000"

        val SAMPLE_TICKETS = listOf(
            "My salary got deducted without a reason" to "Payroll",
            "Can I carry forward unused earned leave?" to "Leave",
            "No access to the design drive" to "IT & access",
            "Add my spouse to the insurance policy" to "Insurance",
        )

        // java.time needs API 26 (minSdk is 24), so stay on the legacy formatters.
        val ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val CYCLE = SimpleDateFormat("yyyy-MM", Locale.US)
    }
}
