package com.infinitylearn.hrgenie.data

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Which headline figure a drill-down is expanding. */
enum class HrDetailKind {
    CHECKED_IN,
    ON_THE_CLOCK,
    MOOD,
    PULSE,
    ATTENDANCE,
    DEPARTMENT,

    /** Mood on a past date; the argument carries the ISO date. */
    MOOD_ON_DATE,

    /** Pulse for a past cycle; the argument carries the yyyy-MM cycle. */
    PULSE_IN_CYCLE,
}

/** One day of the mood trend. */
data class DayMood(
    val dateIso: String,
    val responses: Int,
    /** 0..10, null when nobody checked in that day. */
    val score: Double?,
) {
    val hasData: Boolean get() = score != null
}

/** One month of the pulse. */
data class CycleSummary(
    val cycle: String,
    val completed: Int,
    val headcount: Int,
) {
    val rate: Int get() = if (headcount == 0) 0 else (completed * 100) / headcount
}

/** How a cohort answered one pulse question. */
data class QuestionBreakdown(
    val questionId: String,
    val question: String,
    /** Option to how many chose it, in the order the options are offered. */
    val answers: List<Pair<String, Int>>,
) {
    val responses: Int get() = answers.sumOf { it.second }
}

/** How a drill-down row's trailing value should be coloured. */
enum class EntryTone { NEUTRAL, POSITIVE, WARNING, MUTED }

/** One person behind a headline figure. */
data class PersonEntry(
    val employee: Employee,
    val subtitle: String,
    val value: String,
    val tone: EntryTone,
    /** Label to value, revealed when the row is expanded. Empty means no detail. */
    val breakdown: List<Pair<String, String>> = emptyList(),
) {
    val isExpandable: Boolean get() = breakdown.isNotEmpty()

    val initials: String
        get() = employee.name.split(' ')
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
}

/** A department's mood, averaged over the people in it who have checked in. */
data class DepartmentMood(
    val name: String,
    val headcount: Int,
    val responses: Int,
    /** 0..10, null when nobody in the department has checked in today. */
    val score: Double?,
)

/**
 * Everything the HRBP dashboard shows, derived from what is actually on the device.
 *
 * With a workforce this small there is nothing to fabricate: every figure here counts
 * real records, and anything with no data reports as such rather than guessing.
 */
data class HrStats(
    val headcount: Int,
    val checkedInToday: Int,
    val onTheClock: Int,
    val moodResponsesToday: Int,
    /** Average of today's moods on a 0..10 scale; null until someone checks in. */
    val engagementScore: Double?,
    val moodBreakdown: Map<MoodKey, Int>,
    val pulseCompleted: Int,
    val departments: List<DepartmentMood>,
    val weekPresent: Int,
    val weekHalfDays: Int,
    val weekMisPunches: Int,
    val weekAbsences: Int,
    val weekHoursMillis: Long,
    /** Newest first. Raised from chat; the dashboard only reads them. */
    val tickets: List<Ticket>,
) {
    val ticketsOpen: Int get() = tickets.count { it.status == TicketStatus.OPEN }

    val ticketsInProgress: Int
        get() = tickets.count { it.status == TicketStatus.IN_PROGRESS }

    val ticketsResolved: Int get() = tickets.count { it.status == TicketStatus.RESOLVED }

    val checkInRate: Int
        get() = if (headcount == 0) 0 else (moodResponsesToday * 100) / headcount

    val pulseRate: Int
        get() = if (headcount == 0) 0 else (pulseCompleted * 100) / headcount

    /**
     * The handoff's non-negotiable: HR-side cohorts report at five or more people.
     * Below that, individual answers would be identifiable.
     */
    val meetsCohortMinimum: Boolean get() = headcount >= MIN_COHORT

    companion object {
        const val MIN_COHORT = 5
    }
}

/** Reads every employee's local records and rolls them up for the HR dashboard. */
class HrAnalytics(context: Context) {

    private val moods = MoodStore(context)
    private val pulses = PulseStore(context)
    private val attendance = AttendanceStore(context)
    private val tickets = TicketStore(context)

