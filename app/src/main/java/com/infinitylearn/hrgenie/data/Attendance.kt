package com.infinitylearn.hrgenie.data

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * One employee's attendance for a single day.
 *
 * A shift can never be counted past 23:59:59.999 of the day it started: if someone
 * forgets to check out, the day closes itself at that boundary rather than running
 * into tomorrow.
 */
data class WorkDay(
    val dateIso: String,
    val checkInMillis: Long,
    val checkOutMillis: Long? = null,
) {
    val isOpen: Boolean get() = checkOutMillis == null

    /** 23:59:59.999 on the day the shift started — the latest a day can close. */
    val dayEndMillis: Long
        get() = Calendar.getInstance().apply {
            timeInMillis = checkInMillis
            set(Calendar.HOUR_OF_DAY, 23)
            set(Calendar.MINUTE, 59)
            set(Calendar.SECOND, 59)
            set(Calendar.MILLISECOND, 999)
        }.timeInMillis

    /** When the 8th hour is (or was) reached, ignoring the day boundary. */
    val fullDayAtMillis: Long get() = checkInMillis + FULL_DAY_MILLIS

    /** Time on the clock at [now]; frozen at check-out, or at the day boundary. */
    fun workedMillis(now: Long): Long {
        val end = checkOutMillis ?: minOf(now, dayEndMillis)
        return (end - checkInMillis).coerceAtLeast(0L)
    }

    /** An open shift that ran past midnight and was closed for the employee. */
    fun isAutoClosed(now: Long): Boolean = isOpen && now > dayEndMillis

    fun remainingMillis(now: Long): Long =
        (FULL_DAY_MILLIS - workedMillis(now)).coerceAtLeast(0L)

    fun overtimeMillis(now: Long): Long =
        (workedMillis(now) - FULL_DAY_MILLIS).coerceAtLeast(0L)

    fun isFullDayDone(now: Long): Boolean = workedMillis(now) >= FULL_DAY_MILLIS

    /** 0..1 progress towards the 8 hours, for the bar. */
    fun progress(now: Long): Float =
        (workedMillis(now).toFloat() / FULL_DAY_MILLIS).coerceIn(0f, 1f)

    companion object {
        /** Minimum working day: 8 hours. */
        val FULL_DAY_MILLIS: Long = TimeUnit.HOURS.toMillis(8)

        /** Five 8-hour days. */
        val FULL_WEEK_MILLIS: Long = FULL_DAY_MILLIS * 5
    }
}

