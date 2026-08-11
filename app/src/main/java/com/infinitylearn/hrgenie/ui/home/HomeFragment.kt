package com.infinitylearn.hrgenie.ui.home

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.PopupWindow
import androidx.annotation.VisibleForTesting
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.fragment.app.viewModels
import androidx.navigation.NavOptions
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import com.infinitylearn.hrgenie.MainActivity
import com.infinitylearn.hrgenie.push.PushRegistration
import com.infinitylearn.hrgenie.ui.common.navigateSafely
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.AttendanceRepository
import com.infinitylearn.hrgenie.data.WishPerson
import com.infinitylearn.hrgenie.data.WishGroup
import com.infinitylearn.hrgenie.data.Employees
import com.infinitylearn.hrgenie.data.Celebration
import com.infinitylearn.hrgenie.data.MoodRepository
import com.infinitylearn.hrgenie.data.PulseRepository
import com.infinitylearn.hrgenie.data.weekDates
import com.infinitylearn.hrgenie.data.AttendanceStore
import com.infinitylearn.hrgenie.data.HrGenieContent
import com.infinitylearn.hrgenie.data.Mood
import com.infinitylearn.hrgenie.data.MoodStore
import com.infinitylearn.hrgenie.data.PhotoStore
import com.infinitylearn.hrgenie.data.PulseStore
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.WishTab
import com.infinitylearn.hrgenie.databinding.FragmentHomeBinding
import com.infinitylearn.hrgenie.databinding.ItemHolidayRowBinding
import com.infinitylearn.hrgenie.databinding.ItemMoodCellBinding
import com.infinitylearn.hrgenie.databinding.ItemWishBinding
import com.infinitylearn.hrgenie.databinding.ViewProfileMenuBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.bindAvatar
import com.infinitylearn.hrgenie.ui.common.dp
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import com.infinitylearn.hrgenie.ui.common.authToken
import kotlinx.coroutines.launch

