package com.infinitylearn.hrgenie.ui.common

import androidx.annotation.ColorRes
import androidx.fragment.app.Fragment
import com.infinitylearn.hrgenie.MainActivity

/**
 * Matches the status-bar strip to this screen's top edge. Call from `onResume` so it
 * re-applies when the user navigates back to the screen.
 *
 * @param lightIcons true for dark backgrounds (white clock and battery).
 */
fun Fragment.applyStatusScrim(@ColorRes color: Int, lightIcons: Boolean = true) {
    (activity as? MainActivity)?.setStatusScrim(color, lightIcons)
}
