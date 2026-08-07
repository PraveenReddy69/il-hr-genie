package com.infinitylearn.hrgenie.ui.insights

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.BuildConfig
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.CycleSummary
import com.infinitylearn.hrgenie.data.DemoSeeder
import com.infinitylearn.hrgenie.data.DayMood
import com.infinitylearn.hrgenie.data.HrAnalytics
import com.infinitylearn.hrgenie.data.HrDetailKind
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.QuestionBreakdown
import com.infinitylearn.hrgenie.databinding.FragmentTrendsBinding
import com.infinitylearn.hrgenie.databinding.ItemAnswerOptionBinding
import com.infinitylearn.hrgenie.databinding.ItemCycleRowBinding
import com.infinitylearn.hrgenie.databinding.ItemTrendBarBinding
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Mood and pulse over time, rather than the dashboard's snapshot of today.
 *
 * Everything here is still counted from local records: days nobody answered show as
 * gaps, because a gap is a finding rather than something to smooth over.
 */
class TrendsFragment : Fragment() {

    private var _binding: FragmentTrendsBinding? = null
    private val binding get() = _binding!!

    /** The cycle whose answers are broken down; defaults to this month. */
    private var selectedCycle: String = HrGenieContent.currentCycle

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentTrendsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.header.applyTopInsetPadding()
        binding.content.playScreenEntrance()
        binding.backButton.setOnClickListener { findNavController().popBackStack() }
        setUpSeeder()
    }

    /**
     * Demo tooling. The card is absent from release builds — a button that rewrites
     * everyone's history has no business shipping.
     */
    private fun setUpSeeder() {
        if (!BuildConfig.DEBUG) {
            binding.seederCard.visibility = View.GONE
            return
        }
        binding.seederCard.visibility = View.VISIBLE

        binding.seedButton.setOnClickListener {
            confirm(R.string.seed_action, R.string.seed_confirm) {
                val written = DemoSeeder(requireContext()).seed()
                render()
                Snackbar.make(
                    binding.root,
                    getString(R.string.seed_done, written),
                    Snackbar.LENGTH_SHORT,
                ).show()
            }
        }
        binding.clearSeedButton.setOnClickListener {
            confirm(R.string.seed_clear, R.string.seed_clear_confirm) {
                DemoSeeder(requireContext()).clear()
                render()
                Snackbar.make(binding.root, R.string.seed_cleared, Snackbar.LENGTH_SHORT).show()
            }
        }
    }

    private fun confirm(titleRes: Int, messageRes: Int, onConfirm: () -> Unit) {
        AlertDialog.Builder(requireContext())
            .setTitle(titleRes)
            .setMessage(messageRes)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(titleRes) { _, _ -> onConfirm() }
            .show()
    }

    private fun render() {
        val analytics = HrAnalytics(requireContext())
        val days = analytics.moodHistory()
        val cycles = analytics.pulseHistory()

        binding.trendsSubtitle.text =
            getString(R.string.trends_sub, days.size, cycles.size)

        bindMoodTrend(days)
        bindCycles(cycles)
        bindAnswers(analytics.pulseBreakdown(selectedCycle), cycles)
    }

    // ---------------------------------------------------------------- mood trend

    private fun bindMoodTrend(days: List<DayMood>) {
        val chart = binding.moodTrendChart
        chart.removeAllViews()

        val answered = days.filter { it.hasData }
        binding.moodTrendEmpty.visibility = if (answered.isEmpty()) View.VISIBLE else View.GONE
        binding.moodTrendSubtitle.text = if (answered.isEmpty()) {
            getString(R.string.trends_mood_none)
        } else {
            getString(
                R.string.trends_mood_sub,
                String.format(Locale.US, "%.1f", answered.mapNotNull { it.score }.average()),
                answered.size,
            )
        }

        val inflater = layoutInflater
        val density = resources.displayMetrics.density
        days.forEachIndexed { index, day ->
            val column = ItemTrendBarBinding.inflate(inflater, chart, false)

            // A day with no answers still gets a stub, so the gap is visible rather
            // than the chart silently closing up.
            val ratio = ((day.score ?: 0.0) / MAX_SCORE).coerceIn(0.0, 1.0)
            val heightDp = if (day.hasData) MIN_BAR_DP + ratio * EXTRA_BAR_DP else STUB_BAR_DP
            column.bar.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                (heightDp * density).toInt(),
            )
            column.bar.setBackgroundResource(barFor(day, isToday = index == days.lastIndex))
            column.weekLabel.text = dayInitial(day.dateIso)

            if (day.hasData) {
                column.root.setOnClickListener {
                    HrDetailSheet
                        .newInstance(HrDetailKind.MOOD_ON_DATE, day.dateIso)
                        .show(childFragmentManager, HrDetailSheet.TAG)
                }
            }

            val params = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            if (index > 0) params.marginStart = 3.dp(chart)
            chart.addView(column.root, params)
        }
    }

    private fun barFor(day: DayMood, isToday: Boolean): Int = when {
        !day.hasData -> R.drawable.bg_bar_empty
        isToday -> R.drawable.bg_bar_current
        (day.score ?: 0.0) < LOW_SCORE -> R.drawable.bg_bar_low
        else -> R.drawable.bg_bar_other
    }

    // -------------------------------------------------------------- pulse cycles

    private fun bindCycles(cycles: List<CycleSummary>) {
        val list = binding.pulseCycleList
        list.removeAllViews()

        cycles.asReversed().forEachIndexed { index, cycle ->
            val row = ItemCycleRowBinding.inflate(layoutInflater, list, false)
            row.cycleMonth.text = monthLabel(cycle.cycle)
            row.cycleCount.text =
                getString(R.string.trends_cycle_count, cycle.completed, cycle.headcount)
            row.cycleCurrent.visibility =
                if (cycle.cycle == HrGenieContent.currentCycle) View.VISIBLE else View.GONE

            row.cycleTrack.post {
                row.cycleTrackFill.layoutParams = FrameLayout.LayoutParams(
                    (row.cycleTrack.width * cycle.rate / 100f).toInt(),
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }
            row.cycleTrackFill.setBackgroundResource(
                if (cycle.cycle == selectedCycle) {
                    R.drawable.bg_track_fill_blue
                } else {
                    R.drawable.bg_track_fill_grey
                }
            )
            row.cycleRow.setOnClickListener {
                selectedCycle = cycle.cycle
                render()
            }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 4.dp(list)
            list.addView(row.root, params)
        }
    }

    // ------------------------------------------------------------- pulse answers

    private fun bindAnswers(breakdown: List<QuestionBreakdown>, cycles: List<CycleSummary>) {
        val summary = cycles.firstOrNull { it.cycle == selectedCycle }
        binding.answersSubtitle.text = getString(
            R.string.trends_answers_sub,
            monthLabel(selectedCycle),
            summary?.completed ?: 0,
            summary?.headcount ?: 0,
        )

        // The subtitle doubles as the way into who answered that cycle.
        binding.answersSubtitle.setOnClickListener {
            HrDetailSheet
                .newInstance(HrDetailKind.PULSE_IN_CYCLE, selectedCycle)
                .show(childFragmentManager, HrDetailSheet.TAG)
        }

        val list = binding.answerBreakdown
        list.removeAllViews()

        val answered = breakdown.any { it.responses > 0 }
        binding.answersEmpty.visibility = if (answered) View.GONE else View.VISIBLE
        list.visibility = if (answered) View.VISIBLE else View.GONE
        if (!answered) return

        breakdown.forEachIndexed { index, question ->
            list.addView(questionHeading(question.question, index > 0))
            val highest = question.answers.maxOfOrNull { it.second } ?: 0

            question.answers.forEach { (option, count) ->
                val row = ItemAnswerOptionBinding.inflate(layoutInflater, list, false)
                row.optionLabel.text = option
                row.optionCount.text = count.toString()
                // Options nobody picked stay listed but recede — the shape of the
                // answers is the point, not just the winner.
                row.root.alpha = if (count == 0) 0.45f else 1f
                row.optionTrackFill.setBackgroundResource(
                    if (count > 0 && count == highest) {
                        R.drawable.bg_track_fill_blue
                    } else {
                        R.drawable.bg_track_fill_grey
                    }
                )
                row.optionTrack.post {
                    val fraction = if (highest == 0) 0f else count / highest.toFloat()
                    row.optionTrackFill.layoutParams = FrameLayout.LayoutParams(
                        (row.optionTrack.width * fraction).toInt(),
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                }
                list.addView(row.root)
            }
        }

    }

    private fun questionHeading(text: String, spaced: Boolean) =
        android.widget.TextView(requireContext()).apply {
            this.text = text
            setTextColor(ContextCompat.getColor(requireContext(), R.color.ink))
            textSize = 12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, if (spaced) 16.dp(binding.answerBreakdown) else 0, 0, 6.dp(binding.answerBreakdown))
        }

    // ------------------------------------------------------------------ plumbing

    /** "M", "T" … under each column, with the date available on tap. */
    private fun dayInitial(dateIso: String): String {
        val parsed = runCatching { ISO.parse(dateIso) }.getOrNull() ?: return ""
        return DAY_INITIAL.format(parsed).take(1)
    }

    private fun monthLabel(cycle: String): String {
        val parsed = runCatching { CYCLE.parse(cycle) }.getOrNull() ?: return cycle
        return MONTH_YEAR.format(parsed)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
        _binding?.let { render() }
    }

    private companion object {
        const val MAX_SCORE = 10.0
        const val LOW_SCORE = 5.0
        const val MIN_BAR_DP = 14.0
        const val EXTRA_BAR_DP = 58.0

        /** Enough to show a day existed, without pretending it has a score. */
        const val STUB_BAR_DP = 5.0

        // java.time needs API 26 (minSdk is 24), so stay on the legacy formatters.
        val ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val CYCLE = SimpleDateFormat("yyyy-MM", Locale.US)
        val DAY_INITIAL = SimpleDateFormat("EEE", Locale.getDefault())
        val MONTH_YEAR = SimpleDateFormat("MMMM yyyy", Locale.getDefault())
    }
}
