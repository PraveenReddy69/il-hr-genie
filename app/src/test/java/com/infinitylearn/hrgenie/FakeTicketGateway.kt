package com.infinitylearn.hrgenie

import android.content.Context
import com.infinitylearn.hrgenie.data.Ticket
import com.infinitylearn.hrgenie.data.TicketGateway
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.data.TicketStore

/**
 * The ticket server, standing in for the real one.
 *
 * Backed by [TicketStore] so it behaves like a shared backend would: what one screen
 * raises, another screen sees. That is exactly what the end-to-end tests are checking
 * — an employee raising a ticket in chat and HR finding it on the dashboard — and it
 * keeps those tests off the network.
 */
class FakeTicketGateway(context: Context) : TicketGateway {

    private val store = TicketStore(context)

    /** Set to make the next call fail, for the "server is down" paths. */
    var failure: Throwable? = null

    override suspend fun forEmployee(employeeId: String): Result<List<Ticket>> =
        failure?.let { Result.failure(it) } ?: Result.success(store.forEmployee(employeeId))

    override suspend fun all(): Result<List<Ticket>> =
        failure?.let { Result.failure(it) } ?: Result.success(store.all())

    override suspend fun raise(
        employeeId: String,
        subject: String,
        category: String,
    ): Result<Ticket> =
        failure?.let { Result.failure(it) }
            ?: Result.success(store.raise(employeeId, subject, category))

    override suspend fun updateStatus(
        ticketId: String,
        status: TicketStatus,
        comment: String,
        authorId: String,
    ): Result<Ticket> {
        failure?.let { return Result.failure(it) }
        // Mirrors the server's rule, which the sheet also checks before calling.
        if (!store.updateStatus(ticketId, status, comment, authorId)) {
            return Result.failure(IllegalArgumentException("Resolving needs a comment"))
        }
        val moved = store.all().firstOrNull { it.id == ticketId }
            ?: return Result.failure(IllegalStateException("No ticket $ticketId"))
        return Result.success(moved)
    }

    override suspend fun categories(): Result<List<String>> =
        Result.success(com.infinitylearn.hrgenie.data.HrGenieContent.TICKET_CATEGORIES)
}