/** Per-employee attendance, one entry per calendar day, kept for the week view. */
class AttendanceStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    /** The record for one specific day, or null if that day was never started. */
    fun record(employeeId: String, dateIso: String): WorkDay? {
        migrateLegacy(employeeId)
        val checkIn = prefs.getLong(key(employeeId, dateIso, IN), 0L)
        if (checkIn <= 0L) return null
        val checkOut = prefs.getLong(key(employeeId, dateIso, OUT), 0L)
        return WorkDay(dateIso, checkIn, checkOut.takeIf { it > 0L })
    }

    fun today(employeeId: String, todayIso: String): WorkDay? = record(employeeId, todayIso)

    /** Monday to Sunday of the week containing [todayIso]; null where nothing was logged. */
    fun week(employeeId: String, todayIso: String): List<WorkDay?> =
        weekDates(todayIso).map { record(employeeId, it) }

    fun checkIn(employeeId: String, dateIso: String, atMillis: Long) {
        prefs.edit()
            .putLong(key(employeeId, dateIso, IN), atMillis)
            .remove(key(employeeId, dateIso, OUT))
            .commit()
    }

    fun checkOut(employeeId: String, dateIso: String, atMillis: Long) {
        prefs.edit().putLong(key(employeeId, dateIso, OUT), atMillis).commit()
    }

    fun regularizationRequests(employeeId: String): Set<String> =
        prefs.getStringSet(key(employeeId, REGULARIZED), emptySet()).orEmpty()

    fun requestRegularization(employeeId: String, dates: Set<String>) {
        val merged = regularizationRequests(employeeId) + dates
        prefs.edit().putStringSet(key(employeeId, REGULARIZED), merged).commit()
    }

    /** Removes one day's record. Used by the demo seeder to reset cleanly. */
    fun clear(employeeId: String, dateIso: String) {
        prefs.edit()
            .remove(key(employeeId, dateIso, IN))
            .remove(key(employeeId, dateIso, OUT))
            .commit()
    }

    /**
     * Earlier builds kept a single unscoped record. Fold it into the dated scheme so
     * an in-progress day isn't lost on upgrade.
     */
    private fun migrateLegacy(employeeId: String) {
        val legacyDate = prefs.getString(key(employeeId, LEGACY_DATE), null) ?: return
        val checkIn = prefs.getLong(key(employeeId, LEGACY_IN), 0L)
        val checkOut = prefs.getLong(key(employeeId, LEGACY_OUT), 0L)
        val edit = prefs.edit()
            .remove(key(employeeId, LEGACY_DATE))
            .remove(key(employeeId, LEGACY_IN))
            .remove(key(employeeId, LEGACY_OUT))
        if (checkIn > 0L) {
            edit.putLong(key(employeeId, legacyDate, IN), checkIn)
            if (checkOut > 0L) edit.putLong(key(employeeId, legacyDate, OUT), checkOut)
        }
        edit.commit()
    }

    private fun key(employeeId: String, dateIso: String, suffix: String) =
        "${employeeId.lowercase(Locale.ROOT)}_${dateIso}_$suffix"

    private fun key(employeeId: String, suffix: String) =
        "${employeeId.lowercase(Locale.ROOT)}_$suffix"

    private companion object {
        const val FILE_NAME = "hr_genie_attendance"
        const val IN = "in"
        const val OUT = "out"
        const val REGULARIZED = "regularized"
        const val LEGACY_DATE = "date"
        const val LEGACY_IN = "in"
        const val LEGACY_OUT = "out"
    }
}

private val ISO_DATE = SimpleDateFormat("yyyy-MM-dd", Locale.US)

/** The seven ISO dates of the Monday-to-Sunday week containing [todayIso]. */
fun weekDates(todayIso: String): List<String> {
    val calendar = Calendar.getInstance()
    runCatching { ISO_DATE.parse(todayIso) }.getOrNull()?.let { calendar.time = it }

    // Walk back to Monday regardless of the locale's first day of week.
    val offset = (calendar.get(Calendar.DAY_OF_WEEK) - Calendar.MONDAY + 7) % 7
    calendar.add(Calendar.DAY_OF_YEAR, -offset)

    return (0 until 7).map {
        ISO_DATE.format(calendar.time).also { calendar.add(Calendar.DAY_OF_YEAR, 1) }
    }
}

/** Initials for the Monday-first week strip. */
val WEEK_DAY_INITIALS = listOf("M", "T", "W", "T", "F", "S", "S")

/** How a single day ended up, once the rules are applied. */
enum class AttendanceStatus(val code: String) {
    PRESENT("P"),
    HALF_DAY("HD"),
    /** Checked in, never checked out, and the day is over. */
    MIS_PUNCH("MIS"),
    ABSENT("A"),
    WEEK_OFF("WO"),
    HOLIDAY("H"),
    /** Today, still on the clock. */
    IN_PROGRESS("IN"),
    /** Today before check-in, or a day still to come. */
    PENDING("--"),
}

data class AttendanceDay(
    val dateIso: String,
    val status: AttendanceStatus,
    val record: WorkDay?,
    val workedMillis: Long,
    val holidayName: String? = null,
    val regularizationRequested: Boolean = false,
) {
    /** Only a missed punch or an absence is worth raising with HR. */
    val canRegularize: Boolean
        get() = !regularizationRequested &&
            (status == AttendanceStatus.MIS_PUNCH || status == AttendanceStatus.ABSENT)
}

