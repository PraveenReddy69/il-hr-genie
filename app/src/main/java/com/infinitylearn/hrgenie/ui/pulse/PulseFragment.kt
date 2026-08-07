package com.infinitylearn.hrgenie.ui.pulse

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.PulseEntry
import com.infinitylearn.hrgenie.data.PulseRepository
import com.infinitylearn.hrgenie.data.PulseStore
import com.infinitylearn.hrgenie.databinding.FragmentPulseBinding
import com.infinitylearn.hrgenie.databinding.ItemPulseAnswerBinding
import com.infinitylearn.hrgenie.databinding.ItemPulseOptionBinding
import com.infinitylearn.hrgenie.databinding.ItemPulseOutcomeBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyBottomInsetPadding
import com.infinitylearn.hrgenie.ui.common.applyPressScale
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import com.infinitylearn.hrgenie.ui.common.authToken
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PulseFragment : Fragment() {

    private var _binding: FragmentPulseBinding? = null
    private val binding get() = _binding!!

    private val viewModel: PulseViewModel by viewModels()
    private val session: SessionViewModel by activityViewModels()
    private val pulses: PulseStore by lazy { PulseStore(requireContext().applicationContext) }

    /** True while showing the "already answered" state rather than the questionnaire. */
    private var alreadyAnswered = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentPulseBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.progressRow.applyTopInsetPadding()
        binding.question.questionContent.applyBottomInsetPadding()
        binding.complete.completeContent.applyBottomInsetPadding()

        binding.question.pulseEyebrow.text =
            getString(R.string.pulse_eyebrow, HrGenieContent.currentMonthName)

        buildSegments()
        buildOutcomes()

        // Answered already this month? Greet them instead of asking again.
        val logged = session.signedInEmployee?.let {
            pulses.entry(it.employeeId, HrGenieContent.currentCycle)
        }
        if (logged != null) {
            alreadyAnswered = true
            renderAlreadyAnswered(logged)
            return
        }

        binding.backButton.setOnClickListener {
            if (!viewModel.goBack()) findNavController().popBackStack()
        }
        binding.question.skipQuestion.setOnClickListener { viewModel.skip() }
        binding.complete.doneButton.applyPressScale()
        binding.complete.doneButton.setOnClickListener {
            viewModel.reset()
            findNavController().popBackStack(R.id.homeFragment, false)
        }

        viewModel.index.observe(viewLifecycleOwner) { renderQuestion() }
        viewModel.isComplete.observe(viewLifecycleOwner) { complete ->
            binding.flipper.displayedChild = if (complete) 1 else 0
            if (complete) {
                persistAnswers()
                binding.complete.completeContent.playScreenEntrance()
            }
            renderSegments()
        }

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

    // ------------------------------------------------------------------ progress

    private fun buildSegments() {
        val row = binding.segments
        row.removeAllViews()
        viewModel.questions.forEachIndexed { index, _ ->
            val segment = View(requireContext())
            val params = LinearLayout.LayoutParams(0, 4.dp(row), 1f)
            if (index > 0) params.marginStart = 5.dp(row)
            row.addView(segment, params)
        }
        renderSegments()
    }

    private fun renderSegments() {
        val reached = if (viewModel.isComplete.value == true) {
            viewModel.questions.lastIndex
        } else {
            viewModel.index.value ?: 0
        }
        for (i in 0 until binding.segments.childCount) {
            binding.segments.getChildAt(i).setBackgroundResource(
                if (i <= reached) R.drawable.bg_segment_done else R.drawable.bg_segment_pending
            )
        }
    }

    // ------------------------------------------------------------------ question

    private fun renderQuestion() {
        val question = viewModel.currentQuestion
        binding.question.questionText.text = question.text
        binding.question.questionHint.text = question.hint
        binding.counter.text = getString(
            R.string.pulse_counter,
            (viewModel.index.value ?: 0) + 1,
            viewModel.questions.size,
        )

        val list = binding.question.optionList
        list.removeAllViews()
        question.options.forEachIndexed { index, option ->
            val row = ItemPulseOptionBinding.inflate(layoutInflater, list, false)
            row.optionLabel.text = option
            row.root.setOnClickListener { viewModel.answer(option) }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 10.dp(list)
            list.addView(row.root, params)
        }

        binding.question.questionContent.playScreenEntrance()
        renderSegments()
    }

    // ----------------------------------------------------------- already answered

    /**
     * Stores the answers, then sends them.
     *
     * Device first, same reasoning as the mood check-in: the employee has finished,
     * and the summary should appear whether or not the network is there.
     */
    private fun persistAnswers() {
        val employee = session.signedInEmployee ?: return
        val repository = PulseRepository(requireContext(), authToken(session))
        val answers = viewModel.answers
        viewLifecycleOwner.lifecycleScope.launch {
            repository.submit(
                employeeId = employee.employeeId,
                cycle = HrGenieContent.currentCycle,
                answers = answers,
            )
        }
    }

    /** The month is closed for this employee: show what they said and what changed. */
    private fun renderAlreadyAnswered(entry: PulseEntry) {
        binding.progressRow.visibility = View.INVISIBLE
        binding.flipper.displayedChild = 2

        binding.done.pulseDoneTitle.text =
            getString(R.string.pulse_month_done_title, HrGenieContent.currentMonthName)
        binding.done.pulseDoneGreeting.text = getString(
            R.string.pulse_done_greeting,
            session.signedInEmployee?.firstName.orEmpty(),
            formatAnsweredOn(entry.completedAtMillis),
        )

        val list = binding.done.pulseAnswerList
        list.removeAllViews()
        HrGenieContent.PULSE_QUESTIONS.forEachIndexed { index, question ->
            val row = ItemPulseAnswerBinding.inflate(layoutInflater, list, false)
            row.answerQuestion.text = question.text
            val answer = entry.answers[question.id]
            row.answerValue.text = answer ?: getString(R.string.pulse_done_skipped)
            row.answerValue.setTextColor(
                ContextCompat.getColor(
                    requireContext(),
                    if (answer == null) R.color.white_45 else R.color.white,
                )
            )

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 14.dp(list)
            list.addView(row.root, params)
        }

        buildOutcomeList(binding.done.pulseDoneOutcomes)
        binding.done.pulseDoneButton.applyPressScale()
        binding.done.pulseDoneButton.setOnClickListener {
            findNavController().popBackStack(R.id.homeFragment, false)
        }
        binding.done.pulseDoneContent.playScreenEntrance()
    }

    private fun formatAnsweredOn(millis: Long): String =
        SimpleDateFormat("d MMMM", Locale.getDefault()).format(Date(millis))

    // ------------------------------------------------------------------ outcomes

    private fun buildOutcomes() = buildOutcomeList(binding.complete.outcomeList)

    private fun buildOutcomeList(list: LinearLayout) {
        list.removeAllViews()
        HrGenieContent.PULSE_OUTCOMES.forEachIndexed { index, outcome ->
            val row = ItemPulseOutcomeBinding.inflate(layoutInflater, list, false)
            row.outcomeText.text = outcome

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = 12.dp(list)
            list.addView(row.root, params)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
    }
}
