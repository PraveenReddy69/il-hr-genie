package com.infinitylearn.hrgenie

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.annotation.ColorRes
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updateLayoutParams
import androidx.navigation.NavController
import androidx.navigation.NavOptions
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.ui.setupWithNavController
import com.infinitylearn.hrgenie.push.PushRegistration
import com.infinitylearn.hrgenie.ui.common.navigateSafely
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.TicketStore
import com.infinitylearn.hrgenie.databinding.ActivityMainBinding
import com.infinitylearn.hrgenie.push.PushTokenStore
import com.infinitylearn.hrgenie.push.TicketNotifications
import com.infinitylearn.hrgenie.ui.common.SessionViewModel

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private var isBottomNavWired = false

    private val session: SessionViewModel by viewModels()

    private lateinit var navController: NavController

    /**
     * Asked for once we are past sign-in. Refusing it only costs the banner — ticket
     * updates still land in chat and on My tickets.
     */
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            android.widget.Toast
                .makeText(this, R.string.notifications_denied, android.widget.Toast.LENGTH_LONG)
                .show()
        }
    }

    /** Screens that own the full height and hide the bottom navigation. */
    private val chromeFreeDestinations = setOf(
        R.id.signInFragment,
        R.id.chatFragment,
        R.id.holidaysFragment,
        // The HRBP dashboard is the entire HR app — no tabs under it.
        R.id.insightsFragment,
        R.id.ticketsFragment,
        R.id.trendsFragment,
    )

    /**
     * Screens the chat shortcut stays off: the chrome-free ones, plus focused flows
     * whose own primary action sits exactly where the button would land.
     */
    private val fabFreeDestinations = chromeFreeDestinations + setOf(
        R.id.moodFragment,
        R.id.pulseFragment,
        R.id.attendanceHistoryFragment,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        navController = (supportFragmentManager
            .findFragmentById(R.id.navHost) as NavHostFragment).navController

        // Null once the token has expired, which sends the user back to sign in
        // rather than into an app whose every call would be rejected.
        val remembered = SessionStore(this).remembered()

        // Rehydrate the session on every create, not just cold starts. The picker and
        // cropper are separate activities, so the process can be killed behind them —
        // coming back with an empty session left Home with no name, avatar or card.
        if (remembered != null && session.signedInEmployee == null) {
            session.signIn(remembered.employee, keepSignedIn = true, token = remembered.token)
        }

        // Catches installs that were signed in before push registration worked. It
        // does nothing once the token has been accepted for this employee.
        if (remembered != null) {
            PushRegistration.pair(this, remembered.employee.employeeId, remembered.token)
        }

        // Navigating is cold-start only: after a recreate the NavController restores
        // its own back stack and must not be re-pointed at Home.
        if (savedInstanceState == null && remembered != null) {
            navController.navigateSafely(
                // An HR account restores straight to the dashboard, never into the
                // employee app.
                if (remembered.employee.isHr) R.id.insightsFragment else R.id.mainGraph,
                null,
                NavOptions.Builder()
                    .setPopUpTo(R.id.signInFragment, /* inclusive = */ true)
                    .build(),
            )
        }

        sizeStatusScrim()

        binding.chatFab.setOnClickListener {
            navController.navigateSafely(R.id.chatFragment)
        }

        navController.addOnDestinationChangedListener { _, destination, _ ->
            // Chat is one of the chrome-free screens, so the shortcut hides itself
            // there along with the bottom bar.
            val chromeFree = destination.id in chromeFreeDestinations
            binding.navContainer.visibility = if (chromeFree) View.GONE else View.VISIBLE
            val fabVisible = destination.id !in fabFreeDestinations
            binding.chatFab.visibility = if (fabVisible) View.VISIBLE else View.GONE
            refreshChatBadge(fabVisible)
            wireBottomNavOnce(navController, destination.id)
        }

        // The token is minted per install, so it is fetched whether or not anyone is
        // signed in yet; pairing it to an employee happens at sign-in.
        PushTokenStore(this).refresh()
        askForNotificationsIfSignedIn()

        // A cold start from a notification arrives on the launch intent.
        openTicketFrom(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openTicketFrom(intent)
    }

    /**
     * Routes a notification tap to the ticket it is about.
     *
     * Employees land on My tickets with that row expanded. An HR account gets the
     * queue instead — the same push would otherwise open a screen they do not have.
     */
    private fun openTicketFrom(intent: Intent?) {
        // Two shapes reach us. Our own notification uses the namespaced extra; a
        // message that carried a `notification` block is drawn by the system, which
        // copies the raw data keys onto the launch intent instead.
        intent ?: return
        val ticketId = intent.getStringExtra(TicketNotifications.EXTRA_TICKET_ID)
            ?: intent.getStringExtra(FCM_TICKET_ID)
            ?: return
        intent.removeExtra(TicketNotifications.EXTRA_TICKET_ID)
        intent.removeExtra(FCM_TICKET_ID)

        val employee = session.signedInEmployee ?: return
        if (employee.isHr) {
            navController.navigateSafely(R.id.ticketsFragment)
            return
        }
        navController.navigateSafely(
            R.id.myTicketsFragment,
            bundleOf(ARG_TICKET_ID to ticketId),
        )
    }

    private fun askForNotificationsIfSignedIn() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (session.signedInEmployee == null) return

        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    companion object {
        /** Argument My tickets reads to open one row expanded. */
        const val ARG_TICKET_ID = "ticketId"

        /** The raw data key FCM copies onto the intent for system-drawn messages. */
        private const val FCM_TICKET_ID = "ticketId"
    }

    /**
     * Marks the chat button when HR has moved one of this employee's tickets since
     * they last looked — otherwise the update would sit unseen inside the transcript.
     */
    private fun refreshChatBadge(fabVisible: Boolean) {
        val employee = session.signedInEmployee
        val unread = fabVisible && employee != null && !employee.isHr &&
            TicketStore(this).unseenUpdates(employee.employeeId).isNotEmpty()
        binding.chatFabBadge.visibility = if (unread) View.VISIBLE else View.GONE
    }

    /**
     * Sign in is deliberately absent from the bottom-nav menu, so NavigationUI has no
     * item to match and the menu's default-checked entry (Home) can steal the very
     * first navigation. Wiring only once we are past Sign in keeps that from
     * bypassing the login screen.
     */
    private fun wireBottomNavOnce(navController: NavController, destinationId: Int) {
        // Same trap on the HR dashboard, which is also outside the menu.
        if (isBottomNavWired ||
            destinationId == R.id.signInFragment ||
            destinationId == R.id.insightsFragment ||
            destinationId == R.id.ticketsFragment ||
            destinationId == R.id.trendsFragment
        ) {
            return
        }
        isBottomNavWired = true
        binding.bottomNav.setupWithNavController(navController)
    }

    private fun sizeStatusScrim() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.statusScrim) { view, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
            view.updateLayoutParams { height = top }
            insets
        }
        ViewCompat.requestApplyInsets(binding.statusScrim)
    }

    /**
     * Paints the status-bar strip to match whatever the current screen puts at its
     * top edge, and flips the system icons to suit. Called by each fragment.
     */
    fun setStatusScrim(@ColorRes color: Int, lightIcons: Boolean) {
        binding.statusScrim.setBackgroundColor(ContextCompat.getColor(this, color))
        WindowInsetsControllerCompat(window, window.decorView)
            .isAppearanceLightStatusBars = !lightIcons
    }
}
