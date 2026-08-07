package com.infinitylearn.hrgenie.ui.common

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

/** What went wrong, in terms the composer can put on screen. */
enum class VoiceError { NO_SPEECH, NO_PERMISSION, NETWORK, BUSY, UNAVAILABLE, OTHER }

/**
 * Hold-to-talk dictation, wrapping [SpeechRecognizer].
 *
 * The recogniser is long-lived rather than created per press: constructing one costs
 * a service bind, which is long enough to clip the first word of a short utterance.
 *
 * Callers must call [release] when the view goes away — an unreleased recogniser
 * keeps its service connection alive.
 */
class VoiceRecorder(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null

    /** Partial text as it is heard, so the bar can show progress. */
    var onPartial: (String) -> Unit = {}

    /** The final transcript. Not called if the press was cancelled. */
    var onResult: (String) -> Unit = {}

    var onError: (VoiceError) -> Unit = {}

    /** Mic level, 0..1, for the pulse on the button. */
    var onLevel: (Float) -> Unit = {}

    private var cancelled = false
    private var listening = false

    val isAvailable: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start() {
        if (!isAvailable) {
            onError(VoiceError.UNAVAILABLE)
            return
        }
        if (listening) return

        cancelled = false
        listening = true

        val speech = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        speech.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
        )
    }

    /** Ends the press and asks for the final transcript. */
    fun stop() {
        if (!listening) return
        listening = false
        runCatching { recognizer?.stopListening() }
    }

    /** Ends the press and throws away whatever was heard. */
    fun cancel() {
        if (!listening) return
        listening = false
        cancelled = true
        runCatching { recognizer?.cancel() }
    }

    fun release() {
        listening = false
        runCatching { recognizer?.destroy() }
        recognizer = null
    }

    private val listener = object : RecognitionListener {
        override fun onPartialResults(results: Bundle?) {
            if (cancelled) return
            results.firstMatch()?.let(onPartial)
        }

        override fun onResults(results: Bundle?) {
            listening = false
            if (cancelled) return

            val text = results.firstMatch()
            if (text.isNullOrBlank()) onError(VoiceError.NO_SPEECH) else onResult(text)
        }

        override fun onError(error: Int) {
            listening = false
            if (cancelled) return

            Log.w(TAG, "Speech recognition error $error")
            onError(
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> VoiceError.NO_SPEECH

                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> VoiceError.NO_PERMISSION

                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> VoiceError.NETWORK

                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> VoiceError.BUSY

                    else -> VoiceError.OTHER
                }
            )
        }

        override fun onRmsChanged(rmsdB: Float) {
            // The API reports roughly -2..10 dB; map that onto 0..1.
            onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private fun Bundle?.firstMatch(): String? = this
        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        ?.firstOrNull()
        ?.trim()

    private companion object {
        const val TAG = "VoiceRecorder"
    }
}
