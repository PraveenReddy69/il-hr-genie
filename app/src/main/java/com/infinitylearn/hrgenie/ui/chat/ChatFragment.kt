package com.infinitylearn.hrgenie.ui.chat

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.animation.OvershootInterpolator
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.VisibleForTesting
import androidx.annotation.DrawableRes
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.ChatRole
import com.infinitylearn.hrgenie.data.KbAnswer
import com.infinitylearn.hrgenie.data.VoicePrefs
import com.infinitylearn.hrgenie.databinding.FragmentChatBinding
import com.infinitylearn.hrgenie.databinding.ItemSuggestionChipBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.Speaker
import com.infinitylearn.hrgenie.ui.common.VoiceError
import com.infinitylearn.hrgenie.ui.common.VoiceRecorder
import com.infinitylearn.hrgenie.ui.common.applyImeAndBottomInsetPadding
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.ticketRepository
import kotlinx.coroutines.launch

class ChatFragment : Fragment() {

    private var _binding: FragmentChatBinding? = null
    private val binding get() = _binding!!

    private val viewModel: ChatViewModel by viewModels()
    private val session: SessionViewModel by activityViewModels()
    private lateinit var adapter: ChatAdapter

    private var voice: VoiceRecorder? = null
    private var speaker: Speaker? = null
    private var isRecording = false
    private var touchDownX = 0f
    private var recordedMillis = 0L
    private var autoSpeak = true
    private var lastSpokenAnswer: String? = null
    private val ticker = Handler(Looper.getMainLooper())

