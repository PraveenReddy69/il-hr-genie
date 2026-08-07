package com.infinitylearn.hrgenie.ui.common

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan

/**
 * Renders the sliver of markdown the knowledge base actually emits: `**bold**` runs
 * and `- ` bullets. Anything else is left as written.
 *
 * A markdown library would be a dependency for two rules, and rendering the raw
 * asterisks would look broken in a chat bubble.
 */
fun renderAnswer(raw: String): CharSequence {
    val builder = SpannableStringBuilder()

    raw.trim().lines().forEachIndexed { index, line ->
        if (index > 0) builder.append('\n')
        val trimmed = line.trim()
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            builder.append("•  ")
            appendInline(builder, trimmed.drop(2))
        } else {
            appendInline(builder, line)
        }
    }

    return builder
}

/** Consumes `**bold**` pairs, emphasising what is between them. */
private fun appendInline(builder: SpannableStringBuilder, text: String) {
    var cursor = 0
    while (true) {
        val open = text.indexOf(BOLD, cursor)
        if (open < 0) break
        val close = text.indexOf(BOLD, open + BOLD.length)
        if (close < 0) break

        builder.append(text, cursor, open)
        val start = builder.length
        builder.append(text, open + BOLD.length, close)
        builder.setSpan(
            StyleSpan(Typeface.BOLD),
            start,
            builder.length,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        cursor = close + BOLD.length
    }
    builder.append(text, cursor, text.length)
}

private const val BOLD = "**"
