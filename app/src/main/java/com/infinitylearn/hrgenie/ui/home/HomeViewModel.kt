package com.infinitylearn.hrgenie.ui.home

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import com.infinitylearn.hrgenie.data.Holiday
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.WishGroup
import com.infinitylearn.hrgenie.data.WishTab

class HomeViewModel : ViewModel() {

    private val _wishTab = MutableLiveData(WishTab.BIRTHDAYS)
    val wishTab: LiveData<WishTab> = _wishTab


    val nextHolidays: List<Holiday> = HrGenieContent.UPCOMING_HOLIDAYS

    /**
     * What the HRMS says is happening today, once it has answered.
     *
     * Null until then, and the built-in list stands in — the card is above the fold,
     * so it should not be blank while a call is in flight.
     */
    private var serverWishes: Map<WishTab, WishGroup>? = null

    val currentWishes: WishGroup
        get() {
            val tab = _wishTab.value ?: WishTab.BIRTHDAYS
            return serverWishes?.get(tab) ?: HrGenieContent.wishes(tab)
        }

    fun setWishes(groups: Map<WishTab, WishGroup>) {
        serverWishes = groups
    }

    fun selectWishTab(tab: WishTab) {
        if (_wishTab.value != tab) _wishTab.value = tab
    }
}
