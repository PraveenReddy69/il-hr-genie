package com.infinitylearn.hrgenie.ui.common

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.LinearLayout
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.databinding.ItemTrendBarBinding

/**
 * Weekly bar charts (personal check-in trend and the HRBP org trend) share one
 * geometry: bar height ramps from 18dp to 80dp across the value range, the last
 * column is highlighted, and week labels sit underneath.
 */
object BarCharts {

    private const val MIN_HEIGHT_DP = 18f
    private const val EXTRA_HEIGHT_DP = 62f

    fun render(
        container: LinearLayout,
        values: List<Float>,
        maxValue: Float,
        highlightLast: Boolean = true,
        gapDp: Int = 9,
        mutedBar: Int = R.drawable.bg_bar_other,
    ) {
        val inflater = LayoutInflater.from(container.context)
        val density = container.resources.displayMetrics.density
        container.removeAllViews()

        values.forEachIndexed { index, value ->
            val column = ItemTrendBarBinding.inflate(inflater, container, false)
            val ratio = (value / maxValue).coerceIn(0f, 1f)
            val heightPx = ((MIN_HEIGHT_DP + ratio * EXTRA_HEIGHT_DP) * density).toInt()

            column.bar.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                heightPx,
            )
            val isCurrent = highlightLast && index == values.lastIndex
            column.bar.setBackgroundResource(
                if (isCurrent) R.drawable.bg_bar_current else mutedBar
            )
            column.weekLabel.text =
                container.context.getString(R.string.week_label, index + 1)

            val params = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            if (index > 0) params.marginStart = (gapDp * density).toInt()
            container.addView(column.root, params)
        }
    }
}
