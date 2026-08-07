package com.infinitylearn.hrgenie.ui.holidays

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.databinding.FragmentHolidaysBinding
import com.infinitylearn.hrgenie.ui.common.applyBottomInsetPadding
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance

class HolidaysFragment : Fragment() {

    private var _binding: FragmentHolidaysBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentHolidaysBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.header.applyTopInsetPadding()
        binding.content.applyBottomInsetPadding()
        binding.content.playScreenEntrance()
        // The blue band runs edge to edge; clip it to the card radius (API 31 attr, minSdk 24).
        binding.holidayCard.clipToOutline = true

        val all = HrGenieContent.HOLIDAYS
        val remaining = all.count { !it.isPast(HrGenieContent.todayIso) }
        binding.holidaysSub.text = getString(R.string.holidays_sub, all.size, remaining)

        binding.holidayList.layoutManager = LinearLayoutManager(requireContext())
        binding.holidayList.adapter = HolidayAdapter(buildRows())

        binding.backButton.setOnClickListener { findNavController().popBackStack() }
    }

    /** Flattens the year into month headers followed by their holidays. */
    private fun buildRows(): List<HolidayRow> = buildList {
        HrGenieContent.HOLIDAYS
            .groupBy { it.monthLabel }
            .forEach { (month, holidays) ->
                add(HolidayRow.Month(month))
                holidays.forEachIndexed { index, holiday ->
                    add(
                        HolidayRow.Entry(
                            holiday = holiday,
                            isPast = holiday.isPast(HrGenieContent.todayIso),
                            isLastInMonth = index == holidays.lastIndex,
                        )
                    )
                }
            }
    }

    override fun onDestroyView() {
        binding.holidayList.adapter = null
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
    }
}
