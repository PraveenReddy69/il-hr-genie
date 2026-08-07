package com.infinitylearn.hrgenie

import com.infinitylearn.hrgenie.data.AttendanceStatus
import com.infinitylearn.hrgenie.data.WorkDay
import com.infinitylearn.hrgenie.data.buildWeekReport
import com.infinitylearn.hrgenie.data.formatCountdown
import com.infinitylearn.hrgenie.data.formatDuration
import com.infinitylearn.hrgenie.data.weekDates
import java.util.Calendar
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure time arithmetic — no Android framework, so this runs on the plain JVM. */
class AttendanceTest {

    private fun at(hour: Int, minute: Int = 0, second: Int = 0): Long =
        Calendar.getInstance().apply {
            set(2026, Calendar.AUGUST, 7, hour, minute, second)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    private fun day(checkIn: Long, checkOut: Long? = null) =
        WorkDay("2026-08-07", checkIn, checkOut)

    @Test
    fun `counts down towards eight hours`() {
        val shift = day(at(9, 30))
        val twoHoursIn = at(11, 30)

        assertEquals(TimeUnit.HOURS.toMillis(2), shift.workedMillis(twoHoursIn))
        assertEquals(TimeUnit.HOURS.toMillis(6), shift.remainingMillis(twoHoursIn))
        assertEquals(0L, shift.overtimeMillis(twoHoursIn))
        assertFalse(shift.isFullDayDone(twoHoursIn))
        assertEquals("06:00:00", formatCountdown(shift.remainingMillis(twoHoursIn)))
    }

    @Test
    fun `overtime starts from zero the moment eight hours land`() {
        val shift = day(at(9, 0))

        assertTrue(shift.isFullDayDone(at(17, 0)))
        assertEquals(0L, shift.overtimeMillis(at(17, 0)))
        assertEquals(0L, shift.remainingMillis(at(17, 0)))

        assertEquals(TimeUnit.MINUTES.toMillis(45), shift.overtimeMillis(at(17, 45)))
        assertEquals("00:45:00", formatCountdown(shift.overtimeMillis(at(17, 45))))
    }

    @Test
    fun `an open shift never counts past 11 59 59 PM`() {
        val shift = day(at(22, 0))

        // Midnight has passed and there was no check-out.
        val nextMorning = at(23, 59, 59) + TimeUnit.HOURS.toMillis(9)
        assertTrue(shift.isAutoClosed(nextMorning))

        // 22:00 to 23:59:59.999 is just under two hours, and it stops there.
        val worked = shift.workedMillis(nextMorning)
        assertEquals(
            TimeUnit.HOURS.toMillis(2).toDouble(),
            worked.toDouble(),
            TimeUnit.SECONDS.toMillis(1).toDouble(),
        )
        assertEquals(worked, shift.workedMillis(nextMorning + TimeUnit.DAYS.toMillis(3)))
    }

    @Test
    fun `check-out freezes the clock`() {
        val shift = day(at(9, 0), checkOut = at(18, 30))
        val worked = shift.workedMillis(at(23, 0))

        assertEquals(TimeUnit.MINUTES.toMillis(570), worked)
        assertEquals(TimeUnit.MINUTES.toMillis(90), shift.overtimeMillis(at(23, 0)))
        assertFalse(shift.isOpen)
        assertFalse(shift.isAutoClosed(at(23, 0)))
        assertEquals("9h 30m", formatDuration(worked))
    }

    @Test
    fun `leaving early records a shortfall, not overtime`() {
        val shift = day(at(9, 0), checkOut = at(14, 15))

        assertEquals(TimeUnit.MINUTES.toMillis(165), shift.remainingMillis(at(20, 0)))
        assertEquals(0L, shift.overtimeMillis(at(20, 0)))
        assertEquals("5h 15m", formatDuration(shift.workedMillis(at(20, 0))))
    }

    @Test
    fun `the week runs Monday to Sunday and contains today`() {
        // 7 Aug 2026 is a Friday.
        val week = weekDates("2026-08-07")

        assertEquals(7, week.size)
        assertEquals("2026-08-03", week.first())
        assertEquals("2026-08-09", week.last())
        assertTrue(week.contains("2026-08-07"))

        // Sunday belongs to the week that started the previous Monday.
        assertEquals("2026-08-03", weekDates("2026-08-09").first())
        // Monday is its own week's first day.
        assertEquals("2026-08-03", weekDates("2026-08-03").first())
    }

    @Test
    fun `week statuses follow the attendance rules`() {
        val dates = weekDates("2026-08-07")   // Mon 3 Aug .. Sun 9 Aug
        val today = "2026-08-07"              // Friday
        val now = at(15, 0)

        fun onDay(dayOffset: Int, inHour: Int, outHour: Int?) = WorkDay(
            dates[dayOffset],
            at(inHour) - TimeUnit.DAYS.toMillis((4 - dayOffset).toLong()),
            outHour?.let { at(it) - TimeUnit.DAYS.toMillis((4 - dayOffset).toLong()) },
        )

        val report = buildWeekReport(
            dates = dates,
            records = listOf(
                onDay(0, 9, 18),   // Mon: 9 hours -> present
                onDay(1, 9, 13),   // Tue: 4 hours -> half day
                onDay(2, 9, null), // Wed: never checked out -> miss punch
                null,              // Thu: nothing at all -> absent
                onDay(4, 9, null), // Fri (today): still running
                null,              // Sat
                null,              // Sun
            ),
            todayIso = today,
            now = now,
        )

        assertEquals(AttendanceStatus.PRESENT, report[0].status)
        assertEquals(AttendanceStatus.HALF_DAY, report[1].status)
        assertEquals(AttendanceStatus.MIS_PUNCH, report[2].status)
        assertEquals(AttendanceStatus.ABSENT, report[3].status)
        assertEquals(AttendanceStatus.IN_PROGRESS, report[4].status)
        assertEquals(AttendanceStatus.WEEK_OFF, report[5].status)
        assertEquals(AttendanceStatus.WEEK_OFF, report[6].status)

        // Only the gaps can be raised with HR.
        assertTrue(report[2].canRegularize)
        assertTrue(report[3].canRegularize)
        assertFalse(report[0].canRegularize)
        assertFalse(report[5].canRegularize)
    }

    @Test
    fun `a day still ahead is pending, not absent`() {
        val dates = weekDates("2026-08-03")  // Monday
        val report = buildWeekReport(
            dates = dates,
            records = List(7) { null },
            todayIso = "2026-08-03",
            now = at(10, 0),
        )

        assertEquals(AttendanceStatus.PENDING, report[0].status)  // today
        assertEquals(AttendanceStatus.PENDING, report[1].status)  // tomorrow
        assertEquals(AttendanceStatus.WEEK_OFF, report[5].status)
    }

    @Test
    fun `an already requested day cannot be raised twice`() {
        val dates = weekDates("2026-08-07")
        val report = buildWeekReport(
            dates = dates,
            records = List(7) { null },
            todayIso = "2026-08-07",
            now = at(15, 0),
            requestedDates = setOf(dates[3]),
        )

        assertEquals(AttendanceStatus.ABSENT, report[3].status)
        assertTrue(report[3].regularizationRequested)
        assertFalse(report[3].canRegularize)
    }

    @Test
    fun `progress is clamped to the eight hour bar`() {
        val shift = day(at(9, 0))

        assertEquals(0f, shift.progress(at(9, 0)), 0.001f)
        assertEquals(0.5f, shift.progress(at(13, 0)), 0.001f)
        assertEquals(1f, shift.progress(at(21, 0)), 0.001f)
    }
}