    fun stats(now: Long = System.currentTimeMillis()): HrStats {
        val workforce = EmployeeDirectory.WORKFORCE
        val today = HrGenieContent.todayIso
        val cycle = HrGenieContent.currentCycle
        val dates = weekDates(today)

        val todaysMoods = workforce.mapNotNull { moods.entry(it.employeeId, today) }
        val breakdown = MoodKey.entries.associateWith { key ->
            todaysMoods.count { it.mood == key }
        }

        val todaysAttendance = workforce.mapNotNull { attendance.today(it.employeeId, today) }

        var present = 0
        var halfDays = 0
        var misPunches = 0
        var absences = 0
        var hours = 0L
        workforce.forEach { employee ->
            val report = buildWeekReport(
                dates = dates,
                records = attendance.week(employee.employeeId, today),
                todayIso = today,
                now = now,
            )
            report.forEach { day ->
                hours += day.workedMillis
                when (day.status) {
                    AttendanceStatus.PRESENT -> present++
                    AttendanceStatus.HALF_DAY -> halfDays++
                    AttendanceStatus.MIS_PUNCH -> misPunches++
                    AttendanceStatus.ABSENT -> absences++
                    else -> Unit
                }
            }
        }

        return HrStats(
            headcount = workforce.size,
            checkedInToday = todaysAttendance.size,
            onTheClock = todaysAttendance.count { it.isOpen && !it.isAutoClosed(now) },
            moodResponsesToday = todaysMoods.size,
            engagementScore = todaysMoods
                .map { HrGenieContent.mood(it.mood).trendValue.toDouble() }
                .takeIf { it.isNotEmpty() }
                ?.average(),
            moodBreakdown = breakdown,
            pulseCompleted = workforce.count { pulses.hasCompleted(it.employeeId, cycle) },
            departments = departmentMoods(workforce, today),
            weekPresent = present,
            weekHalfDays = halfDays,
            weekMisPunches = misPunches,
            weekAbsences = absences,
            weekHoursMillis = hours,
            tickets = tickets.all(),
        )
    }

    // -------------------------------------------------------------------- history

    /**
     * Mood by day, oldest first, ending today. Days nobody answered are kept with a
     * null score rather than dropped — a gap in the trend is itself the finding.
     */
    fun moodHistory(days: Int = TREND_DAYS, today: String = HrGenieContent.todayIso): List<DayMood> {
        val workforce = EmployeeDirectory.WORKFORCE
        return pastDates(today, days).map { date ->
            val scores = workforce.mapNotNull { moods.entry(it.employeeId, date) }
                .map { HrGenieContent.mood(it.mood).trendValue.toDouble() }
            DayMood(
                dateIso = date,
                responses = scores.size,
                score = scores.takeIf { it.isNotEmpty() }?.average(),
            )
        }
    }

    /** Pulse completion by cycle, oldest first, ending with the current month. */
    fun pulseHistory(
        cycles: Int = TREND_CYCLES,
        current: String = HrGenieContent.currentCycle,
    ): List<CycleSummary> {
        val workforce = EmployeeDirectory.WORKFORCE
        return pastCycles(current, cycles).map { cycle ->
            CycleSummary(
                cycle = cycle,
                completed = workforce.count { pulses.hasCompleted(it.employeeId, cycle) },
                headcount = workforce.size,
            )
        }
    }

    /**
     * How the workforce answered each question in [cycle].
     *
     * Every option is listed, including ones nobody picked, so the shape of the
     * answers is readable rather than just the winners.
     */
    fun pulseBreakdown(cycle: String): List<QuestionBreakdown> {
        val entries = EmployeeDirectory.WORKFORCE.mapNotNull { pulses.entry(it.employeeId, cycle) }
        return HrGenieContent.PULSE_QUESTIONS.map { question ->
            val chosen = entries.mapNotNull { it.answers[question.id] }
            QuestionBreakdown(
                questionId = question.id,
                question = question.text,
                answers = question.options.map { option -> option to chosen.count { it == option } },
            )
        }
    }

