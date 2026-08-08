package com.infinitylearn.hrgenie.ui.common

import android.os.Bundle
import android.util.Log
import androidx.annotation.IdRes
import androidx.navigation.NavController
import androidx.navigation.NavOptions

/**
 * Navigates only if the target is reachable from where we actually are.
 *
 * [NavController.navigate] throws — and takes the process with it — when the current
 * destination has no route to the id. Two ordinary things cause that:
 *
 * - **A second tap while the first is still in flight.** The destination has already
 *   changed by the time the second click runs, and the action belonged to the old one.
 * - **A listener that outlives its screen.** A popup menu, for instance, holds a
 *   reference to the fragment that opened it and keeps firing after navigation.
 *
 * In both cases dropping the call is the right outcome: the screen being asked for is
 * the one already on its way. Nothing is retried and nothing is shown — a second tap
 * doing nothing is what the user expected of a single tap anyway.
 *
 * This is not a blanket try/catch. An id that is genuinely wired up wrong still fails
 * loudly at the point of the mistake, because it will fail on the *first* tap too.
 */
fun NavController.navigateSafely(
    @IdRes target: Int,
    args: Bundle? = null,
    options: NavOptions? = null,
) {
    val from = currentDestination
    if (from != null && from.id == target) return

    val reachable = from?.getAction(target) != null ||
        from?.parent?.findNode(target) != null ||
        graph.findNode(target) != null
    if (!reachable) {
        Log.i(TAG, "Dropped navigation to $target from ${from?.label ?: "an unsettled graph"}")
        return
    }

    navigate(target, args, options)
}

private const val TAG = "HrGenieNav"
