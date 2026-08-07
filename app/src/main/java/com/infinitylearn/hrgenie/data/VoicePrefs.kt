package com.infinitylearn.hrgenie.data

import android.content.Context

/**
 * Whether spoken questions get spoken answers.
 *
 * Device-wide rather than per employee: it is about how this person likes to use the
 * phone, not about their HR record.
 */
class VoicePrefs(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    /** On by default — someone who asked out loud is probably not looking at it. */
    fun isAutoSpeakEnabled(): Boolean = prefs.getBoolean(KEY_AUTO_SPEAK, true)

    fun setAutoSpeak(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_SPEAK, enabled).commit()
    }

    private companion object {
        const val FILE_NAME = "hr_genie_voice"
        const val KEY_AUTO_SPEAK = "auto_speak"
    }
}