    /**
     * Asked for on the first press rather than up front — the permission dialog makes
     * far more sense once someone has reached for the mic.
     */
    private val micPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            Snackbar.make(binding.root, R.string.voice_ready, Snackbar.LENGTH_SHORT).show()
        } else {
            Snackbar.make(binding.root, R.string.voice_permission_denied, Snackbar.LENGTH_LONG)
                .show()
        }
    }

    /** Lets tests answer without a network round trip. */
    @VisibleForTesting
    internal fun useKnowledgeBase(answer: suspend (String) -> Result<KbAnswer>) {
        viewModel.knowledgeBase = answer
    }

    /** Drives a prompt card without laying out the RecyclerView. */
    @VisibleForTesting
    internal fun promptForTest(kind: PromptKind, primary: Boolean) =
        viewModel.onPrompt(kind, primary)

    /** Stands in for a dictated question, without a recogniser. */
    @VisibleForTesting
    internal fun sendByVoiceForTest(text: String) = viewModel.send(text, byVoice = true)

    /** The last answer handed to the speaker. Null when nothing was read out. */
    @VisibleForTesting
    internal fun spokenAnswerForTest(): String? = lastSpokenAnswer

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.appBar.applyTopInsetPadding()
        binding.composer.applyImeAndBottomInsetPadding()

        setUpSpeech()
        setUpList()
        setUpSuggestions()
        setUpComposer()

        binding.backButton.setOnClickListener { findNavController().popBackStack() }

        viewModel.greet(session.signedInEmployee?.firstName.orEmpty())
        announceTicketUpdates()
        viewModel.messages.observe(viewLifecycleOwner) { render() }
        viewModel.isTyping.observe(viewLifecycleOwner) { render() }
        viewModel.escalationVisible.observe(viewLifecycleOwner) { render() }
        viewModel.attachment.observe(viewLifecycleOwner) { attachment ->
            // The view model has no Context, so the store read happens here.
            if (attachment is ChatRow.TicketsWanted) {
                viewModel.showTickets(myTickets())
            } else {
                render()
            }
        }
    }

    private fun setUpList() {
        adapter = ChatAdapter(
            onSendQuestion = {
                viewModel.dismissEscalation()
                Snackbar.make(binding.root, R.string.escalation_sent, Snackbar.LENGTH_SHORT).show()
            },
            onBookMeeting = {
                viewModel.dismissEscalation()
                Snackbar.make(binding.root, R.string.escalation_booked, Snackbar.LENGTH_SHORT)
                    .show()
            },
            onChooseCategory = viewModel::chooseCategory,
            onRaiseTicket = ::raiseTicket,
            onCancelTicket = viewModel::cancelTicket,
            raisedByLine = ::raisedByLine,
            onPrompt = viewModel::onPrompt,
            onSpeak = { text -> speaker?.toggle(text) },
        )
        binding.messageList.layoutManager = LinearLayoutManager(requireContext()).apply {
            stackFromEnd = true
        }
        binding.messageList.adapter = adapter
    }

    // ----------------------------------------------------------------- tickets

    /**
     * The only place a ticket is raised.
     *
     * The server mints the id, so there is no offline path: a locally numbered ticket
     * would collide with the real one. If the call fails the employee is told, and the
     * draft is left intact so they can try again rather than retyping it.
     */
    private fun raiseTicket() {
        val draft = viewModel.draft ?: return
        val employee = session.signedInEmployee ?: return

        viewLifecycleOwner.lifecycleScope.launch {
            ticketRepository(session)
                .raise(employee.employeeId, draft.subject, draft.category)
                .onSuccess { if (_binding != null) viewModel.onTicketRaised(it) }
                .onFailure {
                    if (_binding == null) return@onFailure
                    Log.w(TAG, "Could not raise ticket", it)
                    viewModel.onTicketFailed()
                }
        }
    }

    /**
     * Anything HR moved since the last visit is announced on the way in, then marked
     * seen — so it is reported once, and a recreate does not repeat it.
     *
     * Pulls from the server first: HR moves tickets from their own device, so the
     * cache alone would never learn about it.
     */
    private fun announceTicketUpdates() {
        val employee = session.signedInEmployee ?: return
        val repository = ticketRepository(session)

        viewLifecycleOwner.lifecycleScope.launch {
            repository.refreshForEmployee(employee.employeeId)
            if (_binding == null) return@launch

            val updated = repository.unseenUpdates(employee.employeeId)
            if (updated.isEmpty()) return@launch

            viewModel.announceUpdates(updated)
            repository.markSeen(employee.employeeId)
        }
    }

    private fun myTickets() = session.signedInEmployee
        ?.let { ticketRepository(session).cachedForEmployee(it.employeeId) }
        .orEmpty()

    private fun raisedByLine(): String {
        val employee = session.signedInEmployee ?: return ""
        return getString(R.string.ticket_raised_by, employee.name, employee.employeeId)
    }

    private fun setUpSuggestions() {
        val row = binding.suggestionRow
        row.removeAllViews()

        // Ticket actions lead: they are what the composer row is for now. They carry an
        // icon and the questions do not, which is what separates doing something from
        // asking something at a glance.
        addChip(
            row,
            getString(R.string.chip_raise_ticket),
            first = true,
            icon = R.drawable.ic_chip_ticket_add,
        ) {
            viewModel.startTicket()
        }
        addChip(row, getString(R.string.chip_my_tickets), icon = R.drawable.ic_chip_tickets) {
            viewModel.showTickets(myTickets())
        }
        viewModel.suggestions.forEach { suggestion ->
            addChip(row, suggestion.question) { viewModel.send(suggestion.question) }
        }

        // The row is now long enough to scroll well off screen, and it was opening
        // part-way along — which hid the two ticket actions, the chips most likely to
        // be wanted. Pin it back to the start once the children have been measured.
        binding.suggestionScroller.post { binding.suggestionScroller.scrollTo(0, 0) }
    }

    private fun addChip(
        row: LinearLayout,
        label: String,
        first: Boolean = false,
        @DrawableRes icon: Int? = null,
        onClick: () -> Unit,
    ) {
        val chip = ItemSuggestionChipBinding.inflate(layoutInflater, row, false)
        chip.chip.text = label
        chip.chip.setOnClickListener { onClick() }

        if (icon != null) {
            chip.chip.setCompoundDrawablesRelativeWithIntrinsicBounds(icon, 0, 0, 0)
            chip.chip.compoundDrawablePadding = 6.dp(chip.chip)
            chip.chip.compoundDrawableTintList = ColorStateList.valueOf(
                ContextCompat.getColor(requireContext(), R.color.blue_primary)
            )
            // The glyph carries its own optical margin, so the leading padding comes in
            // to keep the chip from looking lopsided.
            chip.chip.setPaddingRelative(
                11.dp(chip.chip),
                chip.chip.paddingTop,
                chip.chip.paddingEnd,
                chip.chip.paddingBottom,
            )
        }

        val params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        if (!first) params.marginStart = 8.dp(row)
        row.addView(chip.root, params)
    }

    private fun setUpComposer() {
        binding.composerInput.setOnEditorActionListener { textView, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendTyped()
                true
            } else {
                false
            }
        }
        // The one button is a mic on an empty field and a send on a full one, so the
        // composer never shows an action that would do nothing.
        binding.composerInput.doAfterTextChanged { showSendAffordance(!it.isNullOrBlank()) }
        showSendAffordance(false)

        setUpVoiceInput()
    }

    // ------------------------------------------------------------- voice output

    /**
     * Answers can always be played by tapping a bubble; whether they play by
     * themselves is a preference, and it only fires for questions that were spoken.
     * Auto-reading an answer to something typed would be a surprise.
     */
    private fun setUpSpeech() {
        speaker = Speaker(requireContext()).apply {
            onSpeakingChanged = { text -> adapter.speakingText = text }
        }

        autoSpeak = VoicePrefs(requireContext()).isAutoSpeakEnabled()
        renderAutoSpeak()
        binding.autoSpeakToggle.setOnClickListener {
            autoSpeak = !autoSpeak
            VoicePrefs(requireContext()).setAutoSpeak(autoSpeak)
            if (!autoSpeak) speaker?.stop()
            renderAutoSpeak()
            Snackbar.make(
                binding.root,
                if (autoSpeak) R.string.voice_read_on else R.string.voice_read_off,
                Snackbar.LENGTH_SHORT,
            ).show()
        }

        viewModel.spokenAnswer.observe(viewLifecycleOwner) { answer ->
            answer ?: return@observe
            if (autoSpeak) {
                lastSpokenAnswer = answer
                speaker?.speak(answer)
            }
            // One-shot: clearing it stops a re-observe on recreate replaying the
            // answer at someone who has already heard it.
            viewModel.consumeSpokenAnswer()
        }
    }

    private fun renderAutoSpeak() {
        binding.autoSpeakToggle.setImageResource(
            if (autoSpeak) R.drawable.ic_speaker else R.drawable.ic_speaker_off
        )
        binding.autoSpeakToggle.imageTintList = ColorStateList.valueOf(
            ContextCompat.getColor(
                requireContext(),
                if (autoSpeak) R.color.blue_deep else R.color.text_muted,
            )
        )
    }

    // -------------------------------------------------------------- voice input

    /**
     * The mic is a press-and-hold: down starts dictating, up sends what was heard,
     * and dragging left past a threshold throws it away. Once there is typed text the
     * same button is a plain send tap instead.
     */
    private fun setUpVoiceInput() {
        voice = VoiceRecorder(requireContext()).apply {
            onPartial = { text -> binding.recordingHint.text = text }
            onResult = { text ->
                stopRecordingUi()
                // Straight to the knowledge base, flagged as spoken so the answer
                // can be read back.
                viewModel.send(text, byVoice = true)
            }
            onError = { error ->
                stopRecordingUi()
                Snackbar.make(binding.root, messageFor(error), Snackbar.LENGTH_SHORT).show()
            }
            onLevel = { level ->
                // Only while held, so a stray callback cannot leave it inflated.
                if (isRecording) binding.micButton.scaleX = 1f + level * 0.12f
                if (isRecording) binding.micButton.scaleY = 1f + level * 0.12f
            }
        }

        binding.micButton.setOnTouchListener { view, event ->
            if (!binding.composerInput.text.isNullOrBlank()) {
                // Typed text wins: let the click listener send it.
                return@setOnTouchListener false
            }
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    view.parent?.requestDisallowInterceptTouchEvent(true)
                    touchDownX = event.rawX
                    requestMicThenRecord()
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    if (isRecording) dragMic(event.rawX - touchDownX)
                    true
                }

                MotionEvent.ACTION_UP -> {
                    // Settle on release rather than waiting for the recogniser to
                    // finish — the button should follow the finger, not the network.
                    settleMic()
                    if (isRecording) voice?.stop()
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    settleMic()
                    if (isRecording) cancelRecording()
                    true
                }

                else -> false
            }
        }

        binding.micButton.setOnClickListener { sendTyped() }
    }

    private fun requestMicThenRecord() {
        val granted = ContextCompat.checkSelfPermission(
            requireContext(), Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

        if (granted) startRecording() else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun startRecording() {
        val recorder = voice ?: return
        if (!recorder.isAvailable) {
            Snackbar.make(binding.root, R.string.voice_unavailable, Snackbar.LENGTH_SHORT).show()
            return
        }

        isRecording = true
        recordedMillis = 0L
        binding.recordingBar.visibility = View.VISIBLE
        binding.recordingHint.setText(R.string.voice_slide_to_cancel)
        binding.recordingTimer.text = getString(R.string.voice_timer, 0, 0)
        binding.micButton.setBackgroundResource(R.drawable.bg_mic_recording)
        binding.micButton.isHapticFeedbackEnabled = true
        binding.micButton.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)

        recorder.start()
        ticker.post(tick)
    }

    /**
     * Drags the mic with the finger, so the cancel gesture shows its own progress.
     *
     * It used to sit still until the threshold tripped and the recording vanished,
     * which gave no clue how far was far enough. Now it follows the finger, fades as
     * the cancel point nears, and takes the hint text with it.
     *
     * Leftward only — dragging right is not a gesture, and letting the button wander
     * off the other side would just look broken. Movement past the threshold is
     * damped so the control feels tethered rather than flung.
     */
    private fun dragMic(dx: Float) {
        val binding = _binding ?: return
        val threshold = cancelThresholdPx()
        val pulled = dx.coerceAtMost(0f)

        val travel = if (-pulled <= threshold) {
            pulled
        } else {
            -(threshold + (-pulled - threshold) * RUBBER_BAND)
        }
        val progress = (-pulled / threshold).coerceIn(0f, 1f)

        binding.micButton.translationX = travel
        binding.micButton.alpha = 1f - FADE_AT_CANCEL * progress
        // The hint travels with it, at a slower rate, so the two read as one gesture.
        binding.recordingHint.translationX = travel * HINT_DRIFT
        binding.recordingHint.alpha = 1f - progress

        if (-pulled >= threshold) cancelRecording()
    }

    /** Springs the mic home. A slight overshoot reads as elastic rather than mechanical. */
    private fun settleMic() {
        val binding = _binding ?: return
        binding.micButton.animate()
            .translationX(0f)
            .alpha(1f)
            .setDuration(260L)
            .setInterpolator(OvershootInterpolator(2.4f))
            .start()
        binding.recordingHint.translationX = 0f
        binding.recordingHint.alpha = 1f
    }

    private fun cancelRecording() {
        voice?.cancel()
        stopRecordingUi()
        Snackbar.make(binding.root, R.string.voice_cancelled, Snackbar.LENGTH_SHORT).show()
    }

    private fun stopRecordingUi() {
        isRecording = false
        ticker.removeCallbacks(tick)
        _binding?.let {
            it.recordingBar.visibility = View.GONE
            it.micButton.setBackgroundResource(R.drawable.bg_mic)
            it.micButton.scaleX = 1f
            it.micButton.scaleY = 1f
        }
        settleMic()
    }

    /** Half the screen width would be a drag; 90dp is a deliberate flick. */
    private fun cancelThresholdPx(): Float = 90f * resources.displayMetrics.density

    private val tick = object : Runnable {
        override fun run() {
            if (!isRecording) return
            recordedMillis += TICK_MS
            val seconds = (recordedMillis / 1000).toInt()
            _binding?.recordingTimer?.text =
                getString(R.string.voice_timer, seconds / 60, seconds % 60)
            ticker.postDelayed(this, TICK_MS)
        }
    }

    private fun messageFor(error: VoiceError): Int = when (error) {
        VoiceError.NO_SPEECH -> R.string.voice_no_speech
        VoiceError.NO_PERMISSION -> R.string.voice_permission_denied
        VoiceError.NETWORK -> R.string.voice_network
        VoiceError.BUSY -> R.string.voice_busy
        VoiceError.UNAVAILABLE -> R.string.voice_unavailable
        VoiceError.OTHER -> R.string.voice_failed
    }

    private fun showSendAffordance(canSend: Boolean) {
        binding.micButton.setImageResource(if (canSend) R.drawable.ic_send else R.drawable.ic_mic)
        binding.micButton.contentDescription = getString(
            if (canSend) R.string.cd_send else R.string.cd_voice_input
        )
        // The plane reads small at the mic's padding, so it gets a touch more room.
        val padding = (if (canSend) 13 else 14).dp(binding.micButton)
        binding.micButton.setPadding(padding, padding, padding, padding)
    }

    private fun sendTyped() {
        val typed = binding.composerInput.text.toString()
        if (typed.isBlank()) return
        viewModel.send(typed)
        binding.composerInput.setText("")
    }

    private fun render() {
        val rows = buildList {
            add(ChatRow.Day)
            viewModel.messages.value.orEmpty().forEach { message ->
                add(
                    when (message.role) {
                        ChatRole.BOT -> ChatRow.Bot(
                            message.text, message.source, message.isOffline, message.at,
                        )
                        ChatRole.ME -> ChatRow.User(message.text, message.at)
                    }
                )
            }
            if (viewModel.isTyping.value == true) add(ChatRow.Typing)
            viewModel.attachment.value
                ?.takeUnless { it is ChatRow.TicketsWanted }
                ?.let(::add)
            if (viewModel.escalationVisible.value == true) add(ChatRow.Escalation)
        }
        adapter.submitList(rows) {
            if (rows.isNotEmpty()) binding.messageList.scrollToPosition(rows.lastIndex)
        }
    }

    override fun onDestroyView() {
        stopRecordingUi()
        voice?.release()
        voice = null
        speaker?.release()
        speaker = null
        binding.messageList.adapter = null
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.surface, lightIcons = false)
    }

    private companion object {
        /** Timer resolution while holding the mic. */
        const val TICK_MS = 200L
        const val TAG = "HrGenieTickets"

        /** How much of the drag past the cancel point still moves the button. */
        const val RUBBER_BAND = 0.25f

        /** How faint the mic goes by the moment it cancels. */
        const val FADE_AT_CANCEL = 0.45f

        /** The hint trails the mic rather than matching it, which reads as depth. */
        const val HINT_DRIFT = 0.4f
    }
}
