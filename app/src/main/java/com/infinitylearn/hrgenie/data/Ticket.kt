package com.infinitylearn.hrgenie.data

import android.content.Context
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

enum class TicketStatus(val label: String) {
    OPEN("Open"),
    IN_PROGRESS("In progress"),
    RESOLVED("Resolved"),
}

/** What HR did, recorded against the status they moved the ticket to. */
data class TicketComment(
    val status: TicketStatus,
    val text: String,
    val authorId: String,
    val atMillis: Long,
)

/**
 * A request raised with HR. Chat is the intended entry point, so the store is written
 * from there; the HRBP dashboard only reads.
 */
data class Ticket(
    val id: String,
    val employeeId: String,
    val subject: String,
    val category: String,
    val createdAtMillis: Long,
    val status: TicketStatus,
    /** When the status last moved; equals [createdAtMillis] until HR touches it. */
    val updatedAtMillis: Long = createdAtMillis,
    /** Oldest first — the trail of what HR did at each step. */
    val comments: List<TicketComment> = emptyList(),
) {
    val isOpen: Boolean get() = status != TicketStatus.RESOLVED

    /** The note attached to the current status, if HR left one. */
    val latestComment: TicketComment? get() = comments.lastOrNull()

    /** "just now", "3h ago", "2d ago" — relative age for the dashboard rows. */
    fun ageLabel(now: Long): String {
        val elapsed = (now - createdAtMillis).coerceAtLeast(0L)
        val minutes = TimeUnit.MILLISECONDS.toMinutes(elapsed)
        val hours = TimeUnit.MILLISECONDS.toHours(elapsed)
        val days = TimeUnit.MILLISECONDS.toDays(elapsed)
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "${minutes}m ago"
            hours < 24 -> "${hours}h ago"
            else -> "${days}d ago"
        }
    }
}

/**
 * Tickets kept on the device, like every other store here. One JSON array under a
 * single key: the list is short and always read whole, so per-ticket keys would only
 * add an index to maintain.
 */
class TicketStore(context: Context) {

    private val prefs =
        context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    /** Newest first, which is the order both the dashboard and chat want. */
    fun all(): List<Ticket> = read().sortedByDescending { it.createdAtMillis }

    fun forEmployee(employeeId: String): List<Ticket> =
        all().filter { it.employeeId.equals(employeeId, ignoreCase = true) }

    fun raise(
        employeeId: String,
        subject: String,
        category: String,
        now: Long = System.currentTimeMillis(),
    ): Ticket {
        val existing = read()
        val ticket = Ticket(
            id = nextId(existing.size),
            employeeId = employeeId,
            subject = subject,
            category = category,
            createdAtMillis = now,
            status = TicketStatus.OPEN,
        )
        write(existing + ticket)
        // The employee watched this happen, so it is not an update to announce.
        rememberSeen(listOf(ticket))
        return ticket
    }

    /**
     * Moves a ticket, recording what HR did.
     *
     * A blank comment is refused for [TicketStatus.RESOLVED] — closing a request is
     * the one transition the employee cannot ask about afterwards, so it has to say
     * what was done. Returns false and changes nothing when that rule is broken.
     */
    fun updateStatus(
        ticketId: String,
        status: TicketStatus,
        comment: String = "",
        authorId: String = "",
        now: Long = System.currentTimeMillis(),
    ): Boolean {
        val note = comment.trim()
        if (status == TicketStatus.RESOLVED && note.isEmpty()) return false

        write(
            read().map { ticket ->
                if (ticket.id != ticketId) return@map ticket
                ticket.copy(
                    status = status,
                    updatedAtMillis = now,
                    comments = if (note.isEmpty()) {
                        ticket.comments
                    } else {
                        ticket.comments + TicketComment(status, note, authorId, now)
                    },
                )
            }
        )
        return true
    }

    // -------------------------------------------------------------- server mirror

    /**
     * Replaces everything with what the server sent.
     *
     * Used for the HR dashboard, which fetches the whole set — anything not in the
     * response no longer exists, so a plain overwrite is correct.
     */
    fun replaceAll(tickets: List<Ticket>) = write(tickets)

    /**
     * Replaces just this employee's tickets, leaving everyone else's cache alone.
     *
     * An employee only ever fetches their own, so their absence from that response
     * says nothing about anybody else's.
     */
    fun replaceForEmployee(employeeId: String, tickets: List<Ticket>) {
        val others = read().filterNot { it.employeeId.equals(employeeId, ignoreCase = true) }
        write(others + tickets)
    }

    /**
     * Writes one ticket back, replacing any earlier copy.
     *
     * [seen] marks it as already shown, for a ticket the employee just raised: they
     * watched it happen, so it is not an update to announce.
     */
    fun upsert(ticket: Ticket, seen: Boolean = false) {
        write(read().filterNot { it.id == ticket.id } + ticket)
        if (seen) rememberSeen(listOf(ticket))
    }

