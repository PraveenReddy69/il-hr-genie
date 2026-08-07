package com.infinitylearn.hrgenie.ui.common

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import androidx.annotation.ColorInt

/** One slice: how many, and the colour that identifies it in the legend. */
data class DonutSegment(val value: Int, @param:ColorInt val color: Int)

/**
 * A part-to-whole ring.
 *
 * Values are never drawn on the ring itself — with counts this small the slices are
 * often close in size, so the shape carries the proportion and the legend beside it
 * carries the exact numbers. Segments are separated by a surface-coloured gap rather
 * than a stroke, so they read as distinct without adding a second colour.
 */
class DonutChartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    private val density = resources.displayMetrics.density

    private val arcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.BUTT
    }

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.BUTT
    }

    private val bounds = RectF()

    private var segments: List<DonutSegment> = emptyList()

    /** Ring thickness. Thin marks: the hole is the point, not the ink. */
    var ringWidthDp: Float = 13f
        set(value) {
            field = value
            invalidate()
        }

    /** Shown when there is nothing to plot, so the card never renders as a void. */
    @ColorInt
    var trackColor: Int = 0x14000000
        set(value) {
            field = value
            invalidate()
        }

    fun setSegments(segments: List<DonutSegment>) {
        this.segments = segments.filter { it.value > 0 }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val stroke = ringWidthDp * density
        val inset = stroke / 2f
        bounds.set(inset, inset, width - inset, height - inset)

        trackPaint.strokeWidth = stroke
        trackPaint.color = trackColor
        arcPaint.strokeWidth = stroke

        val total = segments.sumOf { it.value }
        if (total == 0) {
            canvas.drawArc(bounds, 0f, 360f, false, trackPaint)
            return
        }

        // A lone segment has no neighbour to separate it from, so it stays whole.
        val gap = if (segments.size > 1) GAP_DEGREES else 0f
        var start = START_ANGLE
        segments.forEach { segment ->
            val sweep = 360f * segment.value / total
            arcPaint.color = segment.color
            canvas.drawArc(bounds, start + gap / 2f, sweep - gap, false, arcPaint)
            start += sweep
        }
    }

    private companion object {
        /** Twelve o'clock, reading clockwise. */
        const val START_ANGLE = -90f

        /** The surface gap between neighbouring slices, in degrees. */
        const val GAP_DEGREES = 3f
    }
}
