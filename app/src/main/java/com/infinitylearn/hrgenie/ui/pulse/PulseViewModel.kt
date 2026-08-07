package com.infinitylearn.hrgenie.ui.pulse

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.PulseQuestion

class PulseViewModel : ViewModel() {

    val questions: List<PulseQuestion> = HrGenieContent.PULSE_QUESTIONS

    private val _index = MutableLiveData(0)
    val index: LiveData<Int> = _index

    private val _isComplete = MutableLiveData(false)
    val isComplete: LiveData<Boolean> = _isComplete

    /** Question id -> chosen option. Skipped questions are simply absent. */
    private val _answers = mutableMapOf<String, String>()
    val answers: Map<String, String> get() = _answers.toMap()

    val currentQuestion: PulseQuestion
        get() = questions[(_index.value ?: 0).coerceIn(questions.indices)]

    fun answer(option: String) {
        _answers[currentQuestion.id] = option
        advance()
    }

    fun skip() = advance()

    private fun advance() {
        val next = (_index.value ?: 0) + 1
        if (next >= questions.size) {
            _isComplete.value = true
        } else {
            _index.value = next
        }
    }

    /** True when the back press moved to the previous question instead of leaving. */
    fun goBack(): Boolean {
        if (_isComplete.value == true) return false
        val current = _index.value ?: 0
        if (current == 0) return false
        _index.value = current - 1
        return true
    }

    fun reset() {
        _answers.clear()
        _index.value = 0
        _isComplete.value = false
    }
}
