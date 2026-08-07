package com.infinitylearn.hrgenie.ui.chat

import android.os.Handler
import android.os.Looper
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.infinitylearn.hrgenie.data.ChatMessage
import com.infinitylearn.hrgenie.data.ChatRole
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.KbAnswer
import com.infinitylearn.hrgenie.data.KbClient
import com.infinitylearn.hrgenie.data.KbException
import com.infinitylearn.hrgenie.data.Ticket
import kotlinx.coroutines.launch

/** Where a ticket conversation has got to. */
enum class TicketStage { NONE, CATEGORY, SUBJECT, CONFIRM }

/** A ticket being composed, before it is written to the store. */
data class TicketDraft(val category: String, val subject: String)

/**
 * Chat transcript and the guided ticket flow.
 *
 * The store is not touched here — this holds no Context. The fragment writes the
 * ticket and hands the result back through [onTicketRaised].
 */
class ChatViewModel : ViewModel() {

    private val handler = Handler(Looper.getMainLooper())
    private var pendingReply: Runnable? = null

    /** Swappable so tests do not hit the network. */
    var knowledgeBase: suspend (String) -> Result<KbAnswer> = KbClient()::ask

    private val _messages = MutableLiveData<List<ChatMessage>>(emptyList())
    val messages: LiveData<List<ChatMessage>> = _messages

    private val _isTyping = MutableLiveData(false)
    val isTyping: LiveData<Boolean> = _isTyping

    private val _escalationVisible = MutableLiveData(false)
    val escalationVisible: LiveData<Boolean> = _escalationVisible

    /** Rows the ticket flow appends after the transcript: chips, draft card, list. */
    private val _attachment = MutableLiveData<ChatRow?>(null)
    val attachment: LiveData<ChatRow?> = _attachment

    val suggestions = HrGenieContent.SUGGESTIONS

    var stage: TicketStage = TicketStage.NONE
        private set

    private var draftCategory: String? = null
    private var draftSubject: String? = null

    /** Kept so the retry card can re-ask without the user typing it again. */
    private var lastQuestion: String? = null

    /** Whether the outstanding question was dictated rather than typed. */
    private var askedByVoice = false

    /** An answer worth reading aloud. One-shot: the fragment consumes it. */
    private val _spokenAnswer = MutableLiveData<String?>(null)
    val spokenAnswer: LiveData<String?> = _spokenAnswer

    fun consumeSpokenAnswer() {
        _spokenAnswer.value = null
    }

    /** Non-null only while a draft is waiting on the confirm card. */
    val draft: TicketDraft?
        get() {
            val category = draftCategory ?: return null
            val subject = draftSubject ?: return null
            return TicketDraft(category, subject)
        }

    fun greet(firstName: String) {
        if (_messages.value.orEmpty().isNotEmpty()) return
        _messages.value = listOf(
            ChatMessage(ChatRole.BOT, HrGenieContent.chatGreeting(firstName))
        )
    }

    // ------------------------------------------------------------------ sending

    /**
     * [byVoice] marks a question that was dictated. Its answer is offered up for
     * reading aloud; a typed question's is not, so the app never starts talking
     * unprompted.
     */
    fun send(text: String, byVoice: Boolean = false) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return

        askedByVoice = byVoice
        say(ChatRole.ME, trimmed)
        _escalationVisible.value = false

