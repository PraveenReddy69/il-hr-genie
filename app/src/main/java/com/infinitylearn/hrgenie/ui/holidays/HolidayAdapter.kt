package com.infinitylearn.hrgenie.ui.holidays

import android.graphics.Paint
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.Holiday
import com.infinitylearn.hrgenie.databinding.ItemHolidayFullBinding
import com.infinitylearn.hrgenie.databinding.ItemHolidayMonthBinding

sealed interface HolidayRow {
    data class Month(val label: String) : HolidayRow

    /** [isLastInMonth] suppresses the dashed rule at the end of a group. */
    data class Entry(
        val holiday: Holiday,
        val isPast: Boolean,
        val isLastInMonth: Boolean,
    ) : HolidayRow
}

class HolidayAdapter(private val rows: List<HolidayRow>) :
    RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    override fun getItemCount(): Int = rows.size

    override fun getItemViewType(position: Int): Int =
        if (rows[position] is HolidayRow.Month) TYPE_MONTH else TYPE_ENTRY

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == TYPE_MONTH) {
            MonthHolder(ItemHolidayMonthBinding.inflate(inflater, parent, false))
        } else {
            EntryHolder(ItemHolidayFullBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val row = rows[position]) {
            is HolidayRow.Month -> (holder as MonthHolder).binding.monthLabel.text = row.label

            is HolidayRow.Entry -> {
                val binding = (holder as EntryHolder).binding
                binding.holidayName.text = row.holiday.name
                binding.holidayDate.text = row.holiday.dateLabel

                binding.row.alpha = if (row.isPast) 0.45f else 1f
                binding.dot.setBackgroundResource(
                    if (row.isPast) R.drawable.bg_dot_past else R.drawable.bg_dot_blue
                )
                binding.holidayName.paintFlags = if (row.isPast) {
                    binding.holidayName.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                } else {
                    binding.holidayName.paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
                }

                binding.rule.visibility = if (row.isLastInMonth) View.GONE else View.VISIBLE
                if (!row.isLastInMonth) {
                    // Dashed strokes need a software layer on a hardware canvas.
                    binding.rule.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
                    binding.rule.setBackgroundResource(R.drawable.divider_dashed)
                }
            }
        }
    }

    class MonthHolder(val binding: ItemHolidayMonthBinding) :
        RecyclerView.ViewHolder(binding.root)

    class EntryHolder(val binding: ItemHolidayFullBinding) :
        RecyclerView.ViewHolder(binding.root)

    private companion object {
        const val TYPE_MONTH = 0
        const val TYPE_ENTRY = 1
    }
}