    // ------------------------------------------------------------ seen tracking

    /**
     * Tickets whose status has moved since this employee was last shown them.
     *
     * A ticket the employee raised is seen the moment it is raised — they watched it
     * happen — so only HR's changes surface here.
     */
    fun unseenUpdates(employeeId: String): List<Ticket> {
        val seen = readSeen()
        return forEmployee(employeeId).filter { ticket ->
            // Never seen and still OPEN means it arrived from the server having been
            // raised on another device — nothing has happened to it, so announcing it
            // as an HR update would be wrong. Only a status HR actually moved counts.
            if (ticket.id !in seen) {
                return@filter ticket.status != TicketStatus.OPEN
            }
            seen[ticket.id] != ticket.status.name
        }
    }

    /** Records where every one of this employee's tickets currently stands. */
    fun markSeen(employeeId: String) = rememberSeen(forEmployee(employeeId))

    private fun rememberSeen(tickets: List<Ticket>) {
        val seen = readSeen().toMutableMap()
        tickets.forEach { seen[it.id] = it.status.name }
        val json = JSONObject()
        seen.forEach { (id, status) -> json.put(id, status) }
        prefs.edit().putString(KEY_SEEN, json.toString()).commit()
    }

    private fun readSeen(): Map<String, String> {
        val raw = prefs.getString(KEY_SEEN, null) ?: return emptyMap()
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap()
        return json.keys().asSequence().associateWith { json.optString(it) }
    }

    fun clear() = prefs.edit().remove(KEY_TICKETS).remove(KEY_SEEN).commit()

    private fun nextId(count: Int): String = "HRG-%04d".format(count + 1)

    private fun read(): List<Ticket> {
        val raw = prefs.getString(KEY_TICKETS, null) ?: return emptyList()
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val json = array.optJSONObject(index) ?: return@mapNotNull null
            val status = runCatching { TicketStatus.valueOf(json.optString(FIELD_STATUS)) }
                .getOrNull() ?: return@mapNotNull null
            Ticket(
                id = json.optString(FIELD_ID),
                employeeId = json.optString(FIELD_EMPLOYEE),
                subject = json.optString(FIELD_SUBJECT),
                category = json.optString(FIELD_CATEGORY),
                createdAtMillis = json.optLong(FIELD_CREATED),
                status = status,
                updatedAtMillis = json.optLong(FIELD_UPDATED, json.optLong(FIELD_CREATED)),
                comments = readComments(json.optJSONArray(FIELD_COMMENTS)),
            )
        }
    }

    private fun readComments(array: JSONArray?): List<TicketComment> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val json = array.optJSONObject(index) ?: return@mapNotNull null
            val status = runCatching { TicketStatus.valueOf(json.optString(FIELD_STATUS)) }
                .getOrNull() ?: return@mapNotNull null
            TicketComment(
                status = status,
                text = json.optString(FIELD_TEXT),
                authorId = json.optString(FIELD_AUTHOR),
                atMillis = json.optLong(FIELD_AT),
            )
        }
    }

    private fun write(tickets: List<Ticket>) {
        val array = JSONArray()
        tickets.forEach { ticket ->
            val comments = JSONArray()
            ticket.comments.forEach { comment ->
                comments.put(
                    JSONObject()
                        .put(FIELD_STATUS, comment.status.name)
                        .put(FIELD_TEXT, comment.text)
                        .put(FIELD_AUTHOR, comment.authorId)
                        .put(FIELD_AT, comment.atMillis)
                )
            }
            array.put(
                JSONObject()
                    .put(FIELD_ID, ticket.id)
                    .put(FIELD_EMPLOYEE, ticket.employeeId)
                    .put(FIELD_SUBJECT, ticket.subject)
                    .put(FIELD_CATEGORY, ticket.category)
                    .put(FIELD_CREATED, ticket.createdAtMillis)
                    .put(FIELD_UPDATED, ticket.updatedAtMillis)
                    .put(FIELD_STATUS, ticket.status.name)
                    .put(FIELD_COMMENTS, comments)
            )
        }
        // commit, not apply: the demo switches users and screens immediately after.
        prefs.edit().putString(KEY_TICKETS, array.toString()).commit()
    }

    private companion object {
        const val FILE_NAME = "hr_genie_tickets"
        const val KEY_TICKETS = "tickets"
        const val KEY_SEEN = "seen"
        const val FIELD_ID = "id"
        const val FIELD_UPDATED = "updatedAt"
        const val FIELD_EMPLOYEE = "employeeId"
        const val FIELD_SUBJECT = "subject"
        const val FIELD_CATEGORY = "category"
        const val FIELD_CREATED = "createdAt"
        const val FIELD_STATUS = "status"
        const val FIELD_COMMENTS = "comments"
        const val FIELD_TEXT = "text"
        const val FIELD_AUTHOR = "author"
        const val FIELD_AT = "at"
    }
}
