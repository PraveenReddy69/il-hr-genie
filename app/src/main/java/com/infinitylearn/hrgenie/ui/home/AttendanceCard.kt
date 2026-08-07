package com.infinitylearn.hrgenie.ui.home

import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.AttendanceRepository
import com.infinitylearn.hrgenie.data.AttendanceStatus
import com.infinitylearn.hrgenie.data.AttendanceStore
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.WorkDay
import com.infinitylearn.hrgenie.data.buildWeekReport
import com.infinitylearn.hrgenie.data.formatClock
import com.infinitylearn.hrgenie.data.formatCountdown
import com.infinitylearn.hrgenie.data.formatDuration
import com.infinitylearn.hrgenie.data.weekDates
import com.infinitylearn.hrgenie.databinding.ViewAttendanceCardBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Drives the check-in / check-out card: countdown to eight hours, then overtime
 * counting up from zero, and a one-line wrap-up once the day is closed.
 *
 * Ticks once a second only while a shift is open and the screen is resumed.
 */
class AttendanceCard(
    private val binding: ViewAttendanceCardBinding,
    private val store: AttendanceStore,
    private val repository: AttendanceRepository,
    /** The host fragment's scope: a punch must not outlive the screen. */
    private val scope: CoroutineScope,
    private val onMessage: (CharSequence) -> Unit,
) {
    private val context get() = binding.root.context
    private val handler = Handler(Looper.getMainLooper())

    private var employeeId: String? = null

    /** Guards the one-off "you've hit 8 hours" nudge so it fires once per day. */
    private var announcedFullDay = false

    private val tick = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1_000L)
        }
    }

    fun bind(employeeId: String) {
        this.employeeId = employeeId
        binding.attendanceAction.setOnClickListener { toggle() }
        render()
    }

    fun start() {
        handler.removeCallbacks(tick)
        render()
        if (currentDay()?.isOpen == true) handler.post(tick)
    }

    fun stop() = handler.removeCallbacks(tick)

    private fun currentDay(): WorkDay? =
        employeeId?.let { store.today(it, HrGenieContent.todayIso) }

    // ------------------------------------------------------------------- actions

    /**
     * Punches in or out.
     *
     * The punch goes to the server, which owns the timestamp — this is the record HR
     * pays against, so the device clock must not decide it. The repository falls back
     * to a local write if the call fails, which keeps the card usable and leaves the
     * day to be reconciled on the next refresh.
     */
    private fun toggle() {
        val id = employeeId ?: return
        val now = System.currentTimeMillis()
        val day = currentDay()

        when {
            day == null -> {
                announcedFullDay = false
                scope.launch {
                    repository.checkIn(id, HrGenieContent.todayIso, now)
                    val punched = currentDay()?.checkInMillis ?: now
                    onMessage(
                        context.getString(
                            R.string.attendance_checked_in_toast,
                            formatClock(punched),
                            formatClock(punched + WorkDay.FULL_DAY_MILLIS),
                        )
                    )
                    start()
                }
            }

            day.isOpen -> {
                scope.launch {
                    // Never bank time past the day boundary.
                    repository.checkOut(id, HrGenieContent.todayIso, minOf(now, day.dayEndMillis))
                    stop()
                    render()
                }
            }

            else -> Unit // Already closed for today.
        }
    }

    // ----------------------------------------------------------------- rendering

    fun render() {
        val day = currentDay()
        val now = System.currentTimeMillis()
        renderWeek(now)

        if (day == null) {
            renderIdle()
            return
        }
        if (!day.isOpen || day.isAutoClosed(now)) {
            renderClosed(day, now)
            return
        }
        renderRunning(day, now)
    }

    private fun renderIdle() {
        showWell(idle = true)
        binding.attendanceSummary.visibility = View.GONE
        binding.attendanceNote.visibility = View.VISIBLE

        // Show what checking in right now would commit them to.
        binding.attendanceIdleProjection.text = context.getString(
            R.string.attendance_idle_projection,
            formatClock(System.currentTimeMillis() + WorkDay.FULL_DAY_MILLIS),
        )

        pill(R.string.attendance_status_idle, R.color.text_secondary, R.drawable.bg_dot_muted)
        binding.attendanceAction.visibility = View.VISIBLE
        binding.attendanceAction.setText(R.string.action_check_in)
    }

    /** The well always shows exactly one of its two faces. */
    private fun showWell(idle: Boolean) {
        binding.attendanceWell.visibility = View.VISIBLE
        binding.attendanceIdleBlock.visibility = if (idle) View.VISIBLE else View.GONE
        binding.attendanceRunningBlock.visibility = if (idle) View.GONE else View.VISIBLE
    }

    private fun renderRunning(day: WorkDay, now: Long) {
        showWell(idle = false)
        binding.attendanceSummary.visibility = View.GONE
        binding.attendanceNote.visibility = View.VISIBLE
        binding.attendanceAction.visibility = View.VISIBLE
        binding.attendanceAction.setText(R.string.action_check_out)

        val done = day.isFullDayDone(now)
        if (done) {
            // Overtime counts up from zero the moment the 8th hour lands.
            binding.attendanceTimer.text = formatCountdown(day.overtimeMillis(now))
            binding.attendanceTimerCaption.text = context.getString(
                R.string.attendance_caption_overtime,
                formatClock(day.fullDayAtMillis),
            )
            pill(R.string.attendance_status_overtime, R.color.green_ok, R.drawable.bg_dot_green)
            if (!announcedFullDay) {
                announcedFullDay = true
                onMessage(context.getString(R.string.attendance_full_day_toast))
            }
        } else {
            binding.attendanceTimer.text = formatCountdown(day.remainingMillis(now))
            binding.attendanceTimerCaption.setText(R.string.attendance_caption_remaining)
            pill(R.string.attendance_status_active, R.color.blue_deep, R.drawable.bg_dot_blue)
        }

        binding.attendanceTimer.setTextColor(
            ContextCompat.getColor(context, if (done) R.color.green_ok else R.color.ink)
        )
        binding.attendanceInAt.text =
            context.getString(R.string.attendance_in_at, formatClock(day.checkInMillis))
        binding.attendanceTarget.text =
            context.getString(R.string.attendance_target, formatClock(day.fullDayAtMillis))
        renderProgress(day, now, done)
    }

    private fun renderClosed(day: WorkDay, now: Long) {
        stop()
        binding.attendanceWell.visibility = View.GONE
        binding.attendanceAction.visibility = View.GONE
        binding.attendanceNote.visibility = View.GONE

        pill(R.string.attendance_status_done, R.color.green_ok, R.drawable.bg_dot_green)

        val worked = day.workedMillis(now)
        val overtime = day.overtimeMillis(now)
        val shortfall = day.remainingMillis(now)
        val autoClosed = day.isAutoClosed(now)

        binding.attendanceSummaryText.text = when {
            autoClosed && overtime > 0L -> context.getString(
                R.string.attendance_summary_auto_full,
                formatDuration(worked), formatDuration(overtime),
            )
            autoClosed -> context.getString(
                R.string.attendance_summary_auto,
                formatDuration(worked), formatDuration(shortfall),
            )
            overtime > 0L -> context.getString(
                R.string.attendance_summary_overtime,
                formatClock(day.checkOutMillis ?: now),
                formatDuration(worked), formatDuration(overtime),
            )
            shortfall > 0L -> context.getString(
                R.string.attendance_summary_short,
                formatClock(day.checkOutMillis ?: now),
                formatDuration(worked), formatDuration(shortfall),
            )
            else -> context.getString(
                R.string.attendance_summary_exact,
                formatClock(day.checkOutMillis ?: now), formatDuration(worked),
            )
        }
        binding.attendanceSummary.visibility = View.VISIBLE
    }

    private fun renderProgress(day: WorkDay, now: Long, done: Boolean) {
        binding.attendanceTrackFill.setBackgroundResource(
            if (done) R.drawable.bg_progress_fill_green else R.drawable.bg_progress_fill_blue
        )
        binding.attendanceTrack.post {
            val width = (binding.attendanceTrack.width * day.progress(now)).toInt()
            binding.attendanceTrackFill.layoutParams =
                FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.MATCH_PARENT)
        }
    }

    // -------------------------------------------------------------- week summary

    /** One line under the card; the full breakdown lives on its own screen. */
    private fun renderWeek(now: Long) {
        val id = employeeId ?: return
        val today = HrGenieContent.todayIso
        val report = buildWeekReport(
            dates = weekDates(today),
            records = store.week(id, today),
            todayIso = today,
            now = now,
        )
        val worked = report.sumOf { it.workedMillis }
        val present = report.count { it.status == AttendanceStatus.PRESENT }

        binding.attendanceWeekTotal.text = context.getString(
            R.string.attendance_week_total,
            formatDuration(worked),
            formatDuration(WorkDay.FULL_WEEK_MILLIS),
            present,
        )
    }

    private fun pill(textRes: Int, colorRes: Int, dotRes: Int) {
        binding.attendanceStatus.setText(textRes)
        binding.attendanceStatus.setTextColor(ContextCompat.getColor(context, colorRes))
        binding.attendanceStatusDot.setBackgroundResource(dotRes)
    }
}
