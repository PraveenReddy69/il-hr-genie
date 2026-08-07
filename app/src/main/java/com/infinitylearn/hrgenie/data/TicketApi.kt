package com.infinitylearn.hrgenie.data

import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.data.net.HttpJson
import org.json.JSONArray
import org.json.JSONObject

/** What [TicketRepository] needs from a backend. Implemented by [TicketApi]. */
interface TicketGateway {
    suspend fun forEmployee(employeeId: String): Result<List<Ticket>>
    suspend fun all(): Result<List<Ticket>>
    suspend fun raise(employeeId: String, subject: String, category: String): Result<Ticket>
    suspend fun updateStatus(
        ticketId: String,
        status: TicketStatus,
        comment: String,
        authorId: String,
    ): Result<Ticket>
    suspend fun categories(): Result<List<String>>
}

/**
 * Where ticket calls go.
 *
 * A seam rather than a direct [TicketApi], so the screen tests can drive the whole
 * ticket flow without a server — the same trick [Auth] uses for sign-in. Production
 * never reassigns it.
 */
object Tickets {

    @Volatile
    var gateway: (token: String?) -> TicketGateway = { token -> TicketApi(token) }
}

/**
 * Tickets on the server.
 *
 * The wire shape matches [Ticket] field for field apart from the names — the server
 * says `createdAtMillis` where the local store's JSON says `createdAt`, and
 * `authorId` where it says `author` — so parsing lives here rather than being shared
 * with [TicketStore]. The two formats are free to drift; only this file cares.
 */
class TicketApi(private val token: String?) : TicketGateway {

    /** This employee's own tickets. */
    override suspend fun forEmployee(employeeId: String): Result<List<Ticket>> =
        HttpJson.getArray("$PATH?employeeId=$employeeId", token).map { it.toTickets() }

    /**
     * Every ticket, for the HR dashboard.
     *
     * `/tickets/list` is the paged one and wraps its rows in an envelope. The limit is
     * deliberately generous: the dashboard shows counts across the whole workforce, so
     * a partial page would report the wrong totals.
     */
    override suspend fun all(): Result<List<Ticket>> =
        HttpJson.get("$PATH/list?page=1&limit=$PAGE_LIMIT", token)
            .map { it.optJSONArray("items").toTickets() }

    override suspend fun raise(employeeId: String, subject: String, category: String): Result<Ticket> =
        HttpJson.post(
            path = PATH,
            body = JSONObject()
                .put("employeeId", employeeId)
                .put("subject", subject)
                .put("category", category),
            token = token,
        ).mapCatching { it.toTicket() ?: throw ApiException(unusable("raise")) }

    /**
     * Moves a ticket. HR only — the server answers 403 for anyone else, which is the
     * rule the app relies on rather than re-deciding it here.
     */
    override suspend fun updateStatus(
        ticketId: String,
        status: TicketStatus,
        comment: String,
        authorId: String,
    ): Result<Ticket> =
        HttpJson.patch(
            path = "$PATH/$ticketId/status",
            body = JSONObject()
                .put("status", status.name)
                .apply {
                    if (comment.isNotBlank()) put("comment", comment)
                    if (authorId.isNotBlank()) put("authorId", authorId)
                },
            token = token,
        ).mapCatching { it.toTicket() ?: throw ApiException(unusable("status change")) }

    /** The categories a ticket may be raised under, as the server defines them. */
    override suspend fun categories(): Result<List<String>> =
        HttpJson.get("$PATH/categories", token).map { json ->
            val array = json.optJSONArray("categories") ?: return@map emptyList()
            (0 until array.length()).map(array::optString).filter { it.isNotBlank() }
        }

    private fun unusable(what: String) =
        ApiFailure.Unusable("$what returned something that is not a ticket")

    private fun JSONArray?.toTickets(): List<Ticket> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { optJSONObject(it)?.toTicket() }
    }

    /** Null rather than throwing: one malformed row must not lose the whole list. */
    private fun JSONObject.toTicket(): Ticket? {
        val id = optString("id").takeIf { it.isNotBlank() } ?: return null
        val status = statusOf(optString("status")) ?: return null
        val created = optLong("createdAtMillis")
        return Ticket(
            id = id,
            employeeId = optString("employeeId"),
            subject = optString("subject"),
            category = optString("category"),
            createdAtMillis = created,
            status = status,
            updatedAtMillis = optLong("updatedAtMillis", created),
            comments = optJSONArray("comments").toComments(),
        )
    }

    private fun JSONArray?.toComments(): List<TicketComment> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { index ->
            val json = optJSONObject(index) ?: return@mapNotNull null
            TicketComment(
                status = statusOf(json.optString("status")) ?: return@mapNotNull null,
                text = json.optString("text"),
                authorId = json.optString("authorId"),
                atMillis = json.optLong("atMillis"),
            )
        }
    }

    private fun statusOf(raw: String): TicketStatus? =
        runCatching { TicketStatus.valueOf(raw) }.getOrNull()

    private companion object {
        const val PATH = "/api/tickets"
        /** The server rejects anything above 200. */
        const val PAGE_LIMIT = 200
    }
}
