package com.infinitylearn.hrgenie.ui.insights

import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.setFragmentResult
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.Ticket
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.data.TicketRepository
import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.databinding.ItemStatusOptionBinding
import com.infinitylearn.hrgenie.databinding.ItemTicketCommentBinding
import com.infinitylearn.hrgenie.databinding.SheetHrTicketBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.ticketRepository
import kotlinx.coroutines.launch

/**
 * One ticket: where it stands, what HR has already done, and the move they want to
 * make next.
 *
 * Resolving requires a note. Closing a request is the one transition the employee
 * cannot ask about afterwards — it has to say what was done. The server enforces the
 * same rule, so the check does not live only in the UI.
 */
class HrTicketSheet : BottomSheetDialogFragment() {

    private var _binding: SheetHrTicketBinding? = null
    private val binding get() = _binding!!

    private val session: SessionViewModel by activityViewModels()

    private val ticketId: String get() = requireArguments().getString(ARG_TICKET_ID)!!
    private val actorId: String get() = arguments?.getString(ARG_ACTOR_ID).orEmpty()

    /** The status HR has picked but not yet applied. */
    private var selected: TicketStatus? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = SheetHrTicketBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val ticket = ticketRepository(session).cachedAll().firstOrNull { it.id == ticketId }
        if (ticket == null) {
            dismiss()
            return
        }
        bind(ticket)
    }

    private fun bind(ticket: Ticket) {
        binding.ticketSheetId.text = ticket.id
        binding.ticketSheetCategory.text = ticket.category
        binding.ticketSheetSubject.text = ticket.subject

        val raiser = EmployeeDirectory.find(ticket.employeeId)
        binding.ticketSheetRaisedBy.text = getString(
            R.string.ticket_raised_meta,
            raiser?.name ?: ticket.employeeId,
            raiser?.department.orEmpty(),
            ticket.ageLabel(System.currentTimeMillis()),
        )

        bindOutcome(ticket)
        bindOptions(ticket)
        bindHistory(ticket)

        binding.commentInput.doAfterTextChanged { binding.commentError.visibility = View.GONE }
        binding.applyUpdate.setOnClickListener { apply(ticket) }
        updateCommentLabel()
        updateApplyLabel()
    }

    /**
     * A closed ticket reports rather than asks: the resolution leads, and the status
     * controls stay behind an explicit Reopen. Anything still live goes straight to
     * the controls.
     */
    private fun bindOutcome(ticket: Ticket) {
        val resolved = ticket.status == TicketStatus.RESOLVED
        binding.resolvedBanner.visibility = if (resolved) View.VISIBLE else View.GONE
        binding.reopenButton.visibility = if (resolved) View.VISIBLE else View.GONE
        binding.updateSection.visibility = if (resolved) View.GONE else View.VISIBLE
        if (!resolved) return

        val closing = ticket.comments.lastOrNull { it.status == TicketStatus.RESOLVED }
        binding.resolvedNote.text = closing?.text.orEmpty()
        binding.resolvedNote.visibility =
            if (closing == null) View.GONE else View.VISIBLE
        binding.resolvedMeta.text = getString(
            R.string.ticket_closed_meta,
            closing?.authorId?.let { EmployeeDirectory.find(it)?.firstName }
                ?: getString(R.string.ticket_author_hr),
            ticket.ageLabel(System.currentTimeMillis()),
        )

        binding.reopenButton.setOnClickListener {
            selected = TicketStatus.OPEN
            binding.reopenButton.visibility = View.GONE
            binding.updateSection.visibility = View.VISIBLE
            bindOptions(ticket)
            updateCommentLabel()
            updateApplyLabel()
        }
    }

    // ------------------------------------------------------------------- choosing

    private fun bindOptions(ticket: Ticket) {
        val list = binding.statusOptions
        list.removeAllViews()

        TicketStatus.entries.forEachIndexed { index, status ->
            val option = ItemStatusOptionBinding.inflate(layoutInflater, list, false)
            option.statusLabel.text = status.label
            option.statusDot.background = dot(colorFor(status))
            option.statusCurrent.visibility =
                if (status == ticket.status) View.VISIBLE else View.GONE
            option.statusOption.setBackgroundResource(
                if (status == selected) {
                    R.drawable.bg_status_option_selected
                } else {
                    R.drawable.bg_status_option
                }
            )

            if (status == ticket.status) {
                // Already there — re-applying it would be a no-op.
                option.statusOption.isClickable = false
                option.statusOption.alpha = 0.62f
            } else {
                option.statusOption.setOnClickListener {
                    selected = status
                    binding.commentError.visibility = View.GONE
                    bindOptions(ticket)
                    updateCommentLabel()
                    updateApplyLabel()
                }
            }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.topMargin = (8 * resources.displayMetrics.density).toInt()
            list.addView(option.root, params)
        }
    }

    /** Names the move, so the button says what it will do. */
    private fun updateApplyLabel() {
        val status = selected
        binding.applyUpdate.text = if (status == null) {
            getString(R.string.ticket_apply_update)
        } else {
            getString(R.string.ticket_move_to, status.label)
        }
    }

    /** Says up front whether a note is required, rather than failing on submit. */
    private fun updateCommentLabel() {
        binding.commentLabel.setText(
            if (selected == TicketStatus.RESOLVED) {
                R.string.ticket_comment_label_required
            } else {
                R.string.ticket_comment_label
            }
        )
    }

    // ------------------------------------------------------------------- applying

    private fun apply(ticket: Ticket) {
        val status = selected
        if (status == null) {
            binding.commentError.setText(R.string.ticket_status_required)
            binding.commentError.visibility = View.VISIBLE
            return
        }

        val comment = binding.commentInput.text.toString().trim()
        // Refused here as well as on the server, so the employee-facing rule does not
        // depend on a round trip to be enforced.
        if (status == TicketStatus.RESOLVED && comment.isEmpty()) {
            showError(R.string.ticket_comment_required)
            binding.commentInput.requestFocus()
            return
        }

        setBusy(true)
        viewLifecycleOwner.lifecycleScope.launch {
            val result = ticketRepository(session)
                .updateStatus(ticket.id, status, comment, actorId)
            if (_binding == null) return@launch
            setBusy(false)

            result.onSuccess {
                setFragmentResult(
                    RESULT_KEY,
                    bundleOf(RESULT_TICKET_ID to ticket.id, RESULT_STATUS to status.name),
                )
                dismiss()
            }.onFailure { error ->
                // The sheet stays open with the note intact: this is HR's write-up of
                // what they did, and losing it to a dropped connection would be worse
                // than the failure itself.
                Log.w(TAG, "Could not move ${ticket.id}", error)
                val failure = (error as? ApiException)?.failure
                showError(
                    when {
                        failure is ApiFailure.Http && failure.code == HTTP_FORBIDDEN ->
                            R.string.ticket_update_forbidden
                        // The server enforces the resolve-needs-a-note rule too, and
                        // says so with its own status. The sheet checks first, so this
                        // is the backstop rather than the usual path.
                        failure is ApiFailure.Http && failure.code == HTTP_UNPROCESSABLE ->
                            R.string.ticket_comment_required
                        failure is ApiFailure.Http -> R.string.ticket_update_rejected
                        else -> R.string.ticket_update_unreachable
                    }
                )
            }
        }
    }

    private fun showError(message: Int) {
        binding.commentError.setText(message)
        binding.commentError.visibility = View.VISIBLE
    }

    /** The update is a network call now, so the button has to say it is working. */
    private fun setBusy(busy: Boolean) {
        binding.applyUpdate.isEnabled = !busy
        binding.applyUpdate.alpha = if (busy) 0.6f else 1f
        if (busy) binding.applyUpdate.setText(R.string.ticket_updating) else updateApplyLabel()
    }

    // -------------------------------------------------------------------- history

    private fun bindHistory(ticket: Ticket) {
        val list = binding.commentHistory
        list.removeAllViews()
        if (ticket.comments.isEmpty()) {
            list.visibility = View.GONE
            return
        }
        list.visibility = View.VISIBLE

        list.addView(historyHeading())
        ticket.comments.asReversed().forEach { comment ->
            val row = ItemTicketCommentBinding.inflate(layoutInflater, list, false)
            row.commentStatus.text = comment.status.label
            row.commentText.text = comment.text
            row.commentAuthor.text = EmployeeDirectory.find(comment.authorId)?.firstName
                ?: getString(R.string.ticket_author_hr)
            row.commentDot.background = dot(colorFor(comment.status))
            list.addView(row.root)
        }
    }

    private fun historyHeading() = android.widget.TextView(requireContext()).apply {
        setText(R.string.ticket_history)
        isAllCaps = true
        letterSpacing = 0.06f
        setTextColor(ContextCompat.getColor(requireContext(), R.color.text_secondary))
        textSize = 10.5f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    // ------------------------------------------------------------------- plumbing

    private fun dot(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ContextCompat.getColor(requireContext(), color))
    }

    private fun colorFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_warn
        TicketStatus.IN_PROGRESS -> R.color.blue_primary
        TicketStatus.RESOLVED -> R.color.green_ok
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "hr-ticket"
        const val RESULT_KEY = "hr-ticket-status"
        const val RESULT_TICKET_ID = "ticketId"
        const val RESULT_STATUS = "status"

        private const val HTTP_FORBIDDEN = 403
        private const val HTTP_UNPROCESSABLE = 422

        private const val ARG_TICKET_ID = "ticketId"
        private const val ARG_ACTOR_ID = "actorId"

        fun newInstance(ticketId: String, actorId: String) = HrTicketSheet().apply {
            arguments = bundleOf(ARG_TICKET_ID to ticketId, ARG_ACTOR_ID to actorId)
        }
    }
}
