package com.infinitylearn.hrgenie.data

import android.content.Context
import android.util.Log

/**
 * Tickets, server-first with the device as a cache.
 *
 * The server is the only source of truth — it has to be, because a ticket is the one
 * thing two people act on from two phones. But every screen here renders synchronously
 * from [TicketStore], so rather than rewriting them all to await a call, each fetch
 * mirrors what came back into the store and the screens re-read it.
 *
 * That also means the app still shows the last known state with no network, instead of
 * an empty list.
 */
class TicketRepository(context: Context, private val token: String?) {

    private val store = TicketStore(context)
    private val api = Tickets.gateway(token)

    /** What is on the device right now. Never hits the network. */
    fun cachedForEmployee(employeeId: String): List<Ticket> = store.forEmployee(employeeId)

    fun cachedAll(): List<Ticket> = store.all()

    /**
     * Pulls this employee's tickets and mirrors them.
     *
     * Returns false when the fetch failed, so the caller can say the list may be
     * stale rather than silently showing yesterday's.
     */
    suspend fun refreshForEmployee(employeeId: String): Boolean {
        if (token == null) return false
        return api.forEmployee(employeeId)
            .onSuccess { store.replaceForEmployee(employeeId, it) }
            .onFailure { Log.w(TAG, "Could not refresh tickets for $employeeId", it) }
            .isSuccess
    }

    /** Pulls every ticket for the HR dashboard. */
    suspend fun refreshAll(): Boolean {
        if (token == null) return false
        return api.all()
            .onSuccess { store.replaceAll(it) }
            .onFailure { Log.w(TAG, "Could not refresh all tickets", it) }
            .isSuccess
    }

    /**
     * Raises a ticket.
     *
     * Deliberately has no offline path: the id is minted by the server, and a locally
     * numbered ticket would collide with the real one the moment it synced. A failure
     * here has to be told to the employee, not hidden.
     */
    suspend fun raise(employeeId: String, subject: String, category: String): Result<Ticket> =
        api.raise(employeeId, subject, category)
            .onSuccess { store.upsert(it, seen = true) }

    /**
     * Moves a ticket, recording what HR did.
     *
     * The blank-comment rule for RESOLVED is enforced by the server too; it is checked
     * here so the sheet can refuse without a round trip.
     */
    suspend fun updateStatus(
        ticketId: String,
        status: TicketStatus,
        comment: String,
        authorId: String,
    ): Result<Ticket> {
        val note = comment.trim()
        if (status == TicketStatus.RESOLVED && note.isEmpty()) {
            return Result.failure(IllegalArgumentException("Resolving needs a comment"))
        }
        return api.updateStatus(ticketId, status, note, authorId)
            .onSuccess { store.upsert(it) }
    }

    /** The categories the server offers, or the built-in list if it cannot be asked. */
    suspend fun categories(): List<String> =
        api.categories().getOrNull()?.takeIf { it.isNotEmpty() } ?: HrGenieContent.TICKET_CATEGORIES

    // Seen tracking stays on the device: "have I shown this person this update yet" is
    // a fact about this phone, not about the account.
    fun unseenUpdates(employeeId: String): List<Ticket> = store.unseenUpdates(employeeId)

    fun markSeen(employeeId: String) = store.markSeen(employeeId)

    private companion object {
        const val TAG = "HrGenieTickets"
    }
}
