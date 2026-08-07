package com.infinitylearn.hrgenie.ui.attendance

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.AttendanceDay
import com.infinitylearn.hrgenie.data.AttendanceStatus
import com.infinitylearn.hrgenie.data.AttendanceRepository
import com.infinitylearn.hrgenie.data.AttendanceStore
import com.infinitylearn.hrgenie.data.Employee
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.WorkDay
import com.infinitylearn.hrgenie.data.buildWeekReport
import com.infinitylearn.hrgenie.data.formatClock
import com.infinitylearn.hrgenie.data.formatDayLabel
import com.infinitylearn.hrgenie.data.formatDuration
import com.infinitylearn.hrgenie.data.formatWeekRange
import com.infinitylearn.hrgenie.data.weekDates
import com.infinitylearn.hrgenie.databinding.FragmentAttendanceHistoryBinding
import com.infinitylearn.hrgenie.databinding.ItemAttendanceDayBinding
import com.infinitylearn.hrgenie.databinding.ItemStatusCountBinding
import com.infinitylearn.hrgenie.ui.common.applyBottomInsetPadding
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import com.infinitylearn.hrgenie.ui.common.authToken
import kotlinx.coroutines.launch

/** This week's attendance, day by day, with regularisation for the gaps. */
class AttendanceHistoryFragment : Fragment() {

    private var _binding: FragmentAttendanceHistoryBinding? = null
    private val binding get() = _binding!!

    private val session: com.infinitylearn.hrgenie.ui.common.SessionViewModel by activityViewModels()
    private val store: AttendanceStore by lazy {
        AttendanceStore(requireContext().applicationContext)
    }

    private val selected = linkedSetOf<String>()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentAttendanceHistoryBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.header.applyTopInsetPadding()
        binding.regularizeBar.applyBottomInsetPadding()
        binding.content.playScreenEntrance()
        binding.backButton.setOnClickListener { findNavController().popBackStack() }

