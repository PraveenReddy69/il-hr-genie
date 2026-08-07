package com.infinitylearn.hrgenie.ui.insights

import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.annotation.ColorRes
import androidx.core.content.ContextCompat
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.EntryTone
import com.infinitylearn.hrgenie.data.HrAnalytics
import com.infinitylearn.hrgenie.data.HrDetailKind
import com.infinitylearn.hrgenie.data.PersonEntry
import com.infinitylearn.hrgenie.databinding.ItemHrAnswerBinding
import com.infinitylearn.hrgenie.databinding.ItemHrPersonBinding
import com.infinitylearn.hrgenie.databinding.SheetHrDetailBinding

/**
 * The people behind a dashboard figure — who clocked in, who shared a mood, who still
 * owes a pulse.
 *
 * Named, by product decision: HR asked to open a number and see who it is. The cards
 * on the dashboard itself stay aggregated.
 */
class HrDetailSheet : BottomSheetDialogFragment() {

    private var _binding: SheetHrDetailBinding? = null
    private val binding get() = _binding!!

    private val kind: HrDetailKind
        get() = HrDetailKind.valueOf(requireArguments().getString(ARG_KIND)!!)

    private val argument: String? get() = arguments?.getString(ARG_ARGUMENT)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = SheetHrDetailBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val entries = HrAnalytics(requireContext()).detail(kind, argument)

        binding.sheetTitle.text = headingFor(kind)
        binding.sheetSubtitle.text = subtitleFor(entries)