/** Saturday and Sunday are the weekly off. */
fun isWeekend(dateIso: String): Boolean {
    val calendar = calendarFor(dateIso) ?: return false
    val day = calendar.get(Calendar.DAY_OF_WEEK)
    return day == Calendar.SATURDAY || day == Calendar.SUNDAY
}

/** "Mon 03 Aug" */
fun formatDayLabel(dateIso: String): String {
    val calendar = calendarFor(dateIso) ?: return dateIso
    return SimpleDateFormat("EEE dd MMM", Locale.getDefault()).format(calendar.time)
}

/** "3 – 9 Aug 2026" */
fun formatWeekRange(dates: List<String>): String {
    val start = calendarFor(dates.first()) ?: return ""
    val end = calendarFor(dates.last()) ?: return ""
    val startFormat = SimpleDateFormat("d MMM", Locale.getDefault())
    val endFormat = SimpleDateFormat("d MMM yyyy", Locale.getDefault())
    return "${startFormat.format(start.time)} – ${endFormat.format(end.time)}"
}

private fun calendarFor(dateIso: String): Calendar? =
    runCatching { ISO_DATE.parse(dateIso) }.getOrNull()
        ?.let { Calendar.getInstance().apply { time = it } }

/**
 * Applies the attendance rules to one week.
 *
 * Weekends and company holidays are off. A day with no record is absent once it has
 * passed, pending while it is still today or ahead. A shift left open past midnight
 * is a missed punch. Otherwise eight hours or more is present, and anything less is
 * a half day.
 */
fun buildWeekReport(
    dates: List<String>,
    records: List<WorkDay?>,
    todayIso: String,
    now: Long,
    requestedDates: Set<String> = emptySet(),
): List<AttendanceDay> = dates.mapIndexed { index, dateIso ->
    val record = records.getOrNull(index)
    val worked = record?.workedMillis(now) ?: 0L
    val holiday = HrGenieContent.HOLIDAYS.firstOrNull { it.isoDate == dateIso }

    val status = when {
        isWeekend(dateIso) -> AttendanceStatus.WEEK_OFF
        holiday != null -> AttendanceStatus.HOLIDAY
        record == null -> if (dateIso < todayIso) {
            AttendanceStatus.ABSENT
        } else {
            AttendanceStatus.PENDING
        }
        record.isOpen && record.isAutoClosed(now) -> AttendanceStatus.MIS_PUNCH
        record.isOpen -> AttendanceStatus.IN_PROGRESS
        worked >= WorkDay.FULL_DAY_MILLIS -> AttendanceStatus.PRESENT
        else -> AttendanceStatus.HALF_DAY
    }

    AttendanceDay(
        dateIso = dateIso,
        status = status,
        record = record,
        workedMillis = worked,
        holidayName = holiday?.name,
        regularizationRequested = dateIso in requestedDates,
    )
}

/** "07:23:11" — always hours:minutes:seconds so the width doesn't jump. */
fun formatCountdown(millis: Long): String {
    val total = millis.coerceAtLeast(0L) / 1000
    return String.format(
        Locale.US, "%02d:%02d:%02d",
        total / 3600, (total % 3600) / 60, total % 60,
    )
}

/** "8h 12m", or "12m" under an hour — for prose rather than the ticking display. */
fun formatDuration(millis: Long): String {
    val minutes = millis.coerceAtLeast(0L) / 60_000
    val hours = minutes / 60
    return if (hours > 0) "${hours}h ${minutes % 60}m" else "${minutes}m"
}

/** "5:32 PM" */
fun formatClock(millis: Long): String =
    SimpleDateFormat("h:mm a", Locale.getDefault())
        .format(Date(millis))
        .uppercase(Locale.getDefault())
