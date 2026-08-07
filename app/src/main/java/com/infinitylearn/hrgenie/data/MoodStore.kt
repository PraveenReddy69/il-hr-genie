package com.infinitylearn.hrgenie.data

import android.content.Context
import java.util.Locale

/** What an employee logged on a given day. */
data class MoodEntry(
    val dateIso: String,
    val mood: MoodKey,
    val reasons: Set<String>,
    val note: String,
)

/**
 * Mood check-ins, one per employee per day. The check-in is a once-a-day prompt, so
 * Home uses this to stop asking again after it has been answered.
 */
class MoodStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    fun entry(employeeId: String, dateIso: String): MoodEntry? {
        val key = prefs.getString(key(employeeId, dateIso, MOOD), null) ?: return null
        val mood = runCatching { MoodKey.valueOf(key) }.getOrNull() ?: return null
        return MoodEntry(
            dateIso = dateIso,
            mood = mood,
            reasons = prefs.getStringSet(key(employeeId, dateIso, REASONS), emptySet()).orEmpty(),
            note = prefs.getString(key(employeeId, dateIso, NOTE), "").orEmpty(),
        )
    }

    fun hasCheckedIn(employeeId: String, dateIso: String): Boolean =
        entry(employeeId, dateIso) != null

    fun save(
        employeeId: String,
        dateIso: String,
        mood: MoodKey,
        reasons: Set<String>,
        note: String,
    ) {
        prefs.edit()
            .putString(key(employeeId, dateIso, MOOD), mood.name)
            .putStringSet(key(employeeId, dateIso, REASONS), reasons)
            .putString(key(employeeId, dateIso, NOTE), note)
            .commit()
    }

    /** Removes one day's entry. Used by the demo seeder to reset cleanly. */
    fun clear(employeeId: String, dateIso: String) {
        prefs.edit()
            .remove(key(employeeId, dateIso, MOOD))
            .remove(key(employeeId, dateIso, REASONS))
            .remove(key(employeeId, dateIso, NOTE))
            .commit()
    }

    private fun key(employeeId: String, dateIso: String, suffix: String) =
        "${employeeId.lowercase(Locale.ROOT)}_${dateIso}_$suffix"

    private companion object {
        const val FILE_NAME = "hr_genie_mood"
        const val MOOD = "mood"
        const val REASONS = "reasons"
        const val NOTE = "note"
    }
}
