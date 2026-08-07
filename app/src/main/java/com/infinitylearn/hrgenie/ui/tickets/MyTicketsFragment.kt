package com.infinitylearn.hrgenie.ui.tickets

import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.annotation.ColorRes
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.MainActivity
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.Ticket
import com.infinitylearn.hrgenie.data.TicketRepository
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.databinding.FragmentMyTicketsBinding
import com.infinitylearn.hrgenie.databinding.ItemFilterChipBinding
import com.infinitylearn.hrgenie.databinding.ItemMyTicketBinding
import com.infinitylearn.hrgenie.databinding.ItemTicketCommentBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import com.infinitylearn.hrgenie.ui.common.ticketRepository
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * The employee's own tickets: what they raised, where each one stands, and what HR
 * wrote against it.
 *
 * Read-only by design — status is HR's to move. Raising a new one hands off to chat,
 * which is the only place a ticket is created.
 */
class MyTicketsFragment : Fragment() {

    private var _binding: FragmentMyTicketsBinding? = null
    private val binding get() = _binding!!

    private val session: SessionViewModel by activityViewModels()

    /** Status the list is filtered to; null shows everything. */
    private var filter: TicketStatus? = null

    /** Rows the employee has expanded, kept across a re-render. */
    private val expanded = mutableSetOf<String>()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentMyTicketsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.headerContent.applyTopInsetPadding()
        binding.content.playScreenEntrance()

        // Arrived from a notification: open that ticket's activity straight away,
        // so the tap lands on the answer rather than on a list to hunt through.
        arguments?.getString(MainActivity.ARG_TICKET_ID)?.let { ticketId ->
            expanded += ticketId
            // Consumed, so a rotation does not re-expand what the user collapsed.
            arguments?.remove(MainActivity.ARG_TICKET_ID)
        }

