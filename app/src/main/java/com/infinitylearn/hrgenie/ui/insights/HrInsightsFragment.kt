package com.infinitylearn.hrgenie.ui.insights

import android.content.res.ColorStateList
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.annotation.ColorRes
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavOptions
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.ui.common.navigateSafely
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.DepartmentMood
import com.infinitylearn.hrgenie.data.Employee
import com.infinitylearn.hrgenie.data.HrAnalytics
import com.infinitylearn.hrgenie.data.weekDates
import com.infinitylearn.hrgenie.data.PulseRepository
import com.infinitylearn.hrgenie.data.MoodRepository
import com.infinitylearn.hrgenie.data.AttendanceRepository
import com.infinitylearn.hrgenie.data.HrDetailKind
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.HrStats
import com.infinitylearn.hrgenie.data.MoodKey
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.data.formatDuration
import com.infinitylearn.hrgenie.databinding.FragmentHrInsightsBinding
import com.infinitylearn.hrgenie.databinding.ItemDeptScoreBinding
import com.infinitylearn.hrgenie.databinding.ItemHrMetricBinding
import com.infinitylearn.hrgenie.databinding.ItemHrMoodRowBinding
import com.infinitylearn.hrgenie.databinding.ItemHrStatBinding
import com.infinitylearn.hrgenie.databinding.ItemTicketRowBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import kotlinx.coroutines.launch
import com.infinitylearn.hrgenie.ui.common.authToken
import com.infinitylearn.hrgenie.ui.common.ticketRepository
import java.util.Locale

/**
 * HRBP-facing dashboard, and the whole app for an HR sign-in — no bottom nav, no
 * employee screens behind it.
 *
 * Every figure is counted from what is actually on the device. Nothing is aggregated
 * below a cohort of five, and no name is ever shown against a mood entry.
 */
class HrInsightsFragment : Fragment() {

    private var _binding: FragmentHrInsightsBinding? = null
    private val binding get() = _binding!!

    private val session: SessionViewModel by activityViewModels()

    /** True when this is the HR home screen rather than a tab an employee opened. */
    private val isHrSession: Boolean get() = session.signedInEmployee?.isHr == true


    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentHrInsightsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.header.applyTopInsetPadding()
        binding.content.playScreenEntrance()

