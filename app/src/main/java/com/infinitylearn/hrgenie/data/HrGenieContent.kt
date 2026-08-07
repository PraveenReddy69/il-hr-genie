package com.infinitylearn.hrgenie.data

import com.infinitylearn.hrgenie.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Seed content for the prototype build, matching the JSON files under `data/` in the
 * design handoff and the copy in its README. Swap these for repository calls when the
 * HR backend lands.
 */
object HrGenieContent {

    /** Device-clock today, ISO-8601 — drives tenure and the holiday past/upcoming split. */
    val todayIso: String get() = ISO_DATE.format(Date())

    /** "Friday, 7 August" for the Home subline. */
    val todayLabel: String get() = DISPLAY_DATE.format(Date())

    /** "7 Aug 2026" for the Wishes date band. */
    val todayShort: String get() = SHORT_DATE.format(Date())

    /** "7 Aug" for the check-in eyebrow. */
    val todayCompact: String get() = COMPACT_DATE.format(Date())

    /** "2026-08" — the pulse runs once per calendar month. */
    val currentCycle: String get() = CYCLE.format(Date())

    /** "August" for pulse copy. */
    val currentMonthName: String get() = MONTH_NAME.format(Date())

    // java.time needs API 26 (minSdk is 24), so stay on the legacy formatters.
    private val ISO_DATE = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val DISPLAY_DATE = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())
    private val SHORT_DATE = SimpleDateFormat("d MMM yyyy", Locale.getDefault())
    private val COMPACT_DATE = SimpleDateFormat("d MMM", Locale.getDefault())
    private val CYCLE = SimpleDateFormat("yyyy-MM", Locale.US)
    private val MONTH_NAME = SimpleDateFormat("MMMM", Locale.getDefault())

    const val BOT_REPLY_DELAY_MS = 1100L

    val MOODS = listOf(
        Mood(
            MoodKey.GREAT, "😊", "Great", "Energised and on top of it",
            "Love that. Keep a note of what worked this week.", 9,
        ),
        Mood(
            MoodKey.GOOD, "🙂", "Good", "Steady, nothing major",
            "Steady weeks matter too. Noted.", 8,
        ),
        Mood(
            MoodKey.OKAY, "😐", "Okay", "Getting through the week",
            "Noted. If 'okay' turns into 'stretched', I'll nudge you to talk to your HRBP.", 6,
        ),
        Mood(
            MoodKey.STRESSED, "😔", "Stressed", "Carrying a bit too much",
            "That's worth taking seriously. Want me to book 15 minutes with your HRBP?", 4,
        ),
        Mood(
            MoodKey.BURNT_OUT, "😣", "Burnt out", "Running on empty",
            "Thank you for telling me. I've surfaced support options — and your HRBP can reach out anonymously if you want.",
            3,
        ),
    )

    fun mood(key: MoodKey): Mood = MOODS.first { it.key == key }

    val REASONS = listOf(
        "Workload", "Deadlines", "My manager", "My team",
        "Recognition", "Clarity on goals", "Work–life balance", "Something outside work",
    )

    /** Eight weeks; the last slot is replaced by the mood the user just picked. */
    val PERSONAL_TREND_HISTORY = listOf(7, 8, 6, 7, 5, 4, 6)


    val WISHES = listOf(
        WishGroup(
            WishTab.BIRTHDAYS, more = 5,
            people = listOf(
                WishPerson("Abhimanyu Pal", "INT000983 · Executive", R.color.avatar_orange),
                WishPerson("Atluri Kiranmai", "HYD140010161 · Executive", R.color.avatar_green),
                WishPerson("Guddu Kumar Das", "HYD610086 · Executive", R.color.avatar_blue),
            ),
        ),
        WishGroup(
            WishTab.ANNIVERSARY, more = 2,
            people = listOf(
                WishPerson("Sneha Ramesh", "HYD220145 · 5 years", R.color.avatar_purple),
                WishPerson("Vikram Nair", "BLR330281 · 3 years", R.color.avatar_orange),
                WishPerson("Priya Deshpande", "HYD110902 · 1 year", R.color.avatar_green),
            ),
        ),
        WishGroup(
            WishTab.NEW_JOINERS, more = 4,
            people = listOf(
                WishPerson("Rahul Menon", "HYD780412 · Academics", R.color.avatar_blue),
                WishPerson("Fatima Sheikh", "HYD780419 · Support", R.color.avatar_purple),
                WishPerson("Joseph Thomas", "BLR780433 · Sales", R.color.avatar_green),
            ),
        ),
    )

    fun wishes(tab: WishTab): WishGroup = WISHES.first { it.tab == tab }

    val HOLIDAYS = listOf(
        Holiday("New Year", "2026-01-01", "Thu, 01 Jan", "January 2026"),
        Holiday("Makara Sankranti / Pongal", "2026-01-15", "Thu, 15 Jan", "January 2026"),
        Holiday("Republic Day", "2026-01-26", "Mon, 26 Jan", "January 2026"),
        Holiday("Holi", "2026-03-04", "Wed, 04 Mar", "March 2026"),
        Holiday("May Day", "2026-05-01", "Fri, 01 May", "May 2026"),
        Holiday("Telangana Formation Day", "2026-06-02", "Tue, 02 Jun", "June 2026"),
        Holiday("Independence Day", "2026-08-15", "Sat, 15 Aug", "August 2026"),
        Holiday("Gandhi Jayanti", "2026-10-02", "Fri, 02 Oct", "October 2026"),
        Holiday("Vijaya Dashami", "2026-10-21", "Wed, 21 Oct", "October 2026"),
        Holiday("Christmas Day", "2026-12-25", "Fri, 25 Dec", "December 2026"),
    )

    val UPCOMING_HOLIDAYS: List<Holiday>
        get() = HOLIDAYS.filterNot { it.isPast(todayIso) }.take(4)

    val PULSE_QUESTIONS = listOf(
        PulseQuestion(
            "experience",
            "How has your work experience been this month?",
            "Gut feel is fine — no one is scoring you.",
            listOf("Genuinely good", "Mostly fine", "Up and down", "Rough, honestly"),
        ),
        PulseQuestion(
            "workload",
            "Is your workload manageable right now?",
            "We ask because August is release month for a few teams.",
            listOf("Comfortable", "Busy but okay", "Stretched", "Not sustainable"),
        ),
        PulseQuestion(
            "manager",
            "Do you feel supported by your manager?",
            "Answers roll up to a department average only.",
            listOf("Always", "Usually", "Sometimes", "Rarely"),
        ),
        PulseQuestion(
            "attrition",
            "Have you thought about looking elsewhere recently?",
            "Honest answers here are what make this useful.",
            listOf("Not at all", "Passing thought", "Somewhat", "Actively looking"),
        ),
    )

    val PULSE_OUTCOMES = listOf(
        "Two extra recharge days added for the platform pod after workload flags.",
        "Reimbursement cycle moved from 45 to 21 days.",
    )

    fun chatGreeting(firstName: String): String =
        "Hi $firstName 👋 I'm HR Genie. Ask me about leave, insurance, payroll or policy — " +
            "or say \"raise a ticket\" and I'll file it with HR for you."

    const val CHAT_FALLBACK = "Let me pull that from the handbook — one moment."

    val SUGGESTIONS = listOf(
        Suggestion(
            "How many leaves do I have left?",
            "You have 12 earned leaves and 4 casual leaves left for 2026. Earned leave next credits on 1 Sept. Want me to open the leave form?",
        ),
        Suggestion(
            "What does my insurance cover?",
            "You're on the GMC family floater — ₹5,00,000 sum insured, spouse, two children and parents covered. Cashless at 8,400+ hospitals, no room-rent cap. I can pull the hospital list near Hyderabad if that helps.",
        ),
        Suggestion(
            "When does my reimbursement land?",
            "Your ₹4,820 travel claim was approved on 31 July. It rides with the August payroll, credited 30 Aug. Nothing pending from your side.",
        ),
        Suggestion(
            "Explain the WFH policy",
            "Hybrid: 3 days from office, Tue–Thu anchored with your team. Full remote is available 15 days a year with manager approval — I can start that request for you.",
        ),
    )

    fun replyTo(question: String): String = seededAnswer(question) ?: CHAT_FALLBACK

    /** The offline answer for a question, or null if there isn't one. */
    fun seededAnswer(question: String): String? =
        SUGGESTIONS.firstOrNull { it.question.equals(question, ignoreCase = true) }?.answer

    /**
     * What to tell the employee when the policy service does not answer.
     *
     * Each case says what happened in their terms — vague copy here would leave
     * someone retrying a question that is never going to work.
     */
    fun kbFailureMessage(failure: KbFailure?): String = when (failure) {
        is KbFailure.Timeout ->
            "The policy service took too long to answer. It may be busy — want me to try again?"
        is KbFailure.Server ->
            "The policy service returned an error (${failure.code}). I've logged it — try again in a moment."
        is KbFailure.Unusable ->
            "The policy service answered, but not with anything I could read. Try again, or ask me to raise a ticket."
        else ->
            "I can't reach the policy service right now — nothing came back at all. " +
                "Check you're online, or try again in a moment."
    }

    // ------------------------------------------------------------ ticket raising

    /** What a ticket can be filed under. "Something else" is the catch-all. */
    val TICKET_CATEGORIES = listOf(
        "Payroll", "Leave", "IT & access", "Insurance", "Facilities", "Something else",
    )

    const val TICKET_ASK_CATEGORY =
        "Happy to raise that with HR. What's it about?"
    const val TICKET_ASK_SUBJECT =
        "Got it. Tell me what's happening in a line or two — I'll put it in the ticket as you write it."
    const val TICKET_CONFIRM =
        "Here's what I'll send. Check it over and I'll raise it."
    const val TICKET_CANCELLED =
        "No problem, I've dropped it. Nothing was sent to HR."
    // Says plainly that nothing was filed. An employee who thinks a ticket exists
    // will wait on HR instead of trying again.
    const val TICKET_FAILED =
        "I couldn't reach HR just then, so nothing was raised. Your draft is still " +
            "here — tap Raise it to try again."
    const val TICKET_TOO_SHORT =
        "Give me a little more to go on — a sentence is plenty."
    const val FEEDBACK_THANKS =
        "Good — glad that landed. Ask me anything else whenever you need to."
    const val FEEDBACK_DECLINED =
        "No problem. Say \"raise a ticket\" any time and I'll file it with HR."

    const val TICKET_NONE =
        "You haven't raised anything with HR yet. Say \"raise a ticket\" whenever you need to."

    fun ticketRaised(id: String): String =
        "Raised as $id. Your HRBP sees it on their dashboard straight away — I'll tell you here when the status changes."

    /**
     * Keyword match rather than a model: the prototype has no backend, and a handful
     * of phrasings covers what a demo will type.
     */
    fun isTicketIntent(text: String): Boolean {
        val lower = text.lowercase(Locale.ROOT)
        return TICKET_TRIGGERS.any { lower.contains(it) } && !isMyTicketsIntent(text)
    }

    fun isMyTicketsIntent(text: String): Boolean {
        val lower = text.lowercase(Locale.ROOT)
        return MY_TICKET_TRIGGERS.any { lower.contains(it) }
    }

    private val TICKET_TRIGGERS = listOf(
        "raise a ticket", "raise ticket", "new ticket", "log a ticket", "open a ticket",
        "raise a request", "file a complaint", "report an issue", "need help with",
        "not working", "escalate this",
    )

    private val MY_TICKET_TRIGGERS = listOf(
        "my tickets", "my ticket", "ticket status", "track my", "existing tickets",
        "raised tickets",
    )

    // ---------------------------------------------------------------- HRBP view

    /** Eight weeks of org-wide engagement score, 0..10. */
    val ORG_TREND = listOf(6.8, 7.0, 6.5, 6.9, 7.1, 7.0, 7.2, 7.4)

    val DEPARTMENTS = listOf(
        DeptScore("Academics", 8.1),
        DeptScore("Sales", 6.2),
        DeptScore("Engineering", 7.6),
        DeptScore("Support", 5.8),
        DeptScore("Marketing", 7.9),
    )

    val RISKS = listOf(
        RiskSignal(
            RiskLevel.HIGH, "Support · Night shift (9)",
            "Mood down 4 weeks straight, stress keywords up 38%",
        ),
        RiskSignal(
            RiskLevel.MED, "Sales · West region (14)",
            "Recognition scores falling, 3 skipped pulses",
        ),
        RiskSignal(
            RiskLevel.MED, "Eng · Platform pod (7)",
            "Workload flagged by 5 of 7 this month",
        ),
    )

    val TOP_QUESTIONS = listOf(
        TopQuestion(1, "How do I claim parents under GMC?", "Policy gap"),
        TopQuestion(2, "Leave encashment eligibility", "412"),
        TopQuestion(3, "Reimbursement processing time", "Policy gap"),
        TopQuestion(4, "Appraisal cycle dates", "287"),
    )
}