        binding.sheetEmpty.visibility = if (entries.isEmpty()) View.VISIBLE else View.GONE
        binding.sheetEmpty.setText(emptyFor(kind))
        bindList(entries)
    }

    private fun bindList(entries: List<PersonEntry>) {
        val list = binding.sheetList
        list.removeAllViews()
        entries.forEachIndexed { index, entry ->
            val row = ItemHrPersonBinding.inflate(layoutInflater, list, false)
            row.personName.text = entry.employee.name
            row.personSubtitle.text = entry.subtitle
            row.personAvatar.text = entry.initials
            row.personAvatar.background = circle(avatarColorFor(index))
            row.personValue.text = entry.value
            row.personValue.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(requireContext(), fillFor(entry.tone))
            )
            row.personValue.setTextColor(
                ContextCompat.getColor(requireContext(), textFor(entry.tone))
            )
            bindBreakdown(row, entry)

            list.addView(row.root)
            if (index < entries.lastIndex) list.addView(hairline(list))
        }
    }

    /**
     * Fills the expandable panel and wires the toggle. Rows with nothing to expand
     * keep no chevron and stay unclickable, so the affordance never lies.
     */
    private fun bindBreakdown(row: ItemHrPersonBinding, entry: PersonEntry) {
        val panel = row.personBreakdown
        panel.removeAllViews()

        if (!entry.isExpandable) {
            row.personChevron.visibility = View.GONE
            row.personHeader.isClickable = false
            row.personHeader.background = null
            panel.visibility = View.GONE
            return
        }

        entry.breakdown.forEachIndexed { index, (question, answer) ->
            val line = ItemHrAnswerBinding.inflate(layoutInflater, panel, false)
            line.answerQuestion.text = question
            line.answerValue.text = answer
            panel.addView(line.root)
            if (index < entry.breakdown.lastIndex) panel.addView(hairline(panel))
        }

        row.personChevron.visibility = View.VISIBLE
        row.personHeader.setBackgroundResource(selectableItemBackground())
        row.personHeader.setOnClickListener {
            val expanded = panel.visibility == View.VISIBLE
            panel.visibility = if (expanded) View.GONE else View.VISIBLE
            row.personChevron.setText(
                if (expanded) R.string.chevron_down else R.string.chevron_up
            )
        }
    }

    private fun selectableItemBackground(): Int {
        val value = android.util.TypedValue()
        requireContext().theme
            .resolveAttribute(android.R.attr.selectableItemBackground, value, true)
        return value.resourceId
    }

    private fun circle(@ColorRes color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ContextCompat.getColor(requireContext(), color))
    }

    /** Cycles the wish palette so adjacent rows never share a colour. */
    private fun avatarColorFor(index: Int): Int = AVATAR_COLORS[index % AVATAR_COLORS.size]

    private fun fillFor(tone: EntryTone): Int = when (tone) {
        EntryTone.POSITIVE -> R.color.green_tint_14
        EntryTone.WARNING -> R.color.orange_tint_14
        EntryTone.MUTED -> R.color.ink_05
        EntryTone.NEUTRAL -> R.color.blue_tint_10
    }

    private fun textFor(tone: EntryTone): Int = when (tone) {
        EntryTone.POSITIVE -> R.color.green_ok
        EntryTone.WARNING -> R.color.orange_warn
        EntryTone.MUTED -> R.color.text_muted
        EntryTone.NEUTRAL -> R.color.blue_deep
    }

    /**
     * Only a department names itself. A past date or cycle is formatted for reading;
     * everything else uses its fixed title.
     */
    private fun headingFor(kind: HrDetailKind): String = when (kind) {
        HrDetailKind.DEPARTMENT -> argument.orEmpty()
        HrDetailKind.MOOD_ON_DATE -> argument?.let(::formatDate) ?: getString(titleFor(kind))
        HrDetailKind.PULSE_IN_CYCLE -> argument?.let(::formatCycle) ?: getString(titleFor(kind))
        else -> getString(titleFor(kind))
    }

    private fun formatDate(dateIso: String): String {
        val parsed = runCatching { ISO_DAY.parse(dateIso) }.getOrNull() ?: return dateIso
        return DAY_LABEL.format(parsed)
    }

    private fun formatCycle(cycle: String): String {
        val parsed = runCatching { ISO_CYCLE.parse(cycle) }.getOrNull() ?: return cycle
        return MONTH_LABEL.format(parsed)
    }

    private fun titleFor(kind: HrDetailKind): Int = when (kind) {
        HrDetailKind.CHECKED_IN -> R.string.hr_detail_checked_in
        HrDetailKind.ON_THE_CLOCK -> R.string.hr_detail_on_the_clock
        HrDetailKind.MOOD, HrDetailKind.MOOD_ON_DATE -> R.string.hr_detail_mood
        HrDetailKind.PULSE, HrDetailKind.PULSE_IN_CYCLE -> R.string.hr_detail_pulse
        HrDetailKind.ATTENDANCE -> R.string.hr_detail_attendance
        HrDetailKind.DEPARTMENT -> R.string.dept_sentiment
    }

    private fun emptyFor(kind: HrDetailKind): Int = when (kind) {
        HrDetailKind.CHECKED_IN -> R.string.hr_detail_empty_checked_in
        HrDetailKind.ON_THE_CLOCK -> R.string.hr_detail_empty_on_the_clock
        else -> R.string.hr_detail_empty_generic
    }

    private fun subtitleFor(entries: List<PersonEntry>): String = when (kind) {
        HrDetailKind.MOOD, HrDetailKind.MOOD_ON_DATE, HrDetailKind.DEPARTMENT -> {
            val shared = entries.count { it.tone != EntryTone.MUTED }
            getString(R.string.hr_detail_shared, shared, entries.size)
        }
        HrDetailKind.PULSE, HrDetailKind.PULSE_IN_CYCLE -> {
            val done = entries.count { it.tone == EntryTone.POSITIVE }
            getString(R.string.hr_detail_answered, done, entries.size)
        }
        else -> resources.getQuantityString(
            R.plurals.hr_detail_people, entries.size, entries.size,
        )
    }

    private fun hairline(parent: ViewGroup): View = View(requireContext()).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (resources.displayMetrics.density).toInt().coerceAtLeast(1),
        )
        setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.ink_05))
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "hr-detail"

        private const val ARG_KIND = "kind"
        private const val ARG_ARGUMENT = "argument"

        // java.time needs API 26 (minSdk is 24), so stay on the legacy formatters.
        private val ISO_DAY = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        private val ISO_CYCLE = java.text.SimpleDateFormat("yyyy-MM", java.util.Locale.US)
        private val DAY_LABEL =
            java.text.SimpleDateFormat("EEEE d MMMM", java.util.Locale.getDefault())
        private val MONTH_LABEL =
            java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.getDefault())

        private val AVATAR_COLORS = intArrayOf(
            R.color.avatar_blue,
            R.color.avatar_orange,
            R.color.avatar_green,
            R.color.avatar_purple,
        )

        fun newInstance(kind: HrDetailKind, argument: String? = null) = HrDetailSheet().apply {
            arguments = Bundle().apply {
                putString(ARG_KIND, kind.name)
                argument?.let { putString(ARG_ARGUMENT, it) }
            }
        }
    }
}