    /** [days] dates ending on [today], oldest first. */
    private fun pastDates(today: String, days: Int): List<String> {
        val start = calendarFor(today) ?: return emptyList()
        start.add(Calendar.DAY_OF_YEAR, -(days - 1))
        return (0 until days).map {
            ISO_DAY.format(start.time).also { _ -> start.add(Calendar.DAY_OF_YEAR, 1) }
        }
    }

    /** [count] cycles ending on [current], oldest first. */
    private fun pastCycles(current: String, count: Int): List<String> {
        val start = runCatching { ISO_CYCLE.parse(current) }.getOrNull() ?: return emptyList()
        val calendar = Calendar.getInstance().apply { time = start }
        calendar.add(Calendar.MONTH, -(count - 1))
        return (0 until count).map {
            ISO_CYCLE.format(calendar.time).also { _ -> calendar.add(Calendar.MONTH, 1) }
        }
    }

    private fun calendarFor(dateIso: String): Calendar? =
        runCatching { ISO_DAY.parse(dateIso) }.getOrNull()
            ?.let { Calendar.getInstance().apply { time = it } }

    // ----------------------------------------------------------------- drill-downs

    /**
     * Per-person rows behind a headline figure.
     *
     * These name individuals, including against their mood. That is a deliberate
     * product decision for this build — the aggregate cards above still follow the
     * cohort rule, but HR asked to be able to open a figure and see who it is.
     */
    fun detail(kind: HrDetailKind, argument: String? = null, now: Long = System.currentTimeMillis()):
        List<PersonEntry> {
        val today = HrGenieContent.todayIso
        val workforce = EmployeeDirectory.WORKFORCE
        return when (kind) {
            HrDetailKind.CHECKED_IN -> attendanceToday(workforce, today, now, openOnly = false)
            HrDetailKind.ON_THE_CLOCK -> attendanceToday(workforce, today, now, openOnly = true)
            HrDetailKind.MOOD -> moodRows(workforce, today)
            HrDetailKind.MOOD_ON_DATE -> moodRows(workforce, argument ?: today)
            HrDetailKind.PULSE -> pulseRows(workforce)
            HrDetailKind.PULSE_IN_CYCLE ->
                pulseRows(workforce, argument ?: HrGenieContent.currentCycle)
            HrDetailKind.ATTENDANCE -> weekRows(workforce, today, now)
            HrDetailKind.DEPARTMENT -> moodRows(
                workforce.filter { it.department == argument },
                today,
            )
        }
    }

    private fun attendanceToday(
        workforce: List<Employee>,
        today: String,
        now: Long,
        openOnly: Boolean,
    ): List<PersonEntry> = workforce.mapNotNull { employee ->
        val record = attendance.today(employee.employeeId, today) ?: return@mapNotNull null
        val running = record.isOpen && !record.isAutoClosed(now)
        if (openOnly && !running) return@mapNotNull null

        val worked = formatDuration(record.workedMillis(now))
        PersonEntry(
            employee = employee,
            subtitle = when {
                running -> "In since ${formatClock(record.checkInMillis)} · $worked so far"
                record.isOpen -> "Checked in ${formatClock(record.checkInMillis)} · never checked out"
                else -> "${formatClock(record.checkInMillis)} → " +
                    "${formatClock(record.checkOutMillis ?: record.checkInMillis)} · $worked"
            },
            value = when {
                running -> "On the clock"
                record.isOpen -> "Missed punch"
                record.workedMillis(now) >= WorkDay.FULL_DAY_MILLIS -> "Full day"
                else -> "Half day"
            },
            tone = when {
                running -> EntryTone.POSITIVE
                record.isOpen -> EntryTone.WARNING
                record.workedMillis(now) >= WorkDay.FULL_DAY_MILLIS -> EntryTone.POSITIVE
                else -> EntryTone.WARNING
            },
        )
    }

