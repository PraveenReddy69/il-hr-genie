package com.infinitylearn.hrgenie.ui.mood

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.Mood
import com.infinitylearn.hrgenie.data.MoodKey

class MoodViewModel : ViewModel() {

    private val _step = MutableLiveData(0)
    val step: LiveData<Int> = _step

    private val _selectedMood = MutableLiveData<MoodKey?>(null)
    val selectedMood: LiveData<MoodKey?> = _selectedMood

    private val _reasons = MutableLiveData<Set<String>>(emptySet())
    val reasons: LiveData<Set<String>> = _reasons

    var note: String = ""

    val mood: Mood?
        get() = _selectedMood.value?.let(HrGenieContent::mood)

    /**
     * Eight weeks of personal scores; the final bar is this week's check-in, so it
     * only firms up once a mood is chosen.
     */
    val weeklyTrend: List<Int>
        get() = HrGenieContent.PERSONAL_TREND_HISTORY + (mood?.trendValue ?: 6)

    fun pick(key: MoodKey) {
        _selectedMood.value = key
        _reasons.value = emptySet()
        _step.value = 1
    }

    fun toggleReason(reason: String) {
        val current = _reasons.value.orEmpty()
        _reasons.value = if (reason in current) current - reason else current + reason
    }

    /** Reopens an entry already logged today, straight at the confirmation. */
    fun restore(mood: MoodKey, reasons: Set<String>, note: String) {
        _selectedMood.value = mood
        _reasons.value = reasons
        this.note = note
        _step.value = 2
    }

    fun save() {
        // Real build: POST { mood, reasons, note } and drop the note client-side after.
        _step.value = 2
    }

    /** True when the back press was handled internally rather than leaving the screen. */
    fun goBack(): Boolean {
        val current = _step.value ?: 0
        if (current == 0) return false
        _step.value = current - 1
        return true
    }

    fun reset() {
        _step.value = 0
        _selectedMood.value = null
        _reasons.value = emptySet()
        note = ""
    }
}
