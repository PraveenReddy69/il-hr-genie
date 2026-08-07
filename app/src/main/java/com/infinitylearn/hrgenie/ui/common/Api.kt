package com.infinitylearn.hrgenie.ui.common

import androidx.fragment.app.Fragment
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.TicketRepository

/**
 * The bearer token for API calls.
 *
 * In memory first: with "keep me signed in" off nothing is written to disk, so the
 * session holds the only copy. Storage is the fallback after process death.
 */
fun Fragment.authToken(session: SessionViewModel): String? =
    session.token ?: SessionStore(requireContext()).token()

fun Fragment.ticketRepository(session: SessionViewModel): TicketRepository =
    TicketRepository(requireContext(), authToken(session))
