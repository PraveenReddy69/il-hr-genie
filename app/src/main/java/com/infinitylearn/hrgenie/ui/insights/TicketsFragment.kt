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
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.Ticket
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.databinding.FragmentTicketsBinding
import com.infinitylearn.hrgenie.databinding.ItemFilterChipBinding
import com.infinitylearn.hrgenie.databinding.ItemLegendRowBinding
import com.infinitylearn.hrgenie.databinding.ItemTicketRowBinding
import com.infinitylearn.hrgenie.ui.common.DonutSegment
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import com.infinitylearn.hrgenie.ui.common.ticketRepository
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * The whole ticket queue: the status mix, the filters, and every ticket. The
 * dashboard card is a summary that links here; this is where HR works.
 */
class TicketsFragment : Fragment() {

    private var _binding: FragmentTicketsBinding? = null
    private val binding get() = _binding!!

    private val session: SessionViewModel by activityViewModels()

    /** Status the queue is filtered to; null shows everything. */
    private var filter: TicketStatus? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentTicketsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.header.applyTopInsetPadding()
        binding.content.playScreenEntrance()

        binding.backButton.setOnClickListener { findNavController().popBackStack() }

        childFragmentManager.setFragmentResultListener(
            HrTicketSheet.RESULT_KEY,
            viewLifecycleOwner,
        ) { _, result ->
            val ticketId = result.getString(HrTicketSheet.RESULT_TICKET_ID).orEmpty()
            val status = result.getString(HrTicketSheet.RESULT_STATUS)
                ?.let { runCatching { TicketStatus.valueOf(it) }.getOrNull() }
                ?: return@setFragmentResultListener

            render()
            Snackbar.make(
                binding.root,
                getString(R.string.ticket_status_updated, ticketId, status.label),
                Snackbar.LENGTH_SHORT,
            ).show()
        }
    }

    /**
     * Cache first, then the server. Employees raise tickets from their own phones, so
     * this list is stale the moment it is drawn — but drawing the known set beats an
     * empty screen while the fetch runs.
     */
    private fun render() {
        val repository = ticketRepository(session)
        draw(repository.cachedAll())

        viewLifecycleOwner.lifecycleScope.launch {
            val fresh = repository.refreshAll()
            if (_binding == null) return@launch
            if (fresh) {
                draw(repository.cachedAll())
            } else {
                Snackbar.make(binding.root, R.string.tickets_offline, Snackbar.LENGTH_SHORT)
                    .show()
            }
        }
    }

    private fun draw(tickets: List<Ticket>) {
        bindHeader(tickets)
        bindMix(tickets)
        bindFilters(tickets)
        bindList(tickets)
    }

    private fun bindHeader(tickets: List<Ticket>) {
        val open = tickets.count { it.isOpen }
        binding.ticketsSubtitle.text = getString(
            R.string.tickets_screen_sub, tickets.size, open,
        )
    }

    // ------------------------------------------------------------------ the ring

    private fun bindMix(tickets: List<Ticket>) {
        val chart = binding.ticketSummary
        val slices = TicketStatus.entries.map { status ->
            status to tickets.count { it.status == status }
        }

        chart.ticketDonut.setSegments(
            slices.map { (status, count) ->
                DonutSegment(count, ContextCompat.getColor(requireContext(), colorFor(status)))
            }
        )
        chart.ticketDonut.trackColor = ContextCompat.getColor(requireContext(), R.color.ink_08)
        chart.donutTotal.text = tickets.size.toString()
        chart.donutCaption.text =
            resources.getQuantityString(R.plurals.hr_tickets_caption, tickets.size)

        val legend = chart.ticketLegend
        legend.removeAllViews()
        slices.forEach { (status, count) ->
            val row = ItemLegendRowBinding.inflate(layoutInflater, legend, false)
            row.legendLabel.text = status.label
            row.legendValue.text = count.toString()
            row.legendSwatch.background = dot(colorFor(status))
            // A status with none of the queue stays listed, just recessive — the
            // legend is the key to the ring, not a filtered list.
            row.root.alpha = if (count == 0) 0.45f else 1f
            legend.addView(row.root)
        }
    }

    // ------------------------------------------------------------------- filters

    private fun bindFilters(tickets: List<Ticket>) {
        val row = binding.ticketFilters
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

    // ---------------------------------------------------------------- the queue

    private fun bindList(tickets: List<Ticket>) {
        val list = binding.ticketList
        list.removeAllViews()

        val filtered = filter?.let { status -> tickets.filter { it.status == status } } ?: tickets
        if (filtered.isEmpty()) {
            binding.ticketFilterEmpty.visibility = View.VISIBLE
            binding.ticketFilterEmpty.text = getString(
                R.string.hr_filter_empty,
                filter?.label?.lowercase(Locale.getDefault()).orEmpty(),
            )
            return
        }
        binding.ticketFilterEmpty.visibility = View.GONE

        val now = System.currentTimeMillis()
        filtered.forEachIndexed { index, ticket ->
            val row = ItemTicketRowBinding.inflate(layoutInflater, list, false)
            row.ticketSubject.text = ticket.subject
            row.ticketMeta.text = getString(
                R.string.hr_ticket_meta, ticket.id, ticket.category, ticket.ageLabel(now),
            )
            row.ticketStatus.text = ticket.status.label
            row.ticketAccent.setBackgroundResource(accentFor(ticket.status))
            row.ticketStatus.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(requireContext(), fillFor(ticket.status))
            )
            row.ticketStatus.setTextColor(
                ContextCompat.getColor(requireContext(), colorFor(ticket.status))
            )
            row.root.setOnClickListener {
                HrTicketSheet
                    .newInstance(ticket.id, session.signedInEmployee?.employeeId.orEmpty())
                    .show(childFragmentManager, HrTicketSheet.TAG)
            }

            list.addView(row.root)
            if (index < filtered.lastIndex) list.addView(hairline(list))
        }
    }

    // ------------------------------------------------------------------ plumbing

    private fun dot(@ColorRes color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ContextCompat.getColor(requireContext(), color))
    }

    private fun hairline(parent: ViewGroup): View = View(requireContext()).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            1.dp(parent).coerceAtLeast(1),
        )
        setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.ink_05))
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

    private fun accentFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.drawable.bg_track_fill_orange
        TicketStatus.IN_PROGRESS -> R.drawable.bg_track_fill_blue
        TicketStatus.RESOLVED -> R.drawable.bg_track_fill_green
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
