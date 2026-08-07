package com.infinitylearn.hrgenie.ui.chat

import android.animation.ValueAnimator
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.LinearLayout
import androidx.annotation.StringRes
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.AsyncDifferConfig
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.KbSource
import com.infinitylearn.hrgenie.data.Ticket
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.databinding.ItemCategoryChipBinding
import com.infinitylearn.hrgenie.databinding.ItemChatTicketBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageBotBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageCategoriesBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageDayBinding
import com.infinitylearn.hrgenie.databinding.ItemMessagePromptBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageEscalationBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageTicketDraftBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageTicketsBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageTypingBinding
import com.infinitylearn.hrgenie.databinding.ItemMessageUserBinding
import com.infinitylearn.hrgenie.ui.common.renderAnswer
import kotlin.math.PI
import kotlin.math.sin

/**
 * The two-option follow-ups the bot offers, each carrying its own copy.
 *
 * [FEEDBACK] is asked after every answer; saying it did not help leads to
 * [TICKET_OFFER], which is the point of asking. [RECOVERY] covers the case where
 * there was no answer to judge.
 */
enum class PromptKind(
    @param:StringRes val prompt: Int,
    @param:StringRes val primary: Int,
    @param:StringRes val secondary: Int,
) {
    FEEDBACK(R.string.prompt_helpful, R.string.prompt_yes, R.string.prompt_no),
    TICKET_OFFER(R.string.prompt_raise, R.string.prompt_raise_yes, R.string.prompt_raise_no),
    RECOVERY(R.string.prompt_recover, R.string.prompt_retry, R.string.prompt_raise_yes),
}

/**
 * Rows in the transcript. Day chip, typing indicator and the escalation card are
 * modelled as list items so they scroll with the conversation.
 */
sealed interface ChatRow {
    data object Day : ChatRow
    data class Bot(
        val text: String,
        val source: KbSource? = null,
        val isOffline: Boolean = false,
    ) : ChatRow

    /** A two-option follow-up card. See [PromptKind]. */
    data class Prompt(val kind: PromptKind) : ChatRow
    data class User(val text: String) : ChatRow
    data object Typing : ChatRow
    data object Escalation : ChatRow

    // ---- ticket flow ----

    /** Pick a category to file under. */
    data class Categories(val options: List<String>) : ChatRow

    /** Review before anything is written. */
    data class Draft(val draft: TicketDraft) : ChatRow

    /** The ticket just raised. */
    data class Receipt(val ticket: Ticket) : ChatRow

    /** Everything this employee has raised. */
    data class Tickets(val tickets: List<Ticket>) : ChatRow

    /**
     * The view model cannot read the store, so it asks for the list instead. The
     * fragment swaps this for [Tickets].
     */
    data object TicketsWanted : ChatRow
}