    private fun moodRows(workforce: List<Employee>, today: String): List<PersonEntry> =
        workforce.map { employee ->
            val entry = moods.entry(employee.employeeId, today)
            val mood = entry?.let { HrGenieContent.mood(it.mood) }
            PersonEntry(
                employee = employee,
                subtitle = when {
                    entry == null -> "Has not checked in today"
                    // Reasons are tags the employee picked from a list. The free-text
                    // note is deliberately not surfaced — the check-in screen promises
                    // it stays with them, and that promise is worth keeping.
                    entry.reasons.isNotEmpty() -> entry.reasons.sorted().joinToString(", ")
                    else -> employee.title
                },
                value = mood?.let { "${it.emoji} ${it.label}" } ?: "—",
                tone = when {
                    mood == null -> EntryTone.MUTED
                    mood.isPositive -> EntryTone.POSITIVE
                    mood.trendValue <= 4 -> EntryTone.WARNING
                    else -> EntryTone.NEUTRAL
                },
            )
        }.sortedBy { it.tone == EntryTone.MUTED }

    private fun pulseRows(
        workforce: List<Employee>,
        cycle: String = HrGenieContent.currentCycle,
    ): List<PersonEntry> {
        return workforce.map { employee ->
            val entry = pulses.entry(employee.employeeId, cycle)
            PersonEntry(
                employee = employee,
                subtitle = if (entry == null) {
                    employee.department
                } else {
                    "${entry.answers.size} of ${HrGenieContent.PULSE_QUESTIONS.size} answered"
                },
                value = if (entry == null) "Pending" else "Done",
                tone = if (entry == null) EntryTone.MUTED else EntryTone.POSITIVE,
                // What they actually answered, question by question. HR asked to see
                // this, so the pulse screens tell employees their answers are shared.
                breakdown = entry?.let { completed ->
                    HrGenieContent.PULSE_QUESTIONS.map { question ->
                        question.text to (completed.answers[question.id] ?: SKIPPED)
                    }
                }.orEmpty(),
            )
        }.sortedBy { it.tone == EntryTone.MUTED }
    }

    private fun weekRows(workforce: List<Employee>, today: String, now: Long): List<PersonEntry> {
        val dates = weekDates(today)
        return workforce.map { employee ->
            val report = buildWeekReport(
                dates = dates,
                records = attendance.week(employee.employeeId, today),
                todayIso = today,
                now = now,
            )
            val worked = report.sumOf { it.workedMillis }
            val full = report.count { it.status == AttendanceStatus.PRESENT }
            val flagged = report.count {
                it.status == AttendanceStatus.MIS_PUNCH || it.status == AttendanceStatus.ABSENT
            }
            PersonEntry(
                employee = employee,
                subtitle = "$full full ${if (full == 1) "day" else "days"}" +
                    if (flagged > 0) " · $flagged to follow up" else "",
                value = formatDuration(worked),
                tone = when {
                    flagged > 0 -> EntryTone.WARNING
                    worked >= WorkDay.FULL_WEEK_MILLIS -> EntryTone.POSITIVE
                    else -> EntryTone.NEUTRAL
                },
            )
        }.sortedByDescending { it.employee.name }
    }

    private fun departmentMoods(workforce: List<Employee>, today: String): List<DepartmentMood> =
        workforce.groupBy { it.department }
            .map { (department, members) ->
                val scores = members.mapNotNull { moods.entry(it.employeeId, today) }
                    .map { HrGenieContent.mood(it.mood).trendValue.toDouble() }
                DepartmentMood(
                    name = department,
                    headcount = members.size,
                    responses = scores.size,
                    score = scores.takeIf { it.isNotEmpty() }?.average(),
                )
            }
            .sortedByDescending { it.score ?: -1.0 }

    private companion object {
        const val SKIPPED = "Skipped"

        /** Two working weeks — long enough to see a slide, short enough to read. */
        const val TREND_DAYS = 14
        const val TREND_CYCLES = 6

        // java.time needs API 26 (minSdk is 24), so stay on the legacy formatters.
        val ISO_DAY = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val ISO_CYCLE = SimpleDateFormat("yyyy-MM", Locale.US)
    }
}