class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!

    private val viewModel: HomeViewModel by viewModels()
    private val session: SessionViewModel by activityViewModels()

    private val photos: PhotoStore by lazy { PhotoStore(requireContext().applicationContext) }
    private val moods: MoodStore by lazy { MoodStore(requireContext().applicationContext) }
    private val pulses: PulseStore by lazy { PulseStore(requireContext().applicationContext) }

    private var attendance: AttendanceCard? = null

    /** Wish tabs the user has expanded, so the choice survives a tab switch. */
    private val expandedWishTabs = mutableSetOf<WishTab>()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    private var askedThisSession = false

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.headerContent.applyTopInsetPadding()
        binding.content.playScreenEntrance()

        // Keeps the elevation shadow following the card's rounded corners.
        // (android:clipToOutline is API 31+; minSdk is 24.)
        binding.wishesCard.clipToOutline = true
        binding.holidaysCard.clipToOutline = true

        bindSignedInEmployee()
        renderMoodCard()
        renderPulseNudge()
        bindAttendance()
        bindMoodGrid()
        bindWishes()
        bindHolidays()
        bindCtas()
    }

    // ----------------------------------------------------------- signed-in header

    private fun bindSignedInEmployee() {
        val employee = session.signedInEmployee ?: return
        binding.greeting.text = getString(R.string.home_greeting, employee.firstName)
        employee.bindAvatar(binding.avatarPhoto, binding.avatarIcon, photos)
        binding.wishesDateBand.text =
            getString(R.string.wishes_today, HrGenieContent.todayShort)
        binding.subline.text = getString(
            R.string.home_subline,
            HrGenieContent.todayLabel,
            employee.tenureDays(HrGenieContent.todayIso),
        )
    }

    // ----------------------------------------------------------------- attendance

    private fun bindAttendance() {
        val employee = session.signedInEmployee ?: return
        val store = AttendanceStore(requireContext().applicationContext)
        attendance = AttendanceCard(
            binding = binding.attendance,
            store = store,
            repository = AttendanceRepository(requireContext(), authToken(session)),
            scope = viewLifecycleOwner.lifecycleScope,
            onMessage = { message ->
                Snackbar.make(binding.root, message, Snackbar.LENGTH_SHORT).show()
            },
        ).also { it.bind(employee.employeeId) }
    }

    /** The check-in is a once-a-day ask; hide it once it has been answered. */
    /**
     * Pulls today's records back from the server.
     *
     * Everything here can change on another device — HR resolves a ticket, the
     * employee checks in from a second phone — so the cards are redrawn from whatever
     * came back. Failures are silent: the cached view is still shown, and the network
     * banner belongs on the screens that own that data.
     */
    private fun refreshFromServer() {
        val employee = session.signedInEmployee ?: return
        val token = authToken(session)
        val today = HrGenieContent.todayIso
        viewLifecycleOwner.lifecycleScope.launch {
            MoodRepository(requireContext(), token).refresh(employee.employeeId, today)
            PulseRepository(requireContext(), token)
                .refresh(employee.employeeId, HrGenieContent.currentCycle)
            val week = weekDates(today)
            AttendanceRepository(requireContext(), token)
                .refresh(employee.employeeId, week.first(), week.last())
            if (_binding == null) return@launch
            renderMoodCard()
            renderPulseNudge()
            attendance?.start()

            Employees.gateway(token).celebrations().onSuccess { celebrations ->
                if (_binding == null || celebrations.isEmpty()) return@onSuccess
                viewModel.setWishes(celebrations.toWishGroups())
                renderWishList()
            }
        }
    }

    /**
     * Turns the HRMS's celebrations into the card's three tabs.
     *
     * Only the first few are listed; the rest become the "+N more" count, which is how
     * the card was designed and why the whole set is fetched rather than a page of it.
     */
    private fun Collection<Celebration>.toWishGroups(): Map<WishTab, WishGroup> {
        val byKind = groupBy { it.kind }
        return WishTab.entries.associateWith { tab ->
            val kind = when (tab) {
                WishTab.BIRTHDAYS -> Celebration.Kind.BIRTHDAY
                WishTab.ANNIVERSARY -> Celebration.Kind.ANNIVERSARY
                WishTab.NEW_JOINERS -> Celebration.Kind.NEW_JOINER
            }
            val all = byKind[kind].orEmpty()
            WishGroup(
                tab = tab,
                // Everyone is carried; the card decides how many to show so that
                // "+N more" has something to expand into.
                more = 0,
                people = all.mapIndexed { index, celebration ->
                    WishPerson(
                        name = celebration.employee.name,
                        meta = metaFor(celebration),
                        colorRes = AVATAR_COLORS[index % AVATAR_COLORS.size],
                    )
                },
            )
        }
    }

    private fun metaFor(celebration: Celebration): String = when (celebration.kind) {
        // Years is the point of an anniversary; for the rest, where they sit is.
        Celebration.Kind.ANNIVERSARY -> resources.getQuantityString(
            R.plurals.wish_years, celebration.years, celebration.years,
        )
        else -> celebration.employee.team.ifBlank { celebration.employee.title }
    }

    private fun renderMoodCard() {
        val employee = session.signedInEmployee ?: return
        val answered = moods.hasCheckedIn(employee.employeeId, HrGenieContent.todayIso)
        binding.moodCard.visibility = if (answered) View.GONE else View.VISIBLE
    }

    /** Same for the pulse, which is a once-a-month ask. */
    private fun renderPulseNudge() {
        val employee = session.signedInEmployee ?: return
        val answered = pulses.hasCompleted(employee.employeeId, HrGenieContent.currentCycle)
        binding.pulseNudge.visibility = if (answered) View.GONE else View.VISIBLE
        binding.pulseNudgeTitle.text =
            getString(R.string.pulse_nudge_title, HrGenieContent.currentMonthName)
    }

    // ------------------------------------------------------------------ mood grid

    private fun bindMoodGrid() {
        val grid = binding.moodGrid
        grid.removeAllViews()
        HrGenieContent.MOODS.forEachIndexed { index, mood ->
            val cell = ItemMoodCellBinding.inflate(layoutInflater, grid, false)
            cell.moodEmoji.text = mood.emoji
            cell.moodLabel.text = mood.label
            cell.root.setOnClickListener { openCheckIn(mood) }

            val params = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            if (index > 0) params.marginStart = 8.dp(grid)
            grid.addView(cell.root, params)
        }
    }

    /** Tapping a face jumps straight to step 1 of the check-in with that mood held. */
    private fun openCheckIn(mood: Mood) {
        val args = Bundle().apply { putString("moodKey", mood.key.name) }
        findNavController().navigateSafely(R.id.action_home_to_mood, args)
    }

    // --------------------------------------------------------------------- wishes

    private fun bindWishes() {
        val tabs = binding.wishTabs
        tabs.removeAllTabs()
        WishTab.entries.forEach { tab -> tabs.addTab(tabs.newTab().setText(tab.title)) }

        tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                viewModel.selectWishTab(WishTab.entries[tab.position])
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })

        viewModel.wishTab.observe(viewLifecycleOwner) { renderWishList() }
    }

    /**
     * The people on the selected tab.
     *
     * The group now carries everyone, and this decides how many to show — which is
     * what makes "+N more" able to expand. A tab with nobody on it says so rather
     * than collapsing the card to a bare strip of tabs.
     */
    private fun renderWishList() {
        val group = viewModel.currentWishes
        val list = binding.wishList
        list.removeAllViews()

        if (group.people.isEmpty()) {
            list.addView(emptyWishNotice(list, group.tab))
            binding.wishesDivider.visibility = View.GONE
            binding.wishesMore.visibility = View.GONE
            binding.wishesCount.text = "0"
            return
        }

        val expanded = group.tab in expandedWishTabs
        val shown = if (expanded) group.people else group.people.take(WISHES_SHOWN)
        val hidden = group.people.size - shown.size

        shown.forEachIndexed { index, person ->
            val row = ItemWishBinding.inflate(layoutInflater, list, false)
            row.wishName.text = person.name
            row.wishMeta.text = person.meta
            row.wishAvatar.text = person.initial
            tintCircle(row.wishAvatar, ContextCompat.getColor(requireContext(), person.colorRes))
            row.wishAction.text = group.tab.actionEmoji
            row.wishAction.setOnClickListener {
                Snackbar.make(
                    binding.root,
                    getString(R.string.wish_sent, person.name),
                    Snackbar.LENGTH_SHORT,
                ).show()
            }
            list.addView(row.root)

            if (index < shown.lastIndex) list.addView(hairline(list))
        }

        // Nothing hidden and nothing expanded means there is nothing to say.
        val canToggle = hidden > 0 || expanded
        binding.wishesDivider.visibility = if (canToggle) View.VISIBLE else View.GONE
        binding.wishesMore.visibility = if (canToggle) View.VISIBLE else View.GONE
        binding.wishesMore.text =
            if (expanded) getString(R.string.wishes_less) else getString(R.string.wishes_more, hidden)
        binding.wishesMore.setOnClickListener {
            if (!expandedWishTabs.remove(group.tab)) expandedWishTabs += group.tab
            renderWishList()
        }

        // The band count follows the selected tab, so it always matches the list.
        binding.wishesCount.text = group.people.size.toString()
    }

    /** Shown when a tab has nobody on it — an empty card reads as a broken one. */
    private fun emptyWishNotice(parent: ViewGroup, tab: WishTab): View =
        TextView(requireContext()).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = 10.dp(parent)
                bottomMargin = 14.dp(parent)
            }
            gravity = android.view.Gravity.CENTER
            setText(
                when (tab) {
                    WishTab.BIRTHDAYS -> R.string.wishes_empty_birthdays
                    WishTab.ANNIVERSARY -> R.string.wishes_empty_anniversaries
                    WishTab.NEW_JOINERS -> R.string.wishes_empty_joiners
                },
            )
            setTextColor(ContextCompat.getColor(requireContext(), R.color.text_muted))
            textSize = 12.5f
        }

    /** A soft top-lit gradient reads richer than a flat disc at this size. */
    private fun tintCircle(view: View, color: Int) {
        val shape = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(lighten(color, 0.22f), color),
        ).apply { shape = GradientDrawable.OVAL }
        view.background = shape
    }

    private fun lighten(color: Int, amount: Float): Int = Color.rgb(
        Color.red(color) + ((255 - Color.red(color)) * amount).toInt(),
        Color.green(color) + ((255 - Color.green(color)) * amount).toInt(),
        Color.blue(color) + ((255 - Color.blue(color)) * amount).toInt(),
    )

    private fun hairline(parent: ViewGroup): View = View(requireContext()).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            1.dp(parent).coerceAtLeast(1),
        )
        setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.ink_05))
    }

    // ------------------------------------------------------------------- holidays

    private fun bindHolidays() {
        val today = HrGenieContent.todayIso
        val remaining = HrGenieContent.HOLIDAYS.count { !it.isPast(today) }
        binding.holidaysRemaining.text = getString(
            R.string.holidays_remaining_short,
            remaining,
            today.take(4).toIntOrNull() ?: 0,
        )

        val list = binding.holidayList
        list.removeAllViews()
        viewModel.nextHolidays.forEachIndexed { index, holiday ->
            val row = ItemHolidayRowBinding.inflate(layoutInflater, list, false)
            row.holidayDay.text = holiday.dayNumber
            row.holidayMonth.text = holiday.monthShort
            row.holidayName.text = holiday.name
            row.holidayDate.text = holiday.weekdayLabel
            row.holidayCountdown.text = countdownLabel(holiday.daysUntil(today))
            list.addView(row.root)

            if (index < viewModel.nextHolidays.lastIndex) list.addView(dashedRule(list))
        }
    }

    private fun countdownLabel(days: Long): String = when {
        days <= 0L -> getString(R.string.holiday_today)
        days == 1L -> getString(R.string.holiday_tomorrow)
        else -> getString(R.string.holiday_in_days, days.toInt())
    }

    private fun dashedRule(parent: ViewGroup): View = View(requireContext()).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            1.dp(parent).coerceAtLeast(1),
        )
        // Dashed strokes need a software layer to render on a hardware canvas.
        setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        background = ContextCompat.getDrawable(requireContext(), R.drawable.divider_dashed)
    }

    // ------------------------------------------------------------------ profile menu

    /** Non-null only while the profile menu is showing; exposed so tests can drive it. */
    @VisibleForTesting
    internal var profileMenu: PopupWindow? = null
        private set

    /** Drops a card under the header avatar with My Profile / Logout. */
    private fun showProfileMenu(anchor: View) {
        val menu = ViewProfileMenuBinding.inflate(layoutInflater)
        val popup = PopupWindow(
            menu.root,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true,
        ).apply {
            // A background is what makes an outside tap dismiss the popup.
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            elevation = 12f * resources.displayMetrics.density
            isOutsideTouchable = true
            setOnDismissListener { profileMenu = null }
        }
        profileMenu = popup

        menu.myProfile.setOnClickListener {
            popup.dismiss()
            findNavController().navigateSafely(R.id.action_home_to_profile)
        }
        menu.logout.setOnClickListener {
            popup.dismiss()
            logOut()
        }

        // Right-align the card with the avatar, 8dp below it.
        popup.showAsDropDown(anchor, 0, 8.dp(anchor), Gravity.END)
    }

    /**
     * The first sight of Home is where the notification prompt belongs.
     *
     * It cannot go in [MainActivity.onCreate]: on a fresh install nobody is signed in
     * at that point, so the ask was skipped and never came back until the next cold
     * start — which is why it was never seen. Guarded so a return to Home does not
     * ask again; a refusal is picked up later by the ticket flow, where there is
     * something concrete to explain.
     */
    private fun askForNotificationsOnce() {
        if (askedThisSession) return
        askedThisSession = true
        (activity as? MainActivity)?.askForNotifications()
    }

    private fun logOut() {
        // Before the session is cleared — the call needs its bearer.
        PushRegistration.unpairOnSignOut(requireContext(), SessionStore(requireContext()).token())
        SessionStore(requireContext()).forget()
        session.signOut()
        val navController = findNavController()
        navController.navigateSafely(
            R.id.signInFragment,
            null,
            NavOptions.Builder()
                .setPopUpTo(navController.graph.id, /* inclusive = */ true)
                .build(),
        )
    }

    // ------------------------------------------------------------------------ CTAs

    private fun bindCtas() {
        binding.avatar.setOnClickListener { showProfileMenu(it) }
        binding.attendance.attendanceWeekLink.setOnClickListener {
            findNavController().navigateSafely(R.id.action_home_to_attendance_history)
        }
        binding.pulseNudge.setOnClickListener {
            findNavController().navigateSafely(R.id.action_home_to_pulse)
        }
        binding.holidaysViewAll.setOnClickListener {
            findNavController().navigateSafely(R.id.action_home_to_holidays)
        }
        binding.wishesViewAll.setOnClickListener {
            Snackbar.make(binding.root, R.string.wishes, Snackbar.LENGTH_SHORT).show()
        }
    }

    override fun onPause() {
        attendance?.stop()
        super.onPause()
    }

    override fun onDestroyView() {
        attendance?.stop()
        attendance = null
        profileMenu?.dismiss()
        profileMenu = null
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        askForNotificationsOnce()
        refreshFromServer()
        applyStatusScrim(R.color.ink, lightIcons = true)
        // Resume the clock, and pick up a day that rolled over while we were away.
        attendance?.start()
        // The photo may have been changed on Profile since we were last shown, and the
        // mood may have been logged.
        session.signedInEmployee?.bindAvatar(binding.avatarPhoto, binding.avatarIcon, photos)
        renderMoodCard()
        renderPulseNudge()
    }

    private companion object {
        /** Rows on the card before the rest roll into "+N more". */
        const val WISHES_SHOWN = 3

        val AVATAR_COLORS = intArrayOf(
            R.color.avatar_orange,
            R.color.avatar_green,
            R.color.avatar_blue,
            R.color.avatar_purple,
        )
    }
}