        binding.raiseTicketCta.setOnClickListener {
            findNavController().navigate(R.id.action_myTickets_to_chat)
        }
    }

    /**
     * Draws what is cached, then refreshes from the server and draws again.
     *
     * Cache-first because HR may have moved a ticket from their own device: the list
     * has to be re-read, but showing a spinner over a list we already have would be a
     * step backwards.
     */
    private fun render() {
        val employee = session.signedInEmployee ?: return
        val repository = ticketRepository(session)

        draw(repository.cachedForEmployee(employee.employeeId), repository)

        viewLifecycleOwner.lifecycleScope.launch {
            val fresh = repository.refreshForEmployee(employee.employeeId)
            if (_binding == null) return@launch
            if (fresh) {
                draw(repository.cachedForEmployee(employee.employeeId), repository)
            } else {
                // Say the list may be behind rather than passing it off as current.
                Snackbar.make(binding.root, R.string.tickets_offline, Snackbar.LENGTH_SHORT)
                    .show()
            }
        }
    }

    private fun draw(tickets: List<Ticket>, repository: TicketRepository) {
        // Seeing the status here counts as seeing it, so chat has nothing left to
        // announce and the unread dot clears.
        repository.markSeen(session.signedInEmployee?.employeeId.orEmpty())

        bindHeader(tickets)
        bindFilters(tickets)
        bindList(tickets)
    }

    private fun bindHeader(tickets: List<Ticket>) {
        binding.myTicketsSubtitle.text = getString(
            R.string.my_tickets_sub, tickets.size, tickets.count { it.isOpen },
        )
    }

    // ------------------------------------------------------------------- filters

    private fun bindFilters(tickets: List<Ticket>) {
        // Nothing raised at all: a filter row over an empty list is just noise.
        binding.myTicketFilterScroller.visibility =
            if (tickets.isEmpty()) View.GONE else View.VISIBLE
        if (tickets.isEmpty()) return

        val row = binding.myTicketFilters
        row.removeAllViews()

        val filters = buildList {
            add(null to tickets.size)
            TicketStatus.entries.forEach { status ->
                add(status to tickets.count { it.status == status })
            }
        }

        filters.forEachIndexed { index, (status, count) ->
            val chip = ItemFilterChipBinding.inflate(layoutInflater, row, false)
            val label = status?.label ?: getString(R.string.hr_filter_all)
            chip.filterChip.text = getString(R.string.hr_filter_chip, label, count)
            chip.filterChip.isSelected = status == filter
            chip.filterChip.alpha = if (count == 0 && status != filter) 0.5f else 1f
            chip.filterChip.setOnClickListener {
                filter = status
                render()
            }

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            if (index > 0) params.marginStart = 7.dp(row)
            row.addView(chip.root, params)
        }
    }

    // ---------------------------------------------------------------- the tickets

    private fun bindList(tickets: List<Ticket>) {
        val list = binding.myTicketList
        list.removeAllViews()

        val filtered = filter?.let { status -> tickets.filter { it.status == status } } ?: tickets
        if (filtered.isEmpty()) {
            bindEmpty(nothingAtAll = tickets.isEmpty())
            return
        }
        binding.myTicketsEmpty.visibility = View.GONE

        val now = System.currentTimeMillis()
        filtered.forEachIndexed { index, ticket ->
            val row = ItemMyTicketBinding.inflate(layoutInflater, list, false)
            val accent = ContextCompat.getColor(requireContext(), colorFor(ticket.status))
            val tint = ColorStateList.valueOf(
                ContextCompat.getColor(requireContext(), fillFor(ticket.status))
            )

            row.myTicketSubject.text = ticket.subject.sentenceCased()
            row.myTicketId.text = ticket.id
            // The reference has its own chip now, so the meta line carries the rest.
            row.myTicketMeta.text = getString(
                R.string.hr_meta_pair, ticket.category, ticket.ageLabel(now),
            )

            row.myTicketStatus.text = ticket.status.label
            row.myTicketStatus.backgroundTintList = tint
            row.myTicketStatus.setTextColor(accent)

            row.myTicketGlyph.setText(glyphFor(ticket.status))
            row.myTicketGlyph.backgroundTintList = tint
            row.myTicketGlyph.setTextColor(accent)

            bindActivity(row, ticket)

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            // Cards are separated by air rather than a rule; a hairline between two
            // bordered cards reads as a double line.
            if (index > 0) params.topMargin = 10.dp(list)
            list.addView(row.root, params)
        }
    }

    /** "what does my insurance cover" -> "What does my insurance cover". */
    private fun String.sentenceCased(): String =
        replaceFirstChar { it.titlecase(Locale.getDefault()) }

    /** HR's notes, revealed on tap. A ticket with none has nothing to expand. */
    private fun bindActivity(row: ItemMyTicketBinding, ticket: Ticket) {
        val panel = row.myTicketActivity
        panel.removeAllViews()

        if (ticket.comments.isEmpty()) {
            row.myTicketChevron.visibility = View.GONE
            row.myTicketHeader.isClickable = false
            panel.visibility = View.GONE
            return
        }

        ticket.comments.asReversed().forEach { comment ->
            val line = ItemTicketCommentBinding.inflate(layoutInflater, panel, false)
            line.commentStatus.text = comment.status.label
            line.commentText.text = comment.text
            line.commentAuthor.text = EmployeeDirectory.find(comment.authorId)?.firstName
                ?: getString(R.string.ticket_author_hr)
            line.commentDot.background = dot(colorFor(comment.status))
            panel.addView(line.root)
        }

        val isOpen = ticket.id in expanded
        row.myTicketChevron.visibility = View.VISIBLE
        row.myTicketChevron.setText(if (isOpen) R.string.chevron_up else R.string.chevron_down)
        panel.visibility = if (isOpen) View.VISIBLE else View.GONE

        row.myTicketHeader.setOnClickListener {
            if (!expanded.remove(ticket.id)) expanded += ticket.id
            bindActivity(row, ticket)
        }
    }

    private fun bindEmpty(nothingAtAll: Boolean) {
        binding.myTicketsEmpty.visibility = View.VISIBLE
        if (nothingAtAll) {
            binding.myTicketsEmptyTitle.setText(R.string.my_tickets_empty_title)
            binding.myTicketsEmptyBody.setText(R.string.my_tickets_empty_body)
        } else {
            binding.myTicketsEmptyTitle.text = getString(
                R.string.my_tickets_filter_empty_title,
                filter?.label?.lowercase(Locale.getDefault()).orEmpty(),
            )
            binding.myTicketsEmptyBody.setText(R.string.my_tickets_filter_empty_body)
        }
    }

    // ------------------------------------------------------------------ plumbing

    private fun dot(@ColorRes color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ContextCompat.getColor(requireContext(), color))
    }

    private fun glyphFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.string.ticket_glyph_open
        TicketStatus.IN_PROGRESS -> R.string.ticket_glyph_progress
        TicketStatus.RESOLVED -> R.string.ticket_glyph_resolved
    }

    private fun colorFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_warn
        TicketStatus.IN_PROGRESS -> R.color.blue_primary
        TicketStatus.RESOLVED -> R.color.green_ok
    }

    private fun fillFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_tint_14
        TicketStatus.IN_PROGRESS -> R.color.blue_tint_10
        TicketStatus.RESOLVED -> R.color.green_tint_14
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
}
