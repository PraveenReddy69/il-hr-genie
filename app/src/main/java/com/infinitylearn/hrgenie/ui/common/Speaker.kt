package com.infinitylearn.hrgenie.ui.common

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Reads bot answers aloud.
 *
 * The engine is initialised once and kept — construction is asynchronous, so building
 * one per utterance would drop the first request every time. Callers must [release]
 * it with the view.
 */
class Speaker(context: Context) {

    private var engine: TextToSpeech? = null
    private var ready = false

    /** Engine callbacks arrive on a binder thread; the UI reads this state. */
    private val main = Handler(Looper.getMainLooper())

    /** Queued while the engine was still starting up. */
    private var pending: String? = null

    /** Called on the main thread when speech starts and stops. */
    var onSpeakingChanged: (String?) -> Unit = {}

    private var speakingText: String? = null

    init {
        engine = TextToSpeech(context.applicationContext) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (!ready) {
                Log.w(TAG, "Text-to-speech unavailable, status $status")
                return@TextToSpeech
            }
            engine?.language = Locale.getDefault().takeIf { supported(it) } ?: Locale.UK
            engine?.setOnUtteranceProgressListener(progress)
            pending?.let { queued ->
                pending = null
                speak(queued)
            }
        }
    }

    private fun supported(locale: Locale): Boolean {
        val result = engine?.isLanguageAvailable(locale) ?: TextToSpeech.LANG_MISSING_DATA
        return result >= TextToSpeech.LANG_AVAILABLE
    }

    val isAvailable: Boolean get() = ready

    fun isSpeaking(text: String): Boolean = speakingText == text

    /** Speaks [text], replacing anything already playing. */
    fun speak(text: String) {
        val spoken = speakable(text)
        if (spoken.isBlank()) return

        if (!ready) {
            pending = text
            return
        }
        speakingText = text
        notifySpeaking(text)
        engine?.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
    }

    fun stop() {
        pending = null
        engine?.stop()
        if (speakingText != null) {
            speakingText = null
            notifySpeaking(null)
        }
    }

    /** Toggles: speaking the current text stops it, anything else replaces it. */
    fun toggle(text: String) {
        if (isSpeaking(text)) stop() else speak(text)
    }

    fun release() {
        speakingText = null
        pending = null
        runCatching {
            engine?.stop()
            engine?.shutdown()
        }
        engine = null
        ready = false
    }

    /**
     * Strips the markdown the knowledge base emits. Read literally, `**Fixed
     * Holidays**` becomes "asterisk asterisk", and a bullet glyph is announced by
     * some engines — neither belongs in speech.
     */
    private fun speakable(text: String): String = text
        .replace("**", "")
        .lineSequence()
        .map { line ->
            val trimmed = line.trim()
            when {
                trimmed.startsWith("- ") -> trimmed.drop(2)
                trimmed.startsWith("* ") -> trimmed.drop(2)
                trimmed.startsWith("•") -> trimmed.drop(1).trim()
                else -> trimmed
            }
        }
        .filter { it.isNotBlank() }
        // A full stop makes the engine pause between bullets instead of running them
        // into one breathless sentence.
        .joinToString(" ") { if (it.endsWith('.') || it.endsWith('?')) it else "$it." }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit

        override fun onDone(utteranceId: String?) = finished()

        @Deprecated("Required by the base class", ReplaceWith(""))
        override fun onError(utteranceId: String?) = finished()

        override fun onError(utteranceId: String?, errorCode: Int) = finished()

        private fun finished() {
            speakingText = null
            notifySpeaking(null)
        }
    }

    private fun notifySpeaking(text: String?) = main.post { onSpeakingChanged(text) }

    private companion object {
        const val TAG = "Speaker"
        const val UTTERANCE_ID = "hr-genie-answer"
    }
}
