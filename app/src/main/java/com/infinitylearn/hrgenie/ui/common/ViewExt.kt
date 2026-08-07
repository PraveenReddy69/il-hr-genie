package com.infinitylearn.hrgenie.ui.common

import android.view.View
import android.view.animation.DecelerateInterpolator
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Screen entrance from the handoff: fade in with a 10dp rise over 350ms.
 */
fun View.playScreenEntrance(delayMs: Long = 0L) {
    alpha = 0f
    translationY = 10f * resources.displayMetrics.density
    animate()
        .alpha(1f)
        .translationY(0f)
        .setStartDelay(delayMs)
        .setDuration(350L)
        .setInterpolator(DecelerateInterpolator())
        .start()
}

/** Button press feedback: scale to 0.985 while held. */
@Suppress("ClickableViewAccessibility") // returns false, so performClick still runs
fun View.applyPressScale() {
    setOnTouchListener { v, event ->
        when (event.actionMasked) {
            android.view.MotionEvent.ACTION_DOWN ->
                v.animate().scaleX(0.985f).scaleY(0.985f).setDuration(90L).start()

            android.view.MotionEvent.ACTION_UP,
            android.view.MotionEvent.ACTION_CANCEL ->
                v.animate().scaleX(1f).scaleY(1f).setDuration(120L).start()
        }
        // Never consume: the view's own OnClickListener still runs.
        false
    }
}

/**
 * Adds the status-bar inset on top of whatever padding the layout already declares.
 * Headers are full-bleed gradients, so they draw behind the status bar and pad
 * their content down instead.
 */
fun View.applyTopInsetPadding() {
    val base = paddingTop
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
        v.updatePaddingTop(base + top)
        insets
    }
    ViewCompat.requestApplyInsets(this)
}

/** Same idea for the navigation bar, used on screens without the bottom nav. */
fun View.applyBottomInsetPadding() {
    val base = paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val bottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
        v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, base + bottom)
        insets
    }
    ViewCompat.requestApplyInsets(this)
}

/** Grows padding for both the IME and the navigation bar — used by the chat composer. */
fun View.applyImeAndBottomInsetPadding() {
    val base = paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, base + maxOf(bars, ime))
        insets
    }
    ViewCompat.requestApplyInsets(this)
}

private fun View.updatePaddingTop(value: Int) =
    setPadding(paddingLeft, value, paddingRight, paddingBottom)

fun Int.dp(view: View): Int = (this * view.resources.displayMetrics.density).toInt()

fun Float.dp(view: View): Int = (this * view.resources.displayMetrics.density).toInt()