        val employee = signedInEmployee() ?: run {
            findNavController().popBackStack()
            return
        }
        binding.regularizeAction.setOnClickListener { submitRegularization(employee) }
        render(employee)
    }

    private fun signedInEmployee(): Employee? = session.signedInEmployee
        ?: SessionStore(requireContext()).remembered()?.employee

    // ------------------------------------------------------------------ rendering

    private fun render(employee: Employee) {
        val today = HrGenieContent.todayIso
        val dates = weekDates(today)
        val report = buildWeekReport(
            dates = dates,
            records = store.week(employee.employeeId, today),
            todayIso = today,
            now = System.currentTimeMillis(),
            requestedDates = store.regularizationRequests(employee.employeeId),
        )

        binding.weekRange.text = formatWeekRange(dates)
        renderTotals(report)
        renderCounts(report)
        renderDays(report)
        renderSelectionBar()
    }

    private fun renderTotals(report: List<AttendanceDay>) {
        val worked = report.sumOf { it.workedMillis }
        binding.weekHours.text = formatDuration(worked)
        binding.weekHoursDelta.text = getString(
            R.string.history_of_target,
            formatDuration(WorkDay.FULL_WEEK_MILLIS),
        )
        binding.weekHoursDelta.setTextColor(
            ContextCompat.getColor(
                requireContext(),
                if (worked >= WorkDay.FULL_WEEK_MILLIS) R.color.green_delta else R.color.white_55,
            )
        )

        val workingDays = report.count { it.status.isWorkingDay() }
        val present = report.count { it.status == AttendanceStatus.PRESENT }
        binding.weekPresent.text = getString(R.string.history_present_ratio, present, workingDays)
        binding.weekPresentDelta.text = resources.getQuantityString(
            R.plurals.history_week_offs,
            report.count { it.status == AttendanceStatus.WEEK_OFF },
            report.count { it.status == AttendanceStatus.WEEK_OFF },
        )
    }

    /** Only statuses that actually occurred this week get a chip. */
    private fun renderCounts(report: List<AttendanceDay>) {
        val row = binding.statusCounts
        row.removeAllViews()
        AttendanceStatus.entries.forEach { status ->
            val count = report.count { it.status == status }
            if (count == 0) return@forEach

            val chip = ItemStatusCountBinding.inflate(layoutInflater, row, false)
            chip.countLabel.setText(status.labelRes())
            chip.countValue.text = count.toString()
            chip.countValue.setBackgroundResource(status.pillRes())
            chip.countValue.setTextColor(
                ContextCompat.getColor(requireContext(), status.colorRes())
            )

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (row.childCount > 0) params.marginStart = 8.dp(row)
            row.addView(chip.root, params)
        }
    }

    private fun renderDays(report: List<AttendanceDay>) {
        val list = binding.dayList
        list.removeAllViews()

        report.forEachIndexed { index, day ->
            val row = ItemAttendanceDayBinding.inflate(layoutInflater, list, false)
            row.dayDate.text = formatDayLabel(day.dateIso)
            row.dayDetail.text = detailFor(day)

            row.dayStatus.text = day.status.code
            row.dayStatus.setBackgroundResource(day.status.pillRes())
            row.dayStatus.setTextColor(
                ContextCompat.getColor(requireContext(), day.status.colorRes())
            )

            // Detach before setting state so restoring a row cannot fire the listener.
            row.dayCheck.setOnCheckedChangeListener(null)
            row.dayCheck.isEnabled = day.canRegularize
            // An already-submitted day stays ticked, but locked.
            row.dayCheck.isChecked = day.regularizationRequested || day.dateIso in selected

            if (day.canRegularize) {
                row.dayCheck.setOnCheckedChangeListener { _, checked ->
                    if (checked) selected += day.dateIso else selected -= day.dateIso
                    renderSelectionBar()
                }
                row.dayRow.setOnClickListener { row.dayCheck.toggle() }
            } else {
                row.dayRow.setOnClickListener(null)
                row.dayRow.isClickable = false
            }

            list.addView(row.root)
            if (index < report.lastIndex) list.addView(hairline(list))
        }
    }

    private fun detailFor(day: AttendanceDay): CharSequence = when (day.status) {
        AttendanceStatus.WEEK_OFF -> getString(R.string.history_detail_week_off)
        AttendanceStatus.HOLIDAY -> day.holidayName ?: getString(R.string.history_detail_holiday)
        AttendanceStatus.ABSENT -> if (day.regularizationRequested) {
            getString(R.string.history_detail_requested)
        } else {
            getString(R.string.history_detail_absent)
        }
        AttendanceStatus.PENDING -> getString(R.string.history_detail_pending)
        AttendanceStatus.MIS_PUNCH -> {
            val base = getString(
                R.string.history_detail_mis_punch,
                formatClock(day.record?.checkInMillis ?: 0L),
                formatDuration(day.workedMillis),
            )
            if (day.regularizationRequested) {
                "$base · ${getString(R.string.history_requested_suffix)}"
            } else {
                base
            }
        }
        AttendanceStatus.IN_PROGRESS -> getString(
            R.string.history_detail_in_progress,
            formatClock(day.record?.checkInMillis ?: 0L),
            formatDuration(day.workedMillis),
        )
        else -> getString(
            R.string.history_detail_worked,
            formatClock(day.record?.checkInMillis ?: 0L),
            formatClock(day.record?.checkOutMillis ?: 0L),
            formatDuration(day.workedMillis),
        )
    }

    private fun hairline(parent: ViewGroup): View = View(requireContext()).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            1.dp(parent).coerceAtLeast(1),
        )
        setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.ink_05))
    }

    // ------------------------------------------------------------ regularisation

    private fun renderSelectionBar() {
        binding.regularizeBar.visibility = if (selected.isEmpty()) View.GONE else View.VISIBLE
        binding.regularizeCount.text = resources.getQuantityString(
            R.plurals.history_selected, selected.size, selected.size,
        )
    }

    private fun submitRegularization(employee: Employee) {
        if (selected.isEmpty()) return
        val count = selected.size
        // No HR endpoint yet; the request is recorded locally so the row reflects it.
        val dates = selected.toSet()
        val repository = AttendanceRepository(requireContext(), authToken(session))
        // Recorded on the device by the repository first, so the row updates even if
        // the request does not reach HR; the next refresh reconciles it.
        viewLifecycleOwner.lifecycleScope.launch {
            repository.regularize(employee.employeeId, dates)
        }
        selected.clear()
        render(employee)
        Snackbar.make(
            binding.root,
            resources.getQuantityString(R.plurals.history_regularized, count, count),
            Snackbar.LENGTH_LONG,
        ).show()
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

/** Days that count towards the working week. */
private fun AttendanceStatus.isWorkingDay(): Boolean =
    this != AttendanceStatus.WEEK_OFF && this != AttendanceStatus.HOLIDAY

private fun AttendanceStatus.labelRes(): Int = when (this) {
    AttendanceStatus.PRESENT -> R.string.status_present
    AttendanceStatus.HALF_DAY -> R.string.status_half_day
    AttendanceStatus.MIS_PUNCH -> R.string.status_mis_punch
    AttendanceStatus.ABSENT -> R.string.status_absent
    AttendanceStatus.WEEK_OFF -> R.string.status_week_off
    AttendanceStatus.HOLIDAY -> R.string.status_holiday
    AttendanceStatus.IN_PROGRESS -> R.string.status_in_progress
    AttendanceStatus.PENDING -> R.string.status_pending
}

private fun AttendanceStatus.pillRes(): Int = when (this) {
    AttendanceStatus.PRESENT -> R.drawable.bg_status_present
    AttendanceStatus.HALF_DAY, AttendanceStatus.IN_PROGRESS -> R.drawable.bg_status_half
    AttendanceStatus.MIS_PUNCH -> R.drawable.bg_status_mis
    AttendanceStatus.ABSENT -> R.drawable.bg_status_absent
    AttendanceStatus.WEEK_OFF, AttendanceStatus.HOLIDAY -> R.drawable.bg_status_off
    AttendanceStatus.PENDING -> R.drawable.bg_status_pending
}

private fun AttendanceStatus.colorRes(): Int = when (this) {
    AttendanceStatus.PRESENT -> R.color.green_ok
    AttendanceStatus.HALF_DAY, AttendanceStatus.IN_PROGRESS -> R.color.blue_deep
    AttendanceStatus.MIS_PUNCH -> R.color.orange_warn
    AttendanceStatus.ABSENT -> R.color.red_risk
    else -> R.color.text_secondary
}
