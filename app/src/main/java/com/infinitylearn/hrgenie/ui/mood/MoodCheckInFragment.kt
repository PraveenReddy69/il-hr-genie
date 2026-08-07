package com.infinitylearn.hrgenie.ui.mood

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.MoodKey
import com.infinitylearn.hrgenie.data.MoodRepository
import com.infinitylearn.hrgenie.data.MoodStore
import com.infinitylearn.hrgenie.databinding.FragmentMoodCheckInBinding
import com.infinitylearn.hrgenie.databinding.ItemMoodRowBinding
import com.infinitylearn.hrgenie.databinding.ItemReasonChipBinding
import com.infinitylearn.hrgenie.ui.common.BarCharts
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyBottomInsetPadding
import com.infinitylearn.hrgenie.ui.common.applyPressScale
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import com.infinitylearn.hrgenie.ui.common.authToken
import kotlinx.coroutines.launch

/** All three check-in steps live in one fragment, swapped through a ViewFlipper. */
class MoodCheckInFragment : Fragment() {

    private var _binding: FragmentMoodCheckInBinding? = null
    private val binding get() = _binding!!

    private val viewModel: MoodViewModel by viewModels()
    private val session: SessionViewModel by activityViewModels()
    private val moods: MoodStore by lazy { MoodStore(requireContext().applicationContext) }

    /** Chip views keyed by reason, so selection state can be pushed back onto them. */
    private val reasonChips = mutableMapOf<String, View>()
    private val moodRows = mutableMapOf<MoodKey, View>()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentMoodCheckInBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.topBar.applyTopInsetPadding()
        binding.step0.pickContent.applyBottomInsetPadding()
        binding.step1.whyContent.applyBottomInsetPadding()
        binding.step2.doneContent.applyBottomInsetPadding()

        binding.checkInDate.text =
            getString(R.string.checkin_eyebrow, HrGenieContent.todayCompact)

        buildMoodRows()
        buildReasonChips()
        bindActions()

        if (savedInstanceState == null && viewModel.selectedMood.value == null) {
            // Already answered today? Reopen that entry instead of asking again. The
            // record is keyed by employee id, so each person sees their own.
            val logged = session.signedInEmployee?.let {
                moods.entry(it.employeeId, HrGenieContent.todayIso)
            }
            if (logged != null) {
                viewModel.restore(logged.mood, logged.reasons, logged.note)
                binding.step1.noteInput.setText(logged.note)
            } else {
                // Home passes a mood when a face is tapped there; jump to step 1.
                arguments?.getString("moodKey")
                    ?.let { runCatching { MoodKey.valueOf(it) }.getOrNull() }
                    ?.let(viewModel::pick)
            }
        }

        viewModel.step.observe(viewLifecycleOwner) { showStep(it) }
        viewModel.selectedMood.observe(viewLifecycleOwner) { renderSelectedMood() }
        viewModel.reasons.observe(viewLifecycleOwner) { renderReasonState() }

        requireActivity().onBackPressedDispatcher.addCallback(
            viewLifecycleOwner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (!viewModel.goBack()) {
                        isEnabled = false
                        requireActivity().onBackPressedDispatcher.onBackPressed()
                    }
                }
            },
        )
    }

    // ------------------------------------------------------------------- step 0

    private fun buildMoodRows() {
        val container = binding.step0.moodRows
        container.removeAllViews()
        moodRows.clear()

        HrGenieContent.MOODS.forEachIndexed { index, mood ->
            val row = ItemMoodRowBinding.inflate(layoutInflater, container, false)
            row.moodEmoji.text = mood.emoji
            row.moodLabel.text = mood.label
            row.moodSub.text = mood.sub
            row.root.setOnClickListener { viewModel.pick(mood.key) }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 10.dp(container)
            container.addView(row.root, params)
            moodRows[mood.key] = row.root
        }
    }

    // ------------------------------------------------------------------- step 1

    private fun buildReasonChips() {
        val flow = binding.step1.reasonFlow
        flow.removeAllViews()
        reasonChips.clear()

        HrGenieContent.REASONS.forEach { reason ->
            val chip = ItemReasonChipBinding.inflate(layoutInflater, flow, false)
            chip.chip.text = reason
            chip.chip.setOnClickListener { viewModel.toggleReason(reason) }
            flow.addView(chip.chip)
            reasonChips[reason] = chip.chip
        }

        binding.step1.noteInput.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                viewModel.note = s?.toString().orEmpty()
            }

            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
        })
    }

    private fun renderReasonState() {
        val selected = viewModel.reasons.value.orEmpty()
        reasonChips.forEach { (reason, view) ->
            val isOn = reason in selected
            view.isSelected = isOn
            (view as? android.widget.TextView)?.setTextColor(
                androidx.core.content.ContextCompat.getColor(
                    requireContext(),
                    if (isOn) R.color.blue_deep else R.color.text_slate,
                )
            )
        }
    }

    // ------------------------------------------------------------------- step 2

    private fun renderConfirmation() {
        val mood = viewModel.mood ?: HrGenieContent.MOODS[1]
        binding.step2.doneEmoji.text = mood.emoji
        binding.step2.thanksLine.text = mood.thanksLine

        BarCharts.render(
            container = binding.step2.trendChart,
            values = viewModel.weeklyTrend.map { it.toFloat() },
            maxValue = 10f,
        )
    }

    // -------------------------------------------------------------------- shared

    private fun renderSelectedMood() {
        val key = viewModel.selectedMood.value
        moodRows.forEach { (moodKey, view) -> view.isSelected = moodKey == key }

        val mood = viewModel.mood ?: return
        binding.step1.whyEmoji.text = mood.emoji
        binding.step1.whyTitle.setText(
            if (mood.isPositive) R.string.mood_step1_title_positive
            else R.string.mood_step1_title_negative
        )
    }

    private fun showStep(step: Int) {
        if (binding.flipper.displayedChild != step) binding.flipper.displayedChild = step
        when (step) {
            1 -> binding.step1.whyContent.playScreenEntrance()
            2 -> {
                renderConfirmation()
                binding.step2.doneContent.playScreenEntrance()
            }
        }
    }

    private fun bindActions() {
        binding.backButton.setOnClickListener {
            if (!viewModel.goBack()) findNavController().popBackStack()
        }
        binding.step1.saveCheckIn.applyPressScale()
        binding.step1.saveCheckIn.setOnClickListener { saveCheckIn() }
        binding.step2.backToHome.setOnClickListener {
            viewModel.reset()
            findNavController().popBackStack(R.id.homeFragment, false)
        }
    }

    /**
     * Records the day's check-in, then shows the confirmation.
     *
     * The confirmation is not made to wait on the server: the repository writes to the
     * device first, so a ten-second check-in never turns into a spinner. The upload
     * follows and is logged if it fails — the entry is still here to re-send.
     */
    private fun saveCheckIn() {
        val employee = session.signedInEmployee
        val mood = viewModel.selectedMood.value
        if (employee != null && mood != null) {
            val repository = MoodRepository(requireContext(), authToken(session))
            val reasons = viewModel.reasons.value.orEmpty()
            val note = viewModel.note
            viewLifecycleOwner.lifecycleScope.launch {
                repository.save(
                    employeeId = employee.employeeId,
                    dateIso = HrGenieContent.todayIso,
                    mood = mood,
                    reasons = reasons,
                    note = note,
                )
            }
        }
        viewModel.save()
    }

    override fun onDestroyView() {
        reasonChips.clear()
        moodRows.clear()
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.bg_app, lightIcons = false)
    }
}