        when {
            stage == TicketStage.SUBJECT -> captureSubject(trimmed)
            HrGenieContent.isMyTicketsIntent(trimmed) -> _attachment.value = ChatRow.TicketsWanted
            HrGenieContent.isTicketIntent(trimmed) -> startTicket()
            else -> askKnowledgeBase(trimmed)
        }
    }

    /**
     * Puts the question to the policy knowledge base.
     *
     * The typing indicator runs for as long as the call takes rather than a fixed
     * beat — this is a real request. If it fails the seeded answer stands in, so a
     * dropped tunnel degrades to the offline behaviour instead of an error.
     */
    private fun askKnowledgeBase(question: String) {
        pendingReply?.let(handler::removeCallbacks)
        lastQuestion = question
        _attachment.value = null
        _isTyping.value = true

        viewModelScope.launch {
            val result = knowledgeBase(question)
            _isTyping.value = false

            result
                .onSuccess { answer ->
                    _messages.value = _messages.value.orEmpty() + ChatMessage(
                        role = ChatRole.BOT,
                        text = answer.answer,
                        source = answer.sources.maxByOrNull { it.score },
                    )
                    if (askedByVoice) _spokenAnswer.value = answer.answer
                    // Every answer is checked: an unhelpful one is the strongest
                    // signal we have that this should become a ticket.
                    _attachment.value = ChatRow.Prompt(PromptKind.FEEDBACK)
                }
                .onFailure { failure -> reportFailure(question, failure) }
        }
    }

    /**
     * Says what actually happened.
     *
     * A seeded answer still stands in where there is one, because a demo should not
     * dead-end — but it is labelled as offline rather than passed off as the policy
     * service's answer, and a retry is always offered.
     */
    private fun reportFailure(question: String, failure: Throwable) {
        val kind = (failure as? KbException)?.failure
        val seeded = HrGenieContent.seededAnswer(question)

        if (seeded != null) {
            _messages.value = _messages.value.orEmpty() + ChatMessage(
                role = ChatRole.BOT,
                text = seeded,
                isOffline = true,
            )
        } else {
            say(ChatRole.BOT, HrGenieContent.kbFailureMessage(kind))
        }
        _attachment.value = ChatRow.Prompt(PromptKind.RECOVERY)
    }

    // ------------------------------------------------------------- follow-ups

    /** Handles both halves of every prompt card. */
    fun onPrompt(kind: PromptKind, primary: Boolean) {
        when (kind) {
            PromptKind.FEEDBACK ->
                if (primary) acknowledgeHelpful() else offerTicket()

            PromptKind.TICKET_OFFER ->
                if (primary) raiseFromLastQuestion() else declineTicket()

            PromptKind.RECOVERY ->
                if (primary) retryLastQuestion() else raiseFromLastQuestion()
        }
    }

    private fun acknowledgeHelpful() {
        _attachment.value = null
        replyAfterTyping(HrGenieContent.FEEDBACK_THANKS)
    }

    private fun offerTicket() {
        _attachment.value = ChatRow.Prompt(PromptKind.TICKET_OFFER)
    }

    private fun declineTicket() {
        _attachment.value = null
        replyAfterTyping(HrGenieContent.FEEDBACK_DECLINED)
    }

    /**
     * Starts the ticket flow already knowing what it is about — the question they
     * asked becomes the subject, so they only pick a category and confirm.
     */
    private fun raiseFromLastQuestion() {
        val question = lastQuestion
        startTicket()
        draftSubject = question
    }

    /** Re-asks the last question, for the recovery card. */
    fun retryLastQuestion() {
        val question = lastQuestion ?: return
        _attachment.value = null
        askKnowledgeBase(question)
    }

    // ------------------------------------------------------------ ticket flow

    fun startTicket() {
        stage = TicketStage.CATEGORY
        draftCategory = null
        draftSubject = null
        _attachment.value = null
        replyAfterTyping(HrGenieContent.TICKET_ASK_CATEGORY) {
            _attachment.value = ChatRow.Categories(HrGenieContent.TICKET_CATEGORIES)
        }
    }

    fun chooseCategory(category: String) {
        if (stage != TicketStage.CATEGORY) return
        draftCategory = category
        _attachment.value = null
        say(ChatRole.ME, category)

        // Raised off a question we already have: skip straight to the review.
        if (draftSubject != null) {
            stage = TicketStage.CONFIRM
            replyAfterTyping(HrGenieContent.TICKET_CONFIRM) {
                draft?.let { _attachment.value = ChatRow.Draft(it) }
            }
            return
        }

        stage = TicketStage.SUBJECT
        replyAfterTyping(HrGenieContent.TICKET_ASK_SUBJECT)
    }

    private fun captureSubject(text: String) {
        // One word is not a ticket anyone can action.
        if (text.length < MIN_SUBJECT_LENGTH) {
            replyAfterTyping(HrGenieContent.TICKET_TOO_SHORT)
            return
        }
        draftSubject = text
        stage = TicketStage.CONFIRM
        replyAfterTyping(HrGenieContent.TICKET_CONFIRM) {
            draft?.let { _attachment.value = ChatRow.Draft(it) }
        }
    }

    fun cancelTicket() {
        resetTicket()
        replyAfterTyping(HrGenieContent.TICKET_CANCELLED)
    }

    /** Called by the fragment once the server has actually created the ticket. */
    fun onTicketRaised(ticket: Ticket) {
        resetTicket()
        replyAfterTyping(HrGenieContent.ticketRaised(ticket.id)) {
            _attachment.value = ChatRow.Receipt(ticket)
        }
    }

    /**
     * The server refused or could not be reached, so no ticket exists.
     *
     * The draft is deliberately kept: the employee has already typed the subject and
     * picked a category, and losing that to a dropped connection would be the worst
     * part of the failure. Confirming again retries.
     */
    fun onTicketFailed() {
        replyAfterTyping(HrGenieContent.TICKET_FAILED)
    }

    /**
     * Posts what HR changed while the employee was away. Called once per visit with
     * whatever the store says is unseen; an empty list says nothing.
     */
    fun announceUpdates(updated: List<Ticket>) {
        if (updated.isEmpty()) return
        replyAfterTyping(updateHeadline(updated)) {
            _attachment.value = ChatRow.Tickets(updated)
        }
    }

    private fun updateHeadline(updated: List<Ticket>): String {
        if (updated.size > 1) {
            return "While you were away, HR moved ${updated.size} of your tickets."
        }
        val ticket = updated.first()
        val headline = when (ticket.status) {
            com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED ->
                "Good news — HR has closed ${ticket.id}."
            com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS ->
                "HR has picked up ${ticket.id} — it's in progress now."
            com.infinitylearn.hrgenie.data.TicketStatus.OPEN ->
                "${ticket.id} has been reopened by HR."
        }
        // The note HR left is the actual answer — it leads, the status follows.
        val note = ticket.latestComment
            ?.takeIf { it.status == ticket.status }
            ?.text
            ?: return headline
        return "$headline\n\n“$note”"
    }

    /** Called by the fragment with the employee's own tickets, read from the store. */
    fun showTickets(tickets: List<Ticket>) {
        if (tickets.isEmpty()) {
            _attachment.value = null
            replyAfterTyping(HrGenieContent.TICKET_NONE)
            return
        }
        replyAfterTyping(ticketSummary(tickets)) {
            _attachment.value = ChatRow.Tickets(tickets)
        }
    }

    private fun ticketSummary(tickets: List<Ticket>): String {
        val open = tickets.count { it.isOpen }
        val noun = if (tickets.size == 1) "ticket" else "tickets"
        return if (open == 0) {
            "You have ${tickets.size} $noun with HR — all of them closed."
        } else {
            "You have ${tickets.size} $noun with HR, $open still open."
        }
    }

    private fun resetTicket() {
        stage = TicketStage.NONE
        draftCategory = null
        draftSubject = null
        _attachment.value = null
    }

    // ---------------------------------------------------------------- escalation

    fun escalate() {
        _escalationVisible.value = true
    }

    fun dismissEscalation() {
        _escalationVisible.value = false
    }

    // ------------------------------------------------------------------ plumbing

    private fun say(role: ChatRole, text: String) {
        _messages.value = _messages.value.orEmpty() + ChatMessage(role, text)
    }

    /** Bot replies land after the typing indicator, like every other answer. */
    private fun replyAfterTyping(text: String, andThen: (() -> Unit)? = null) {
        _isTyping.value = true
        pendingReply?.let(handler::removeCallbacks)
        pendingReply = Runnable {
            _isTyping.value = false
            say(ChatRole.BOT, text)
            andThen?.invoke()
        }.also { handler.postDelayed(it, HrGenieContent.BOT_REPLY_DELAY_MS) }
    }

    override fun onCleared() {
        pendingReply?.let(handler::removeCallbacks)
        super.onCleared()
    }

    private companion object {
        const val MIN_SUBJECT_LENGTH = 6
    }
}
