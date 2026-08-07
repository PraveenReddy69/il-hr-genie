package com.infinitylearn.hrgenie.data

import android.content.Context
import java.util.Locale

/** A completed monthly pulse, with the answers as given. */
data class PulseEntry(
    val cycle: String,
    val completedAtMillis: Long,
    /** Question id to the option chosen; skipped questions are absent. */
    val answers: Map<String, String>,
)

/**
 * Monthly pulse completions, one per employee per cycle. The pulse is asked once a
 * month, so this is what stops it being asked again.
 */
class PulseStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    fun entry(employeeId: String, cycle: String): PulseEntry? {
        val completedAt = prefs.getLong(key(employeeId, cycle, COMPLETED_AT), 0L)
        if (completedAt <= 0L) return null

        val answers = HrGenieContent.PULSE_QUESTIONS.mapNotNull { question ->
            prefs.getString(key(employeeId, cycle, "$ANSWER${question.id}"), null)
                ?.let { question.id to it }
        }.toMap()

        return PulseEntry(cycle, completedAt, answers)
    }

    fun hasCompleted(employeeId: String, cycle: String): Boolean =
        entry(employeeId, cycle) != null

    fun save(
        employeeId: String,
        cycle: String,
        answers: Map<String, String>,
        completedAtMillis: Long,
    ) {
        val edit = prefs.edit().putLong(key(employeeId, cycle, COMPLETED_AT), completedAtMillis)
        HrGenieContent.PULSE_QUESTIONS.forEach { question ->
            val answer = answers[question.id]
            val answerKey = key(employeeId, cycle, "$ANSWER${question.id}")
            // A skipped question is stored as absent rather than blank.
            if (answer != null) edit.putString(answerKey, answer) else edit.remove(answerKey)
        }
        edit.commit()
    }

    /** Removes one cycle's entry. Used by the demo seeder to reset cleanly. */
    fun clear(employeeId: String, cycle: String) {
        val edit = prefs.edit().remove(key(employeeId, cycle, COMPLETED_AT))
        HrGenieContent.PULSE_QUESTIONS.forEach { question ->
            edit.remove(key(employeeId, cycle, "$ANSWER${question.id}"))
        }
        edit.commit()
    }

    private fun key(employeeId: String, cycle: String, suffix: String) =
        "${employeeId.lowercase(Locale.ROOT)}_${cycle}_$suffix"

    private companion object {
        const val FILE_NAME = "hr_genie_pulse"
        const val COMPLETED_AT = "completed_at"
        const val ANSWER = "answer_"
    }
}