        bindIdentity()
        bindDrillDowns()
        listenForStatusChanges()
        // Figures are bound in onResume, which also runs on the way in.
    }

    /**
     * A bottom sheet does not stop the fragment behind it, so onResume never fires
     * when it closes. The sheet reports the change instead.
     */
    private fun listenForStatusChanges() {
        childFragmentManager.setFragmentResultListener(
            HrTicketSheet.RESULT_KEY,
            viewLifecycleOwner,
        ) { _, result ->
            val ticketId = result.getString(HrTicketSheet.RESULT_TICKET_ID).orEmpty()
            val status = result.getString(HrTicketSheet.RESULT_STATUS)
                ?.let { runCatching { TicketStatus.valueOf(it) }.getOrNull() }
                ?: return@setFragmentResultListener

            bind(HrAnalytics(requireContext()).stats())
            Snackbar.make(
                binding.root,
                getString(R.string.ticket_status_updated, ticketId, status.label),
                Snackbar.LENGTH_SHORT,
            ).show()
        }
    }

    /** Every headline figure opens the people behind it. */
    private fun bindDrillDowns() {
        binding.kpiEngagementTile.setOnClickListener { openDetail(HrDetailKind.MOOD) }
        binding.kpiPulseTile.setOnClickListener { openDetail(HrDetailKind.PULSE) }
        binding.moodCard.setOnClickListener { openDetail(HrDetailKind.MOOD) }
        binding.viewHistory.setOnClickListener {
            findNavController().navigateSafely(R.id.action_insights_to_trends)
        }
        binding.attendanceCard.setOnClickListener { openDetail(HrDetailKind.ATTENDANCE) }
    }

    /** HR lands here with nothing behind it, so there is nothing to go back to. */
    private fun bindIdentity() {
        val employee = session.signedInEmployee
        binding.hrAvatar.text = employee?.let(::initials).orEmpty()
        binding.hrAvatar.setOnClickListener { confirmSignOut() }

        binding.backButton.visibility = if (isHrSession) View.GONE else View.VISIBLE
        binding.backButton.setOnClickListener { findNavController().popBackStack() }

        if (isHrSession) {
            // Back on the dashboard means leaving the app, not falling into Home.
            requireActivity().onBackPressedDispatcher.addCallback(
                viewLifecycleOwner,
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        requireActivity().finish()
                    }
                },
            )
        }
    }

    private fun initials(employee: Employee): String =
        employee.name.split(' ')
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }

    // --------------------------------------------------------------------- binding

    private fun bind(stats: HrStats) {
        bindHeader(stats)
        bindTickets(stats)
        bindToday(stats)
        bindMood(stats)
        bindDepartments(stats)
        bindAttendance(stats)
        bindAttention(stats)
    }

    private fun bindHeader(stats: HrStats) {
        binding.insightsTitle.text =
            getString(R.string.insights_title, HrGenieContent.currentMonthName)
        binding.insightsSub.text = getString(
            R.string.insights_sub,
            HrGenieContent.todayLabel,
            stats.headcount,
        )

        val score = stats.engagementScore
        binding.kpiEngagement.text = if (score == null) {
            withDimSuffix("—", "")
        } else {
            withDimSuffix(String.format(Locale.US, "%.1f", score), "/10")
        }
        binding.kpiEngagementSub.text = when (stats.moodResponsesToday) {
            0 -> getString(R.string.kpi_engagement_none)
            1 -> getString(R.string.kpi_engagement_from, 1)
            else -> getString(R.string.kpi_engagement_from_plural, stats.moodResponsesToday)
        }
        binding.kpiEngagementSub.setTextColor(
            ContextCompat.getColor(
                requireContext(),
                if (score == null) R.color.white_45 else R.color.green_delta,
            )
        )

        binding.kpiPulse.text = withDimSuffix(stats.pulseRate.toString(), "%")
        binding.kpiPulseSub.text =
            getString(R.string.kpi_pulse_sub, stats.pulseCompleted, stats.headcount)
    }

    /** "7.4/10" — the suffix is smaller and dimmer than the figure. */
    private fun withDimSuffix(value: String, suffix: String): SpannableString {
        val text = SpannableString(value + suffix)
        if (suffix.isEmpty()) return text
        val start = value.length
        val end = text.length
        val suffixSizePx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_SP, 13f, resources.displayMetrics
        ).toInt()
        text.setSpan(
            AbsoluteSizeSpan(suffixSizePx),
            start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        text.setSpan(
            ForegroundColorSpan(ContextCompat.getColor(requireContext(), R.color.white_45)),
            start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        return text
    }

    // --------------------------------------------------------------------- tickets

    /**
     * Tickets are service requests, not sentiment, so the requester is named — HR has
     * to be able to action them. Nothing here is inferred: an empty store shows the
     * empty state rather than a placeholder queue.
     */
    private fun bindTickets(stats: HrStats) {
        val open = stats.ticketsOpen + stats.ticketsInProgress
        binding.ticketBadge.text = if (open == 0) {
            getString(R.string.hr_tickets_all_clear)
        } else {
            getString(R.string.hr_tickets_open_badge, open)
        }
        tintPill(
            binding.ticketBadge,
            if (open == 0) R.color.green_tint_14 else R.color.orange_tint_14,
            if (open == 0) R.color.green_ok else R.color.orange_warn,
        )

        binding.ticketCount.text = stats.tickets.size.toString()
        binding.ticketCount.visibility =
            if (stats.tickets.isEmpty()) View.GONE else View.VISIBLE

        val empty = stats.tickets.isEmpty()
        binding.ticketEmpty.visibility = if (empty) View.VISIBLE else View.GONE
        binding.ticketList.visibility = if (empty) View.GONE else View.VISIBLE
        if (empty) {
            binding.ticketList.removeAllViews()
            binding.viewAllTickets.visibility = View.GONE
            return
        }

        bindTicketList(stats)
    }

    /** The newest couple only — the full queue has its own screen. */
    private fun bindTicketList(stats: HrStats) {
        val list = binding.ticketList
        list.removeAllViews()

        val now = System.currentTimeMillis()
        val shown = stats.tickets.take(MAX_TICKET_ROWS)
        shown.forEachIndexed { index, ticket ->
            val row = ItemTicketRowBinding.inflate(layoutInflater, list, false)
            row.ticketSubject.text = ticket.subject
            row.ticketMeta.text = getString(
                R.string.hr_ticket_meta,
                ticket.id,
                ticket.category,
                ticket.ageLabel(now),
            )
            row.ticketStatus.text = ticket.status.label
            row.ticketAccent.setBackgroundResource(accentFor(ticket.status))
            tintPill(row.ticketStatus, pillFillFor(ticket.status), pillTextFor(ticket.status))
            // Tap to move it along: Open -> In progress -> Resolved.
            row.root.setOnClickListener {
                HrTicketSheet
                    .newInstance(ticket.id, session.signedInEmployee?.employeeId.orEmpty())
                    .show(childFragmentManager, HrTicketSheet.TAG)
            }

            list.addView(row.root)
            if (index < shown.lastIndex) list.addView(hairline(list))
        }

        val hidden = stats.tickets.size - shown.size
        binding.viewAllTickets.visibility = if (hidden > 0) View.VISIBLE else View.GONE
        binding.viewAllTickets.text = getString(R.string.hr_view_all_tickets, stats.tickets.size)
        binding.viewAllTickets.setOnClickListener {
            findNavController().navigateSafely(R.id.action_insights_to_tickets)
        }
    }

    private fun accentFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.drawable.bg_track_fill_orange
        TicketStatus.IN_PROGRESS -> R.drawable.bg_track_fill_blue
        TicketStatus.RESOLVED -> R.drawable.bg_track_fill_green
    }

    private fun pillFillFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_tint_14
        TicketStatus.IN_PROGRESS -> R.color.blue_tint_10
        TicketStatus.RESOLVED -> R.color.green_tint_14
    }

    private fun pillTextFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_warn
        TicketStatus.IN_PROGRESS -> R.color.blue_deep
        TicketStatus.RESOLVED -> R.color.green_ok
    }

    private fun tintPill(view: TextView, @ColorRes fill: Int, @ColorRes text: Int) {
        view.backgroundTintList = ColorStateList.valueOf(
            ContextCompat.getColor(requireContext(), fill)
        )
        view.setTextColor(ContextCompat.getColor(requireContext(), text))
    }

    private fun hairline(parent: ViewGroup): View = View(requireContext()).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            1.dp(parent).coerceAtLeast(1),
        )
        setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.ink_05))
    }

    // ----------------------------------------------------------------------- today

    private fun bindToday(stats: HrStats) {
        val row = binding.todayStats
        row.removeAllViews()

        val tiles = listOf(
            TodayTile(
                value = stats.checkedInToday,
                label = R.string.hr_stat_checked_in,
                background = R.drawable.bg_stat_tile_blue,
                accent = R.color.blue_deep,
                kind = HrDetailKind.CHECKED_IN,
                showTotal = true,
            ),
            TodayTile(
                value = stats.onTheClock,
                label = R.string.hr_stat_on_the_clock,
                background = R.drawable.bg_stat_tile_green,
                accent = R.color.green_ok,
                kind = HrDetailKind.ON_THE_CLOCK,
                showTotal = false,
            ),
            TodayTile(
                value = stats.moodResponsesToday,
                label = R.string.hr_stat_mood,
                background = R.drawable.bg_stat_tile_purple,
                accent = R.color.purple,
                kind = HrDetailKind.MOOD,
                showTotal = true,
            ),
        )

        tiles.forEachIndexed { index, spec ->
            val tile = ItemHrStatBinding.inflate(layoutInflater, row, false)
            tile.statTile.setBackgroundResource(spec.background)
            tile.statValue.text = spec.value.toString()
            tile.statValue.setTextColor(ContextCompat.getColor(requireContext(), spec.accent))
            tile.statLabel.setText(spec.label)
            if (spec.showTotal) {
                tile.statOutOf.text = getString(R.string.hr_dept_headcount, stats.headcount)
            } else {
                tile.statOutOf.visibility = View.INVISIBLE
            }
            tile.statTile.setOnClickListener { openDetail(spec.kind) }

            val params = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            if (index > 0) params.marginStart = 9.dp(row)
            row.addView(tile.root, params)
        }
    }

    private data class TodayTile(
        val value: Int,
        val label: Int,
        val background: Int,
        val accent: Int,
        val kind: HrDetailKind,
        val showTotal: Boolean,
    )

    /** Opens the people behind a figure. See [HrDetailSheet] on why they are named. */
    private fun openDetail(kind: HrDetailKind, argument: String? = null) {
        HrDetailSheet.newInstance(kind, argument)
            .show(childFragmentManager, HrDetailSheet.TAG)
    }

    private fun bindMood(stats: HrStats) {
        binding.moodSubtitle.text = if (stats.moodResponsesToday == 0) {
            getString(R.string.hr_mood_none)
        } else {
            getString(R.string.hr_mood_sub, stats.moodResponsesToday, stats.headcount)
        }

        val list = binding.moodBreakdown
        list.removeAllViews()
        if (stats.moodResponsesToday == 0) {
            list.visibility = View.GONE
            return
        }
        list.visibility = View.VISIBLE

        // Bars are a share of today's responses, not of headcount — with a roll this
        // small, dividing by headcount would flatten everything to a sliver.
        val total = stats.moodResponsesToday
        var first = true
        MoodKey.entries.forEach { key ->
            val count = stats.moodBreakdown[key] ?: 0
            if (count == 0) return@forEach
            val mood = HrGenieContent.mood(key)
            val row = ItemHrMoodRowBinding.inflate(layoutInflater, list, false)
            row.moodLabel.text = getString(R.string.hr_mood_row, mood.emoji, mood.label)
            row.moodCount.text = count.toString()
            row.moodTrackFill.setBackgroundResource(fillForScore(mood.trendValue.toDouble()))
            row.moodTrack.post {
                row.moodTrackFill.layoutParams = FrameLayout.LayoutParams(
                    (row.moodTrack.width * count / total.toFloat()).toInt(),
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (!first) params.topMargin = 13.dp(list)
            first = false
            list.addView(row.root, params)
        }
    }

    private fun bindDepartments(stats: HrStats) {
        val list = binding.deptList
        list.removeAllViews()
        stats.departments.forEachIndexed { index, dept ->
            val row = ItemDeptScoreBinding.inflate(layoutInflater, list, false)
            row.deptName.text = dept.name
            row.deptScore.text = scoreLabel(dept)
            row.trackFill.setBackgroundResource(fillForScore(dept.score))

            row.track.post {
                val fraction = (dept.score ?: 0.0) / 10.0
                row.trackFill.layoutParams = FrameLayout.LayoutParams(
                    (row.track.width * fraction).toInt(),
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }
            row.root.setOnClickListener { openDetail(HrDetailKind.DEPARTMENT, dept.name) }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 13.dp(list)
            list.addView(row.root, params)
        }
    }

    private fun scoreLabel(dept: DepartmentMood): String = dept.score
        ?.let { String.format(Locale.US, "%.1f", it) }
        ?: getString(R.string.hr_dept_no_data)

    private fun fillForScore(score: Double?): Int = when {
        score == null -> R.drawable.bg_track
        score >= 7.5 -> R.drawable.bg_track_fill_green
        score >= 6.0 -> R.drawable.bg_track_fill_blue
        else -> R.drawable.bg_track_fill_orange
    }

    private fun bindAttendance(stats: HrStats) {
        binding.attendanceSubtitle.text =
            getString(R.string.hr_attendance_sub, formatDuration(stats.weekHoursMillis))

        val list = binding.attendanceStats
        list.removeAllViews()
        listOf(
            Triple(R.string.hr_metric_present, stats.weekPresent, R.drawable.bg_track_fill_green),
            Triple(R.string.hr_metric_half, stats.weekHalfDays, R.drawable.bg_track_fill_blue),
            Triple(R.string.hr_metric_mis, stats.weekMisPunches, R.drawable.bg_track_fill_orange),
            Triple(R.string.hr_metric_absent, stats.weekAbsences, R.drawable.bg_track_fill_orange),
        ).forEachIndexed { index, (label, value, dot) ->
            val row = ItemHrMetricBinding.inflate(layoutInflater, list, false)
            row.metricLabel.setText(label)
            row.metricValue.text = value.toString()
            row.metricDot.setBackgroundResource(dot)

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 11.dp(list)
            list.addView(row.root, params)
        }
    }

    /**
     * The handoff's non-negotiable, applied literally: below the cohort minimum there
     * is nothing HR may be shown, so the card says why instead of inventing signals.
     */
    private fun bindAttention(stats: HrStats) {
        val flagged = stats.weekMisPunches + stats.weekAbsences
        binding.attentionBody.text = when {
            !stats.meetsCohortMinimum -> getString(
                R.string.hr_attention_below_cohort,
                HrStats.MIN_COHORT,
                stats.headcount,
            )
            flagged == 0 -> getString(R.string.hr_attention_clear)
            flagged == 1 -> getString(R.string.hr_attention_watch, 1)
            else -> getString(R.string.hr_attention_watch_plural, flagged)
        }
    }

    // -------------------------------------------------------------------- sign out

    private fun confirmSignOut() {
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.hr_sign_out)
            .setMessage(R.string.hr_sign_out_message)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.hr_sign_out) { _, _ -> signOut() }
            .show()
    }

    private fun signOut() {
        SessionStore(requireContext()).forget()
        session.signOut()
        val navController = findNavController()
        navController.navigateSafely(
            R.id.signInFragment,
            null,
            NavOptions.Builder()
                .setPopUpTo(navController.graph.id, /* inclusive = */ true)
                .build(),
        )
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
        // Figures move while the dashboard is open: someone checks in, someone clocks
        // out, chat raises a ticket. Re-reading on resume keeps the demo honest
        // without a refresh control.
        _binding?.let { bind(HrAnalytics(requireContext()).stats()) }
        // Tickets are the part that moves on someone else's phone, so they are pulled
        // from the server before the figures are shown again.
        viewLifecycleOwner.lifecycleScope.launch {
            val token = authToken(session)
            val today = HrGenieContent.todayIso
            val week = weekDates(today)
            // Every one of these is written from someone else's phone, so the whole
            // set is pulled before the figures are recomputed.
            ticketRepository(session).refreshAll()
            MoodRepository(requireContext(), token).refreshForHr(today)
            PulseRepository(requireContext(), token).refreshForHr(HrGenieContent.currentCycle)
            AttendanceRepository(requireContext(), token)
                .refreshForHr(week.first(), week.last())
            if (_binding != null) bind(HrAnalytics(requireContext()).stats())
        }
    }

    private companion object {
        /** The card is a summary; the full queue belongs on its own screen. */
        const val MAX_TICKET_ROWS = 2
    }
}