class ChatAdapter(
    private val onSendQuestion: () -> Unit,
    private val onBookMeeting: () -> Unit,
    private val onChooseCategory: (String) -> Unit,
    private val onRaiseTicket: () -> Unit,
    private val onCancelTicket: () -> Unit,
    private val raisedByLine: () -> String,
    private val onPrompt: (PromptKind, Boolean) -> Unit,
    private val onSpeak: (String) -> Unit,
) : ListAdapter<ChatRow, RecyclerView.ViewHolder>(DIFFER_CONFIG) {

    /**
     * The answer currently being read out, so its bubble can offer stop instead of
     * play. Held here rather than on the row: it is view state, not transcript.
     */
    var speakingText: String? = null
        set(value) {
            if (field == value) return
            field = value
            notifyItemRangeChanged(0, itemCount)
        }

    override fun getItemViewType(position: Int): Int = when (getItem(position)) {
        is ChatRow.Day -> TYPE_DAY
        is ChatRow.Bot -> TYPE_BOT
        is ChatRow.User -> TYPE_USER
        is ChatRow.Typing -> TYPE_TYPING
        is ChatRow.Escalation -> TYPE_ESCALATION
        is ChatRow.Categories -> TYPE_CATEGORIES
        is ChatRow.Draft -> TYPE_DRAFT
        is ChatRow.Receipt, is ChatRow.Tickets, ChatRow.TicketsWanted -> TYPE_TICKETS
        is ChatRow.Prompt -> TYPE_PROMPT
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            TYPE_DAY -> DayHolder(ItemMessageDayBinding.inflate(inflater, parent, false))
            TYPE_BOT -> BotHolder(ItemMessageBotBinding.inflate(inflater, parent, false))
            TYPE_USER -> UserHolder(ItemMessageUserBinding.inflate(inflater, parent, false))
            TYPE_TYPING -> TypingHolder(ItemMessageTypingBinding.inflate(inflater, parent, false))
            TYPE_CATEGORIES ->
                CategoriesHolder(ItemMessageCategoriesBinding.inflate(inflater, parent, false))
            TYPE_DRAFT ->
                DraftHolder(ItemMessageTicketDraftBinding.inflate(inflater, parent, false))
            TYPE_TICKETS ->
                TicketsHolder(ItemMessageTicketsBinding.inflate(inflater, parent, false))
            TYPE_PROMPT ->
                PromptHolder(ItemMessagePromptBinding.inflate(inflater, parent, false))
            else -> EscalationHolder(ItemMessageEscalationBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val row = getItem(position)) {
            is ChatRow.Bot -> {
                val binding = (holder as BotHolder).binding
                // Knowledge-base answers arrive as markdown.
                binding.bubble.text = renderAnswer(row.text)
                binding.bubble.maxWidth = (parentWidth(binding.root) * 0.84f).toInt()

                // The line under the bubble says where the answer came from — the
                // policy document, or a note that this is the offline stand-in.
                val context = binding.root.context
                binding.bubbleSource.maxWidth = (parentWidth(binding.root) * 0.84f).toInt()
                when {
                    row.isOffline -> {
                        binding.bubbleSource.visibility = View.VISIBLE
                        binding.bubbleSource.setText(R.string.chat_answer_offline)
                        binding.bubbleSource.setTextColor(
                            ContextCompat.getColor(context, R.color.orange_warn)
                        )
                    }

                    row.source != null -> {
                        binding.bubbleSource.visibility = View.VISIBLE
                        binding.bubbleSource.text = context.getString(
                            R.string.chat_answer_source, row.source.displayTitle,
                        )
                        binding.bubbleSource.setTextColor(
                            ContextCompat.getColor(context, R.color.text_muted)
                        )
                    }

                    else -> binding.bubbleSource.visibility = View.GONE
                }

                val speaking = speakingText == row.text
                binding.speakButton.setImageResource(
                    if (speaking) R.drawable.ic_stop_speaking else R.drawable.ic_speaker
                )
                binding.speakButton.imageTintList = ColorStateList.valueOf(
                    ContextCompat.getColor(
                        context,
                        if (speaking) R.color.blue_deep else R.color.text_muted,
                    )
                )
                binding.speakButton.setOnClickListener { onSpeak(row.text) }
            }

            is ChatRow.User -> {
                val binding = (holder as UserHolder).binding
                binding.bubble.text = row.text
                binding.bubble.maxWidth = (parentWidth(binding.root) * 0.80f).toInt()
            }

            is ChatRow.Typing -> (holder as TypingHolder).start()

            is ChatRow.Escalation -> {
                val binding = (holder as EscalationHolder).binding
                binding.sendQuestion.setOnClickListener { onSendQuestion() }
                binding.bookFifteen.setOnClickListener { onBookMeeting() }
            }

            is ChatRow.Categories -> bindCategories(holder as CategoriesHolder, row)

            is ChatRow.Draft -> {
                val binding = (holder as DraftHolder).binding
                binding.draftCategory.text = row.draft.category
                binding.draftSubject.text = row.draft.subject
                binding.draftRaisedBy.text = raisedByLine()
                binding.raiseTicket.setOnClickListener { onRaiseTicket() }
                binding.cancelTicket.setOnClickListener { onCancelTicket() }
            }

            is ChatRow.Receipt -> bindTickets(holder as TicketsHolder, listOf(row.ticket))

            is ChatRow.Tickets -> bindTickets(holder as TicketsHolder, row.tickets)

            is ChatRow.Prompt -> bindPrompt(holder as PromptHolder, row.kind)

            // Swapped for Tickets before it ever reaches the list.
            ChatRow.TicketsWanted -> Unit

            is ChatRow.Day -> Unit
        }
    }

    private fun bindPrompt(holder: PromptHolder, kind: PromptKind) {
        val binding = holder.binding
        binding.promptText.setText(kind.prompt)
        binding.promptPrimary.setText(kind.primary)
        binding.promptSecondary.setText(kind.secondary)
        binding.promptPrimary.setOnClickListener { onPrompt(kind, true) }
        binding.promptSecondary.setOnClickListener { onPrompt(kind, false) }
    }

    private fun bindCategories(holder: CategoriesHolder, row: ChatRow.Categories) {
        val list = holder.binding.categoryList
        list.removeAllViews()
        val inflater = LayoutInflater.from(list.context)
        val density = list.resources.displayMetrics.density

        // Two per line: "Something else" would truncate in a three-up row.
        row.options.chunked(2).forEachIndexed { lineIndex, pair ->
            val line = LinearLayout(list.context).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { if (lineIndex > 0) topMargin = (8 * density).toInt() }
            }
            pair.forEachIndexed { index, option ->
                val chip = ItemCategoryChipBinding.inflate(inflater, line, false)
                chip.chip.text = option
                chip.chip.setOnClickListener { onChooseCategory(option) }
                val params = LinearLayout.LayoutParams(
                    0,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    1f,
                ).apply { if (index > 0) marginStart = (8 * density).toInt() }
                line.addView(chip.root, params)
            }
            list.addView(line)
        }
    }

    private fun bindTickets(holder: TicketsHolder, tickets: List<Ticket>) {
        val list = holder.binding.ticketCardList
        list.removeAllViews()
        val inflater = LayoutInflater.from(list.context)
        val now = System.currentTimeMillis()

        tickets.forEachIndexed { index, ticket ->
            val row = ItemChatTicketBinding.inflate(inflater, list, false)
            row.chatTicketSubject.text = ticket.subject
            row.chatTicketMeta.text = list.context.getString(
                R.string.hr_ticket_meta, ticket.id, ticket.category, ticket.ageLabel(now),
            )
            row.chatTicketStatus.text = ticket.status.label
            row.chatTicketAccent.setBackgroundResource(accentFor(ticket.status))
            row.chatTicketStatus.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(list.context, fillFor(ticket.status))
            )
            row.chatTicketStatus.setTextColor(
                ContextCompat.getColor(list.context, textFor(ticket.status))
            )
            list.addView(row.root)

            if (index < tickets.lastIndex) {
                list.addView(
                    View(list.context).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            (list.resources.displayMetrics.density).toInt().coerceAtLeast(1),
                        )
                        setBackgroundColor(ContextCompat.getColor(context, R.color.ink_05))
                    }
                )
            }
        }
    }

    private fun accentFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.drawable.bg_track_fill_orange
        TicketStatus.IN_PROGRESS -> R.drawable.bg_track_fill_blue
        TicketStatus.RESOLVED -> R.drawable.bg_track_fill_green
    }

    private fun fillFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_tint_14
        TicketStatus.IN_PROGRESS -> R.color.blue_tint_10
        TicketStatus.RESOLVED -> R.color.green_tint_14
    }

    private fun textFor(status: TicketStatus): Int = when (status) {
        TicketStatus.OPEN -> R.color.orange_warn
        TicketStatus.IN_PROGRESS -> R.color.blue_deep
        TicketStatus.RESOLVED -> R.color.green_ok
    }

    override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
        if (holder is TypingHolder) holder.stop()
        super.onViewRecycled(holder)
    }

    /**
     * The list is full-width with 16dp side padding, so the usable track is known
     * before layout — safer than reading the parent's width during bind.
     */
    private fun parentWidth(view: View): Int {
        val metrics = view.resources.displayMetrics
        return metrics.widthPixels - (2 * 16 * metrics.density).toInt()
    }

    class DayHolder(binding: ItemMessageDayBinding) : RecyclerView.ViewHolder(binding.root)

    class BotHolder(val binding: ItemMessageBotBinding) : RecyclerView.ViewHolder(binding.root)

    class UserHolder(val binding: ItemMessageUserBinding) : RecyclerView.ViewHolder(binding.root)

    class EscalationHolder(val binding: ItemMessageEscalationBinding) :
        RecyclerView.ViewHolder(binding.root)

    class CategoriesHolder(val binding: ItemMessageCategoriesBinding) :
        RecyclerView.ViewHolder(binding.root)

    class DraftHolder(val binding: ItemMessageTicketDraftBinding) :
        RecyclerView.ViewHolder(binding.root)

    class TicketsHolder(val binding: ItemMessageTicketsBinding) :
        RecyclerView.ViewHolder(binding.root)

    class PromptHolder(val binding: ItemMessagePromptBinding) :
        RecyclerView.ViewHolder(binding.root)

    /**
     * Three dots rolling as one wave.
     *
     * A single linear clock drives all three, each reading it at its own phase — the
     * shape comes from the maths, not an interpolator. Three separate animators with
     * start delays drift apart over a long wait and stutter where they sat idle;
     * one clock cannot.
     */
    class TypingHolder(binding: ItemMessageTypingBinding) : RecyclerView.ViewHolder(binding.root) {

        private val dots = listOf(binding.dot1, binding.dot2, binding.dot3)
        private val riseDp = 5f * binding.root.resources.displayMetrics.density
        private var animator: ValueAnimator? = null

        fun start() {
            stop()
            animator = ValueAnimator.ofFloat(0f, 1f).apply {
                duration = CYCLE_MS
                repeatCount = ValueAnimator.INFINITE
                // The wave is shaped below; easing it twice would flatten it.
                interpolator = LinearInterpolator()
                addUpdateListener { animation ->
                    val t = animation.animatedFraction
                    dots.forEachIndexed { index, dot ->
                        val lift = liftAt(t - index * PHASE_STEP)
                        dot.translationY = -riseDp * lift
                        // Scale reads far better than alpha alone at 7dp.
                        dot.scaleX = 1f + 0.22f * lift
                        dot.scaleY = 1f + 0.22f * lift
                        dot.alpha = 0.38f + 0.62f * lift
                    }
                }
                start()
            }
        }

        /**
         * A half-sine bump over [ACTIVE] of the cycle, resting for the remainder, so
         * each dot rises and settles once per pass with no visible seam.
         */
        private fun liftAt(rawPhase: Float): Float {
            val phase = (rawPhase % 1f + 1f) % 1f
            if (phase >= ACTIVE) return 0f
            return sin(phase / ACTIVE * PI).toFloat()
        }

        fun stop() {
            animator?.cancel()
            animator = null
            dots.forEach {
                it.translationY = 0f
                it.scaleX = 1f
                it.scaleY = 1f
                it.alpha = 1f
            }
        }

        private companion object {
            const val CYCLE_MS = 1150L

            /** How far behind the previous dot each one runs. */
            const val PHASE_STEP = 0.16f

            /** Share of the cycle a dot spends moving; the rest it rests. */
            const val ACTIVE = 0.6f
        }
    }

    private companion object {
        const val TYPE_DAY = 0
        const val TYPE_BOT = 1
        const val TYPE_USER = 2
        const val TYPE_TYPING = 3
        const val TYPE_ESCALATION = 4
        const val TYPE_CATEGORIES = 5
        const val TYPE_DRAFT = 6
        const val TYPE_TICKETS = 7
        const val TYPE_PROMPT = 8

        val DIFF = object : DiffUtil.ItemCallback<ChatRow>() {
            override fun areItemsTheSame(oldItem: ChatRow, newItem: ChatRow) =
                oldItem == newItem

            override fun areContentsTheSame(oldItem: ChatRow, newItem: ChatRow) =
                oldItem == newItem
        }

        /**
         * Diff on the calling thread. A transcript is a handful of rows, so the
         * default background executor buys nothing and makes the moment a card
         * appears depend on thread scheduling.
         */
        val DIFFER_CONFIG: AsyncDifferConfig<ChatRow> = AsyncDifferConfig.Builder(DIFF)
            .setBackgroundThreadExecutor { it.run() }
            .build()
    }
}
