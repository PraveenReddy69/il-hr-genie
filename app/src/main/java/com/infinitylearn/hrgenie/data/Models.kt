package com.infinitylearn.hrgenie.data

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.TimeUnit

/** The five mood faces. Emoji are a product requirement, not placeholders. */
enum class MoodKey { GREAT, GOOD, OKAY, STRESSED, BURNT_OUT }

data class Mood(
    val key: MoodKey,
    val emoji: String,
    val label: String,
    val sub: String,
    /** Copy shown on the confirmation step. */
    val thanksLine: String,
    /** Where this mood lands on the personal 0..10 trend chart. */
    val trendValue: Int,
) {
    val isPositive: Boolean get() = key == MoodKey.GREAT || key == MoodKey.GOOD
}

enum class WishTab(val title: String, val actionEmoji: String) {
    BIRTHDAYS("Birthdays", "🎂"),
    ANNIVERSARY("Work Anniversary", "🎉"),
    NEW_JOINERS("New Joiners", "👋"),
}

data class WishPerson(val name: String, val meta: String, val colorRes: Int) {
    val initial: String get() = name.take(1)
}

data class WishGroup(val tab: WishTab, val more: Int, val people: List<WishPerson>)

/**
 * [isoDate] is kept for sorting and for the past/upcoming split; [dateLabel] is the
 * pre-formatted string the design calls for ("Thu, 01 Jan").
 */
data class Holiday(
    val name: String,
    val isoDate: String,
    val dateLabel: String,
    val monthLabel: String,
) {
    fun isPast(today: String): Boolean = isoDate < today

    /** "15" — the day number on the Home calendar chip. */
    val dayNumber: String get() = format("d")

    /** "AUG" — the month under it. */
    val monthShort: String get() = format(HOLIDAY_MONTH).uppercase(Locale.getDefault())

    /** "Saturday" — the weekday line beside the name. */
    val weekdayLabel: String get() = format("EEEE")

    /** Whole days from [today] to this holiday; negative once it has passed. */
    fun daysUntil(today: String): Long {
        val from = runCatching { HOLIDAY_ISO.parse(today) }.getOrNull() ?: return 0
        val to = runCatching { HOLIDAY_ISO.parse(isoDate) }.getOrNull() ?: return 0
        return TimeUnit.MILLISECONDS.toDays(to.time - from.time)
    }

    private fun format(pattern: String): String {
        val parsed = runCatching { HOLIDAY_ISO.parse(isoDate) }.getOrNull() ?: return ""
        return SimpleDateFormat(pattern, Locale.getDefault()).format(parsed)
    }

    private companion object {
        const val HOLIDAY_MONTH = "MMM"

        // java.time needs API 26 (minSdk is 24), so stay on the legacy formatter.
        val HOLIDAY_ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    }
}

data class PulseQuestion(
    val id: String,
    val text: String,
    val hint: String,
    val options: List<String>,
)

enum class ChatRole { BOT, ME }

data class ChatMessage(
    val role: ChatRole,
    val text: String,
    /** Set when the answer came from the policy knowledge base. */
    val source: KbSource? = null,
    /** True when this is a seeded answer standing in for an unreachable service. */
    val isOffline: Boolean = false,
    /** When it was said, for the time stamped on the bubble. */
    val at: Long = System.currentTimeMillis(),
)

/**
 * A chip in the chat suggestion row.
 *
 * [answer] is a stand-in used only when the knowledge base cannot be reached. It is
 * blank for every current suggestion: guessing at company policy would be worse than
 * admitting the service is down.
 */
data class Suggestion(val question: String, val answer: String = "")

data class DeptScore(val name: String, val score: Double)

enum class RiskLevel(val label: String) { HIGH("High"), MED("Med") }

data class RiskSignal(val level: RiskLevel, val cohort: String, val signal: String)

data class TopQuestion(val rank: Int, val text: String, val tag: String) {
    val isPolicyGap: Boolean get() = tag == "Policy gap"
}
