package com.infinitylearn.hrgenie.ui.common

import android.content.Context
import android.util.AttributeSet
import android.view.View
import android.view.ViewGroup

/**
 * Minimal wrapping row layout for the multi-select reason chips. Children keep their
 * measured size and flow onto a new line when they run out of horizontal room.
 */
class FlowLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : ViewGroup(context, attrs, defStyleAttr) {

    /** Gap between chips, both directions. */
    var itemSpacing: Int = (9 * resources.displayMetrics.density).toInt()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxWidth = MeasureSpec.getSize(widthMeasureSpec) - paddingStart - paddingEnd
        val childSpec = MeasureSpec.makeMeasureSpec(maxWidth, MeasureSpec.AT_MOST)

        var rowWidth = 0
        var rowHeight = 0
        var totalHeight = 0
        var widest = 0

        forEachVisibleChild { child ->
            child.measure(childSpec, MeasureSpec.UNSPECIFIED)
            val needed = child.measuredWidth + if (rowWidth == 0) 0 else itemSpacing
            if (rowWidth + needed > maxWidth && rowWidth > 0) {
                widest = maxOf(widest, rowWidth)
                totalHeight += rowHeight + itemSpacing
                rowWidth = child.measuredWidth
                rowHeight = child.measuredHeight
            } else {
                rowWidth += needed
                rowHeight = maxOf(rowHeight, child.measuredHeight)
            }
        }
        widest = maxOf(widest, rowWidth)
        totalHeight += rowHeight

        setMeasuredDimension(
            resolveSize(widest + paddingStart + paddingEnd, widthMeasureSpec),
            resolveSize(totalHeight + paddingTop + paddingBottom, heightMeasureSpec),
        )
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxWidth = r - l - paddingStart - paddingEnd
        var x = paddingStart
        var y = paddingTop
        var rowHeight = 0

        forEachVisibleChild { child ->
            val needed = child.measuredWidth + if (x == paddingStart) 0 else itemSpacing
            if (x + needed > paddingStart + maxWidth && x > paddingStart) {
                x = paddingStart
                y += rowHeight + itemSpacing
                rowHeight = 0
            } else if (x > paddingStart) {
                x += itemSpacing
            }
            child.layout(x, y, x + child.measuredWidth, y + child.measuredHeight)
            x += child.measuredWidth
            rowHeight = maxOf(rowHeight, child.measuredHeight)
        }
    }

    private inline fun forEachVisibleChild(action: (View) -> Unit) {
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            if (child.visibility != GONE) action(child)
        }
    }
}
