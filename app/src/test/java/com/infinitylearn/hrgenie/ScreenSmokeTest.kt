package com.infinitylearn.hrgenie

import android.os.Bundle
import androidx.navigation.NavController
import androidx.navigation.fragment.NavHostFragment
import androidx.test.core.app.ApplicationProvider
import com.infinitylearn.hrgenie.data.AccessRole
import com.infinitylearn.hrgenie.data.Auth
import com.infinitylearn.hrgenie.data.Devices
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.Session
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.Ticket
import com.infinitylearn.hrgenie.data.TicketStatus
import com.infinitylearn.hrgenie.data.TicketStore
import com.infinitylearn.hrgenie.data.Tickets
import com.infinitylearn.hrgenie.data.Attendances
import com.infinitylearn.hrgenie.data.Employees
import com.infinitylearn.hrgenie.data.Moods
import com.infinitylearn.hrgenie.data.Pulses
import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.ui.chat.PromptKind
import com.infinitylearn.hrgenie.ui.common.avatarIconRes
import com.infinitylearn.hrgenie.ui.home.HomeFragment
import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

/**
 * Inflates every destination through the real navigation graph. These are smoke
 * tests: they fail if a layout, drawable, style or binding is broken, which is the
 * class of problem that only shows up at runtime.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h892dp-xhdpi")
class ScreenSmokeTest {

    private val controllers = mutableListOf<ActivityController<MainActivity>>()

    private fun launch(): Pair<MainActivity, NavController> {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        controllers += controller
        val activity = controller.get()
        val host = activity.supportFragmentManager
            .findFragmentById(R.id.navHost) as NavHostFragment
        return activity to host.navController
    }

    /** Activities left alive leak their fragment/nav state into the next test. */
    @After
    fun destroyActivities() {
        controllers.forEach { runCatching { it.destroy() } }
        controllers.clear()
    }

    @Before
    fun clearRememberedSession() {
        SessionStore(ApplicationProvider.getApplicationContext()).forget()
        TicketStore(ApplicationProvider.getApplicationContext()).clear()
        stubAuth()
        stubTickets()
        stubOtherGateways()
    }

    /**
     * Keeps mood, pulse, attendance and directory calls off the network too.
     *
     * Every screen refreshes from the server on resume now, so without this the whole
     * suite would depend on a live backend.
     */
    private fun stubOtherGateways() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        Moods.gateway = { FakeMoodGateway(context) }
        Pulses.gateway = { FakePulseGateway(context) }
        Attendances.gateway = { FakeAttendanceGateway(context) }
        Employees.gateway = { FakeEmployeeGateway() }
        // Sign-in pairs the device for push. Firebase is absent under Robolectric so
        // the callback never fires, but the seam is stubbed regardless — a test must
        // not be one SDK change away from posting to a real server.
        Devices.gateway = { _, _ -> Result.success(Unit) }
    }

    /** Keeps every screen's ticket calls off the network. See [FakeTicketGateway]. */
    private fun stubTickets(): FakeTicketGateway {
        val fake = FakeTicketGateway(ApplicationProvider.getApplicationContext())
        Tickets.gateway = { fake }
        return fake
    }

    /**
     * Signs in without a server.
     *
     * Every screen test starts by signing in, so without this each one would make a
     * real network call. The stub accepts any password and answers from the local
     * directory — these tests are about screens, not about credentials.
     */
    private fun stubAuth(
        result: (String) -> Result<Session> = { employeeId ->
            EmployeeDirectory.find(employeeId)
                ?.let { Result.success(sessionFor(it)) }
                ?: Result.failure(ApiException(ApiFailure.Http(401, "Invalid employee id or password.")))
        },
    ) {
        Auth.gateway = { employeeId, _ -> result(employeeId) }
    }

    /** A session shaped like the one the API returns, including the JWT's `exp`. */
    private fun sessionFor(
        employee: com.infinitylearn.hrgenie.data.Employee,
        expiresAtSeconds: Long = System.currentTimeMillis() / 1000 + 3600,
    ): Session {
        val raw = org.json.JSONObject()
            .put("employeeId", employee.employeeId)
            .put("name", employee.name)
            .put("designation", employee.title)
            .put("department", employee.department)
            .put("gender", employee.gender)
            .put("dateOfJoining", employee.dateOfJoining)
            .put("officialEmail", employee.officialEmail)
            .put("dateOfBirth", employee.dateOfBirth)
            .put("reportees", employee.reportees)
            .put("role", if (employee.isHr) "HR" else "EMPLOYEE")
        return Session(
            employee = com.infinitylearn.hrgenie.data.AuthApi.run { raw.toEmployee() },
            token = jwt(expiresAtSeconds),
            raw = raw.toString(),
        )
    }

    /** Header and signature are never checked by the app; only the payload's `exp` is. */
    private fun jwt(expiresAtSeconds: Long): String {
        val payload = org.json.JSONObject().put("exp", expiresAtSeconds).toString()
        val encoded = android.util.Base64.encodeToString(
            payload.toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or
                android.util.Base64.NO_WRAP,
        )
        return "header.$encoded.signature"
    }

    @After
    fun restoreGateways() {
        stubAuth()
        stubTickets()
        stubOtherGateways()
    }

    private fun idle() = ShadowLooper.idleMainLooper()

    /** Idles past the bot's typing delay, so its reply and any card have landed. */
    private fun settle() {
        ShadowLooper.idleMainLooper(
            com.infinitylearn.hrgenie.data.HrGenieContent.BOT_REPLY_DELAY_MS + 100,
            java.util.concurrent.TimeUnit.MILLISECONDS,
        )
    }

    /**
     * Answers chat without a network round trip. Call right after landing on chat,
     * before anything is sent.
     */
    private fun stubKnowledgeBase(
        activity: MainActivity,
        answer: String = "You have 12 earned leaves left.",
        source: com.infinitylearn.hrgenie.data.KbSource? = null,
    ) {
        allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.chat.ChatFragment>()
            .first()
            .useKnowledgeBase {
                Result.success(
                    com.infinitylearn.hrgenie.data.KbAnswer(answer, listOfNotNull(source))
                )
            }
    }

    /** The bot's most recent reply, read off the transcript rather than the views. */
    private fun lastBotRow(activity: MainActivity): com.infinitylearn.hrgenie.ui.chat.ChatRow.Bot {
        val adapter = activity.findViewById<androidx.recyclerview.widget.RecyclerView>(
            R.id.messageList
        ).adapter as com.infinitylearn.hrgenie.ui.chat.ChatAdapter
        return adapter.currentList.filterIsInstance<
            com.infinitylearn.hrgenie.ui.chat.ChatRow.Bot
            >().last()
    }

    /** Walks the whole fragment tree — nav host, its destination, and their children. */
    private fun allFragments(
        roots: List<androidx.fragment.app.Fragment>,
    ): List<androidx.fragment.app.Fragment> =
        roots + roots.flatMap { allFragments(it.childFragmentManager.fragments) }

    /** Fills the credentials the sign-in form no longer pre-seeds, then submits. */
    private fun submitSignIn(activity: MainActivity, employeeId: String = "HYD609552") {
        activity.findViewById<android.widget.EditText>(R.id.employeeIdInput).setText(employeeId)
        activity.findViewById<android.widget.EditText>(R.id.passwordInput).setText("hunter2")
        activity.findViewById<android.view.View>(R.id.signInButton).performClick()
        idle()
    }

    @Test
    fun `sign in is the start destination and hides the bottom nav`() {
        val (activity, nav) = launch()
        assertEquals(R.id.signInFragment, nav.currentDestination?.id)
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.navContainer).visibility,
        )
    }

    @Test
    fun `signing in lands on home with the bottom nav visible`() {
        val (activity, nav) = launch()
        submitSignIn(activity)

        assertEquals(R.id.homeFragment, nav.currentDestination?.id)
        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.navContainer).visibility,
        )
    }

    @Test
    fun `blank fields are flagged without raising the HR sheet`() {
        val (activity, nav) = launch()
        activity.findViewById<android.widget.EditText>(R.id.employeeIdInput).setText("")
        activity.findViewById<android.widget.EditText>(R.id.passwordInput).setText("")
        activity.findViewById<android.view.View>(R.id.signInButton).performClick()
        idle()

        assertEquals(R.id.signInFragment, nav.currentDestination?.id)
        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.employeeIdError).visibility,
        )
        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.passwordError).visibility,
        )
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.hrHelpScrim).visibility,
        )
    }

    @Test
    fun `every directory employee can sign in, no prefix rule`() {
        // HR ids are covered separately: they land on the dashboard, not Home.
        EmployeeDirectory.WORKFORCE.forEach { employee ->
            // Each iteration starts signed out, otherwise the previous employee's
            // remembered session would open straight on Home.
            SessionStore(ApplicationProvider.getApplicationContext()).forget()
            val (activity, nav) = launch()
            // Lower case too, to prove the lookup normalises.
            submitSignIn(activity, employeeId = employee.employeeId.lowercase(Locale.ROOT))

            assertEquals(
                "${employee.employeeId} should sign in",
                R.id.homeFragment,
                nav.currentDestination?.id,
            )
            assertEquals(
                "Good morning, ${employee.firstName}",
                activity.findViewById<android.widget.TextView>(R.id.greeting).text.toString(),
            )
        }
    }

    @Test
    fun `an HR id lands on the dashboard with no bottom nav or chat button`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "hr000")

        assertEquals(R.id.insightsFragment, nav.currentDestination?.id)
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.navContainer).visibility,
        )
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.chatFab).visibility,
        )
        // Nothing behind the dashboard, so no back affordance either.
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.backButton).visibility,
        )
    }

    @Test
    fun `the dashboard reports the real headcount and no fabricated signals`() {
        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")

        val headcount = EmployeeDirectory.WORKFORCE.size
        assertEquals(
            activity.getString(
                R.string.insights_sub,
                com.infinitylearn.hrgenie.data.HrGenieContent.todayLabel,
                headcount,
            ),
            activity.findViewById<android.widget.TextView>(R.id.insightsSub).text.toString(),
        )
        // Four people is under the cohort minimum, so the attention card explains
        // itself instead of listing anyone.
        assertEquals(
            activity.getString(
                R.string.hr_attention_below_cohort,
                com.infinitylearn.hrgenie.data.HrStats.MIN_COHORT,
                headcount,
            ),
            activity.findViewById<android.widget.TextView>(R.id.attentionBody).text.toString(),
        )
        // Nobody has checked in during a fresh test run.
        assertEquals(
            activity.getString(R.string.kpi_engagement_none),
            activity.findViewById<android.widget.TextView>(R.id.kpiEngagementSub).text.toString(),
        )
    }

    @Test
    fun `chat raises a ticket end to end and it lands on the HR dashboard`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()

        val list = activity.findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.messageList)
        val chipRow = activity.findViewById<android.widget.LinearLayout>(R.id.suggestionRow)

        // 1. "Raise a ticket" -> the bot offers categories.
        chipRow.getChildAt(0).performClick()
        settle()
        val categories = activity.findViewById<android.widget.LinearLayout>(R.id.categoryList)
        assertNotNull("category chips should be offered", categories)

        // 2. Pick one -> the bot asks what happened.
        val firstCategory = com.infinitylearn.hrgenie.data.HrGenieContent.TICKET_CATEGORIES.first()
        (categories.getChildAt(0) as android.view.ViewGroup).getChildAt(0).performClick()
        settle()

        // 3. Describe it -> a draft appears, still unwritten.
        val composer = activity.findViewById<android.widget.EditText>(R.id.composerInput)
        composer.setText("My July payslip is missing from the portal")
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        settle()

        assertEquals(
            "nothing is stored until the draft is confirmed",
            0,
            com.infinitylearn.hrgenie.data.TicketStore(context).all().size,
        )
        assertEquals(
            firstCategory,
            activity.findViewById<android.widget.TextView>(R.id.draftCategory).text.toString(),
        )

        // 4. Confirm -> written to the store, receipt shown in the transcript.
        activity.findViewById<android.view.View>(R.id.raiseTicket).performClick()
        settle()

        val stored = com.infinitylearn.hrgenie.data.TicketStore(context).all()
        assertEquals(1, stored.size)
        assertEquals("EMP3801", stored.first().employeeId)
        assertEquals(firstCategory, stored.first().category)
        assertEquals(
            com.infinitylearn.hrgenie.data.TicketStatus.OPEN,
            stored.first().status,
        )
        assertEquals(
            stored.first().subject,
            activity.findViewById<android.widget.TextView>(R.id.chatTicketSubject).text.toString(),
        )
        assertNotNull(list.adapter)

        // 5. The same ticket is what HR sees.
        val stats = com.infinitylearn.hrgenie.data.HrAnalytics(context).stats()
        assertEquals(1, stats.ticketsOpen)
        assertEquals(stored.first().id, stats.tickets.first().id)
    }

    @Test
    fun `my tickets lists only this employee's, with HR's note behind the chevron`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = com.infinitylearn.hrgenie.data.TicketStore(context)
        val mine = store.raise("EMP3801", "My salary got deducted", "Payroll")
        store.raise("HYD600071", "Laptop will not boot", "IT & access")
        store.updateStatus(
            mine.id,
            com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED,
            comment = "Deduction reversed in the August run.",
            authorId = "HR000",
        )

        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.myTicketsFragment)
        idle()

        // Somebody else's ticket is not on this screen.
        assertEquals(
            activity.getString(R.string.my_tickets_sub, 1, 0),
            activity.findViewById<android.widget.TextView>(R.id.myTicketsSubtitle)
                .text.toString(),
        )
        assertEquals(
            "My salary got deducted",
            activity.findViewById<android.widget.TextView>(R.id.myTicketSubject).text.toString(),
        )

        // HR's note is behind the chevron, collapsed to start.
        val panel = activity.findViewById<android.widget.LinearLayout>(R.id.myTicketActivity)
        assertEquals(android.view.View.GONE, panel.visibility)
        activity.findViewById<android.view.View>(R.id.myTicketHeader).performClick()
        idle()
        assertEquals(android.view.View.VISIBLE, panel.visibility)
        assertEquals(
            "Deduction reversed in the August run.",
            panel.getChildAt(0)
                .findViewById<android.widget.TextView>(R.id.commentText).text.toString(),
        )

        // Seeing it here counts as seen, so chat has nothing left to announce.
        assertEquals(0, store.unseenUpdates("EMP3801").size)
    }

    @Test
    fun `a knowledge base answer is rendered with its source`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()

        stubKnowledgeBase(
            activity,
            answer = "The types are:\n\n- **Fixed Holidays**: 8 paid days.\n- **Optional Holidays**: 0/1/2 a year.",
            source = com.infinitylearn.hrgenie.data.KbSource(
                documentTitle = "Leave_Policy_1786077681487.pdf",
                sourceUri = "https://example.invalid/Leave_Policy.pdf",
                score = 0.59,
            ),
        )

        activity.findViewById<android.widget.EditText>(R.id.composerInput)
            .setText("What are the different types of leaves?")
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        idle()
        settle()

        val reply = lastBotRow(activity)

        // Markdown is rendered, not shown raw: bullets become glyphs, ** disappears.
        val rendered = com.infinitylearn.hrgenie.ui.common.renderAnswer(reply.text).toString()
        assertTrue("bullets should render, was: $rendered", rendered.contains("•  Fixed Holidays"))
        assertFalse("asterisks should not survive, was: $rendered", rendered.contains("**"))

        // The document is credited, with the timestamp stripped off its name.
        assertEquals("Leave Policy", reply.source?.displayTitle)
    }

    @Test
    fun `a knowledge base failure says so rather than inventing an answer`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()

        allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.chat.ChatFragment>()
            .first()
            .useKnowledgeBase { Result.failure(java.io.IOException("tunnel down")) }

        val question = com.infinitylearn.hrgenie.data.HrGenieContent.SUGGESTIONS.first()
        activity.findViewById<android.widget.EditText>(R.id.composerInput)
            .setText(question.question)
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        idle()
        settle()

        // No suggestion carries a seeded answer any more — guessing at policy would be
        // worse than admitting the service is down — so the reply must say what
        // happened, must not be dressed up as an answer, and must offer a retry.
        val reply = lastBotRow(activity)
        assertNull("a failure must not be attributed to a policy document", reply.source)
        assertFalse(
            "with nothing seeded, this is a failure notice rather than a stand-in answer",
            reply.isOffline,
        )
        assertTrue(
            "the reply should name the failure, not answer the question",
            reply.text.contains("couldn't", ignoreCase = true) ||
                reply.text.contains("cannot", ignoreCase = true) ||
                reply.text.contains("can't", ignoreCase = true) ||
                reply.text.contains("reach", ignoreCase = true),
        )
        assertTrue("a recovery card should be offered", hasPrompt(activity, PromptKind.RECOVERY))
    }

    @Test
    fun `no suggestion ships a hard-coded policy answer`() {
        // The chips ask about notice periods, F&F and encashment caps. A stand-in
        // answer for any of those is invented company policy, and an employee acting
        // on it could be materially out of pocket.
        com.infinitylearn.hrgenie.data.HrGenieContent.SUGGESTIONS.forEach { suggestion ->
            assertEquals(
                "${suggestion.question} must have no seeded answer",
                null,
                com.infinitylearn.hrgenie.data.HrGenieContent.seededAnswer(suggestion.question),
            )
        }
    }

    @Test
    fun `an unhelpful answer leads to a ticket prefilled with the question`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()
        stubKnowledgeBase(activity, answer = "Leave accrues monthly.")

        val chat = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.chat.ChatFragment>()
            .first()

        // Ask something, get an answer, and be asked whether it landed.
        activity.findViewById<android.widget.EditText>(R.id.composerInput)
            .setText("Why was my leave balance reset?")
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        idle()
        settle()
        assertTrue("feedback should follow an answer", hasPrompt(activity, PromptKind.FEEDBACK))

        // "Not really" offers to raise it instead of dead-ending.
        chat.promptForTest(PromptKind.FEEDBACK, primary = false)
        idle()
        assertTrue(hasPrompt(activity, PromptKind.TICKET_OFFER))

        // Accepting jumps straight to categories — the subject is already known.
        chat.promptForTest(PromptKind.TICKET_OFFER, primary = true)
        idle()
        settle()
        val categories = activity.findViewById<android.widget.LinearLayout>(R.id.categoryList)
        assertNotNull("categories should be offered", categories)

        // Picking one skips the "describe it" step and goes to the review card,
        // carrying the original question as the subject.
        (categories.getChildAt(0) as android.view.ViewGroup).getChildAt(0).performClick()
        settle()
        assertEquals(
            "Why was my leave balance reset?",
            activity.findViewById<android.widget.TextView>(R.id.draftSubject).text.toString(),
        )

        activity.findViewById<android.view.View>(R.id.raiseTicket).performClick()
        settle()
        assertEquals(
            "Why was my leave balance reset?",
            com.infinitylearn.hrgenie.data.TicketStore(context).all().first().subject,
        )
    }

    @Test
    fun `a typed answer is not read aloud, a spoken one is offered up`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()
        stubKnowledgeBase(activity, answer = "You have 12 earned leaves left.")

        val chat = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.chat.ChatFragment>()
            .first()

        // Typed: nothing is queued for reading out.
        activity.findViewById<android.widget.EditText>(R.id.composerInput)
            .setText("How many leaves do I have?")
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        idle()
        settle()
        assertNull(
            "a typed question must not start the app talking",
            chat.spokenAnswerForTest(),
        )

        // Dictated: the same answer is offered up to be spoken.
        chat.sendByVoiceForTest("How many leaves do I have?")
        idle()
        settle()
        assertEquals("You have 12 earned leaves left.", chat.spokenAnswerForTest())
    }

    @Test
    fun `a helpful answer closes the loop without offering a ticket`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()
        stubKnowledgeBase(activity)

        val chat = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.chat.ChatFragment>()
            .first()

        activity.findViewById<android.widget.EditText>(R.id.composerInput)
            .setText("How many leaves do I have?")
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        idle()
        settle()

        chat.promptForTest(PromptKind.FEEDBACK, primary = true)
        idle()
        settle()

        assertEquals(
            com.infinitylearn.hrgenie.data.HrGenieContent.FEEDBACK_THANKS,
            lastBotRow(activity).text,
        )
        assertFalse(hasPrompt(activity, PromptKind.FEEDBACK))
        assertFalse(hasPrompt(activity, PromptKind.TICKET_OFFER))
    }

    @Test
    fun `a dead endpoint says so instead of inventing an answer`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()

        val chat = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.chat.ChatFragment>()
            .first()
        chat.useKnowledgeBase {
            Result.failure(
                com.infinitylearn.hrgenie.data.KbException(
                    com.infinitylearn.hrgenie.data.KbFailure.Unreachable("connection reset")
                )
            )
        }

        // A question with no seeded answer, so there is nothing to fall back to.
        activity.findViewById<android.widget.EditText>(R.id.composerInput)
            .setText("What is the notice period for a transfer?")
        activity.findViewById<android.view.View>(R.id.micButton).performClick()
        idle()
        settle()

        val reply = lastBotRow(activity)
        assertEquals(
            com.infinitylearn.hrgenie.data.HrGenieContent.kbFailureMessage(
                com.infinitylearn.hrgenie.data.KbFailure.Unreachable("connection reset")
            ),
            reply.text,
        )
        assertTrue("a recovery card should be offered", hasPrompt(activity, PromptKind.RECOVERY))

        // Retrying re-asks the same question without the employee retyping it.
        chat.useKnowledgeBase {
            Result.success(
                com.infinitylearn.hrgenie.data.KbAnswer("Thirty days.", emptyList())
            )
        }
        chat.promptForTest(PromptKind.RECOVERY, primary = true)
        idle()
        settle()

        assertEquals("Thirty days.", lastBotRow(activity).text)
        assertFalse(
            "the recovery card clears once it works",
            hasPrompt(activity, PromptKind.RECOVERY),
        )
    }

    private fun hasPrompt(activity: MainActivity, kind: PromptKind): Boolean {
        val adapter = activity.findViewById<androidx.recyclerview.widget.RecyclerView>(
            R.id.messageList
        ).adapter as com.infinitylearn.hrgenie.ui.chat.ChatAdapter
        return adapter.currentList.any {
            it is com.infinitylearn.hrgenie.ui.chat.ChatRow.Prompt && it.kind == kind
        }
    }

    @Test
    fun `the composer button becomes send once something is typed`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()

        stubKnowledgeBase(activity)
        val button = activity.findViewById<android.widget.ImageView>(R.id.micButton)
        val composer = activity.findViewById<android.widget.EditText>(R.id.composerInput)

        // Empty field: still the mic, and tapping it sends nothing.
        assertEquals(activity.getString(R.string.cd_voice_input), button.contentDescription)
        val before = activity.findViewById<androidx.recyclerview.widget.RecyclerView>(
            R.id.messageList
        ).adapter?.itemCount
        button.performClick()
        idle()
        assertEquals(
            before,
            activity.findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.messageList)
                .adapter?.itemCount,
        )

        // Typing flips it to send.
        composer.setText("Where is my payslip?")
        idle()
        assertEquals(activity.getString(R.string.cd_send), button.contentDescription)

        button.performClick()
        idle()
        assertEquals("", composer.text.toString())
        // Back to the mic once the field is cleared.
        assertEquals(activity.getString(R.string.cd_voice_input), button.contentDescription)
    }

    @Test
    fun `my tickets says so when the employee has raised nothing`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.myTicketsFragment)
        idle()

        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.myTicketsEmpty).visibility,
        )
        assertEquals(
            activity.getString(R.string.my_tickets_empty_title),
            activity.findViewById<android.widget.TextView>(R.id.myTicketsEmptyTitle)
                .text.toString(),
        )
        // No filter row over an empty list.
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.myTicketFilterScroller).visibility,
        )
    }

    @Test
    fun `chat announces a status change HR made while the employee was away`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = com.infinitylearn.hrgenie.data.TicketStore(context)
        val raised = store.raise("EMP3801", "Payslip for July is missing", "Payroll")
        // Raising it counts as seen — the employee watched it happen.
        assertEquals(0, store.unseenUpdates("EMP3801").size)

        store.updateStatus(raised.id, com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS)
        assertEquals(1, store.unseenUpdates("EMP3801").size)

        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")

        // The chat button is marked before the employee opens it.
        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.chatFabBadge).visibility,
        )

        nav.navigate(R.id.action_home_to_chat)
        idle()
        settle()

        // Announced in the transcript, with the ticket at its new status.
        assertEquals(
            com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS.label,
            activity.findViewById<android.widget.TextView>(R.id.chatTicketStatus).text.toString(),
        )
        // Reported once: reopening chat has nothing left to say.
        assertEquals(0, store.unseenUpdates("EMP3801").size)

        nav.popBackStack()
        idle()
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.chatFabBadge).visibility,
        )
    }

    @Test
    fun `my tickets says so when nothing has been raised`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_chat)
        idle()

        activity.findViewById<android.widget.LinearLayout>(R.id.suggestionRow)
            .getChildAt(1).performClick()
        settle()

        // No ticket card, just the bot saying there is nothing.
        assertNull(activity.findViewById<android.view.View>(R.id.ticketCardList))
    }

    @Test
    fun `tapping the mood card opens the people behind the figure`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        com.infinitylearn.hrgenie.data.MoodStore(context).save(
            employeeId = "EMP3801",
            dateIso = com.infinitylearn.hrgenie.data.HrGenieContent.todayIso,
            mood = com.infinitylearn.hrgenie.data.MoodKey.OKAY,
            reasons = setOf("Workload"),
            note = "",
        )

        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")
        activity.findViewById<android.view.View>(R.id.moodCard).performClick()
        idle()

        // The sheet is a child of the fragment, which is itself inside the nav host.
        val sheet = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.insights.HrDetailSheet>()
            .firstOrNull()
        assertNotNull("mood card should open the detail sheet", sheet)

        val root = sheet!!.requireView()
        assertEquals(
            activity.getString(R.string.hr_detail_mood),
            root.findViewById<android.widget.TextView>(R.id.sheetTitle).text.toString(),
        )
        // The person who shared is named, with the mood they picked.
        val list = root.findViewById<android.widget.LinearLayout>(R.id.sheetList)
        val firstName = list.getChildAt(0).findViewById<android.widget.TextView>(R.id.personName)
        val firstValue = list.getChildAt(0).findViewById<android.widget.TextView>(R.id.personValue)
        assertEquals("Gunapati Praveen Reddy", firstName.text.toString())
        assertEquals("😐 Okay", firstValue.text.toString())
    }

    @Test
    fun `expanding a pulse row shows what that employee answered`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val questions = com.infinitylearn.hrgenie.data.HrGenieContent.PULSE_QUESTIONS
        com.infinitylearn.hrgenie.data.PulseStore(context).save(
            employeeId = "EMP3801",
            cycle = com.infinitylearn.hrgenie.data.HrGenieContent.currentCycle,
            // Everything but the last question, so "Skipped" is covered too.
            answers = questions.dropLast(1).associate { it.id to it.options.first() },
            completedAtMillis = 1_754_500_000_000L,
        )

        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")
        activity.findViewById<android.view.View>(R.id.kpiPulseTile).performClick()
        idle()

        val sheet = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.insights.HrDetailSheet>()
            .first()
        val list = sheet.requireView().findViewById<android.widget.LinearLayout>(R.id.sheetList)
        val row = list.getChildAt(0)

        // Collapsed until the row is tapped.
        val panel = row.findViewById<android.widget.LinearLayout>(R.id.personBreakdown)
        assertEquals(android.view.View.GONE, panel.visibility)

        row.findViewById<android.view.View>(R.id.personHeader).performClick()
        idle()
        assertEquals(android.view.View.VISIBLE, panel.visibility)

        // One block per question, with the answer as given.
        val firstAnswer = panel.getChildAt(0)
        assertEquals(
            questions.first().text,
            firstAnswer.findViewById<android.widget.TextView>(R.id.answerQuestion).text.toString(),
        )
        assertEquals(
            questions.first().options.first(),
            firstAnswer.findViewById<android.widget.TextView>(R.id.answerValue).text.toString(),
        )
    }

    @Test
    fun `HR moves a ticket on, and resolving is refused without a note`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = com.infinitylearn.hrgenie.data.TicketStore(context)
        val raised = store.raise("EMP3801", "Payslip for July is missing", "Payroll")

        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")

        activity.findViewById<android.widget.LinearLayout>(R.id.ticketList)
            .getChildAt(0).performClick()
        idle()

        val sheet = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.insights.HrTicketSheet>()
            .firstOrNull()
        assertNotNull("the ticket row should open the status sheet", sheet)

        val view = sheet!!.requireView()
        val options = view.findViewById<android.widget.LinearLayout>(R.id.statusOptions)
        // Open is the current status, so it is marked and inert.
        assertEquals(
            android.view.View.VISIBLE,
            options.getChildAt(0).findViewById<android.view.View>(R.id.statusCurrent).visibility,
        )

        // Resolved with no note is refused, and nothing is written.
        options.getChildAt(2).performClick()
        idle()
        view.findViewById<android.view.View>(R.id.applyUpdate).performClick()
        idle()
        assertEquals(
            android.view.View.VISIBLE,
            view.findViewById<android.view.View>(R.id.commentError).visibility,
        )
        assertEquals(
            com.infinitylearn.hrgenie.data.TicketStatus.OPEN,
            store.all().first { it.id == raised.id }.status,
        )

        // With a note it goes through, and the note is kept against the status.
        view.findViewById<android.widget.EditText>(R.id.commentInput)
            .setText("Payslip regenerated and emailed.")
        view.findViewById<android.view.View>(R.id.applyUpdate).performClick()
        idle()

        val stored = store.all().first { it.id == raised.id }
        assertEquals(com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED, stored.status)
        assertEquals("Payslip regenerated and emailed.", stored.latestComment?.text)
        assertEquals("HR000", stored.latestComment?.authorId)

        // The dashboard card re-reads without waiting for a resume.
        assertEquals(
            com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED.label,
            activity.findViewById<android.widget.TextView>(R.id.ticketStatus).text.toString(),
        )
    }

    @Test
    fun `a resolved ticket opens as an outcome, not a form`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = com.infinitylearn.hrgenie.data.TicketStore(context)
        val raised = store.raise("EMP3801", "My salary got deducted", "Payroll")
        store.updateStatus(
            raised.id,
            com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED,
            comment = "Deduction reversed in the August run.",
            authorId = "HR000",
        )

        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")
        activity.findViewById<android.widget.LinearLayout>(R.id.ticketList)
            .getChildAt(0).performClick()
        idle()

        val view = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.insights.HrTicketSheet>()
            .first().requireView()

        // The outcome leads; the status controls are not offered.
        assertEquals(
            android.view.View.VISIBLE,
            view.findViewById<android.view.View>(R.id.resolvedBanner).visibility,
        )
        assertEquals(
            "Deduction reversed in the August run.",
            view.findViewById<android.widget.TextView>(R.id.resolvedNote).text.toString(),
        )
        assertEquals(
            android.view.View.GONE,
            view.findViewById<android.view.View>(R.id.updateSection).visibility,
        )

        // Reopening is an explicit move, and the button then names it.
        val reopen = view.findViewById<android.view.View>(R.id.reopenButton)
        assertEquals(android.view.View.VISIBLE, reopen.visibility)
        reopen.performClick()
        idle()

        assertEquals(
            android.view.View.VISIBLE,
            view.findViewById<android.view.View>(R.id.updateSection).visibility,
        )
        assertEquals(
            activity.getString(
                R.string.ticket_move_to,
                com.infinitylearn.hrgenie.data.TicketStatus.OPEN.label,
            ),
            view.findViewById<android.widget.TextView>(R.id.applyUpdate).text.toString(),
        )
    }

    @Test
    fun `in progress does not need a note`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = com.infinitylearn.hrgenie.data.TicketStore(context)
        val raised = store.raise("EMP3801", "Laptop will not boot", "IT & access")

        assertTrue(
            store.updateStatus(
                raised.id,
                com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS,
                authorId = "HR000",
            )
        )
        assertEquals(
            com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS,
            store.all().first().status,
        )
        // No note given, so none is recorded.
        assertTrue(store.all().first().comments.isEmpty())

        // The same call for RESOLVED is refused outright.
        assertFalse(
            store.updateStatus(
                raised.id,
                com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED,
                authorId = "HR000",
            )
        )
        assertEquals(
            com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS,
            store.all().first().status,
        )
    }

    @Test
    fun `view all opens the ticket screen with its chart and filters`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = com.infinitylearn.hrgenie.data.TicketStore(context)
        val first = store.raise("EMP3801", "Payslip for July is missing", "Payroll")
        store.raise("HYD600071", "Laptop will not boot", "IT & access")
        val third = store.raise("HYD600902", "Add spouse to insurance", "Insurance")
        store.updateStatus(third.id, com.infinitylearn.hrgenie.data.TicketStatus.RESOLVED, "Added.")
        store.updateStatus(first.id, com.infinitylearn.hrgenie.data.TicketStatus.IN_PROGRESS)

        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HR000")

        // The dashboard card shows the newest two: two rows and the rule between.
        assertEquals(
            3,
            activity.findViewById<android.widget.LinearLayout>(R.id.ticketList).childCount,
        )
        val viewAll = activity.findViewById<android.widget.TextView>(R.id.viewAllTickets)
        assertEquals(android.view.View.VISIBLE, viewAll.visibility)
        assertEquals(activity.getString(R.string.hr_view_all_tickets, 3), viewAll.text.toString())

        viewAll.performClick()
        idle()
        assertEquals(R.id.ticketsFragment, nav.currentDestination?.id)

        // Ring totals everything; the legend names each status and carries counts.
        assertEquals(
            "3",
            activity.findViewById<android.widget.TextView>(R.id.donutTotal).text.toString(),
        )
        val legend = activity.findViewById<android.widget.LinearLayout>(R.id.ticketLegend)
        assertEquals(3, legend.childCount)
        assertEquals(
            listOf("1", "1", "1"),
            (0 until legend.childCount).map { index ->
                legend.getChildAt(index)
                    .findViewById<android.widget.TextView>(R.id.legendValue).text.toString()
            },
        )

        // All four filters, with counts, and the full queue listed.
        val filters = activity.findViewById<android.widget.LinearLayout>(R.id.ticketFilters)
        assertEquals(4, filters.childCount)
        assertEquals(
            activity.getString(R.string.hr_filter_chip, activity.getString(R.string.hr_filter_all), 3),
            (filters.getChildAt(0) as android.widget.TextView).text.toString(),
        )

        // Filtering to Resolved leaves exactly the one that was closed.
        filters.getChildAt(3).performClick()
        idle()
        assertEquals(
            "Add spouse to insurance",
            activity.findViewById<android.widget.TextView>(R.id.ticketSubject).text.toString(),
        )
    }

    @Test
    fun `mood and pulse history charts past days and cycles`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val moods = com.infinitylearn.hrgenie.data.MoodStore(context)
        val today = com.infinitylearn.hrgenie.data.HrGenieContent.todayIso
        val yesterday = shiftDays(today, -1)

        moods.save("EMP3801", today, com.infinitylearn.hrgenie.data.MoodKey.GOOD, emptySet(), "")
        moods.save(
            "HYD600902", yesterday,
            com.infinitylearn.hrgenie.data.MoodKey.STRESSED, setOf("Workload"), "",
        )

        val questions = com.infinitylearn.hrgenie.data.HrGenieContent.PULSE_QUESTIONS
        com.infinitylearn.hrgenie.data.PulseStore(context).save(
            employeeId = "EMP3801",
            cycle = com.infinitylearn.hrgenie.data.HrGenieContent.currentCycle,
            answers = mapOf(questions.first().id to questions.first().options.first()),
            completedAtMillis = 1_754_500_000_000L,
        )

        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HR000")
        activity.findViewById<android.view.View>(R.id.viewHistory).performClick()
        idle()
        assertEquals(R.id.trendsFragment, nav.currentDestination?.id)

        // Fourteen columns, one per day, including the days nobody answered.
        val chart = activity.findViewById<android.widget.LinearLayout>(R.id.moodTrendChart)
        assertEquals(14, chart.childCount)

        // Two days carried answers: GOOD is 8 and STRESSED is 4, so the mean is 6.0.
        assertEquals(
            activity.getString(R.string.trends_mood_sub, "6.0", 2),
            activity.findViewById<android.widget.TextView>(R.id.moodTrendSubtitle)
                .text.toString(),
        )

        // Six cycles listed, newest first, with this month's completion counted.
        val cycles = activity.findViewById<android.widget.LinearLayout>(R.id.pulseCycleList)
        assertEquals(6, cycles.childCount)
        assertEquals(
            activity.getString(R.string.trends_cycle_count, 1, 4),
            cycles.getChildAt(0)
                .findViewById<android.widget.TextView>(R.id.cycleCount).text.toString(),
        )

        // Tapping a day opens who felt what, titled with that date.
        chart.getChildAt(13).performClick()
        idle()
        val sheet = allFragments(activity.supportFragmentManager.fragments)
            .filterIsInstance<com.infinitylearn.hrgenie.ui.insights.HrDetailSheet>()
            .firstOrNull()
        assertNotNull("a day with answers should drill down", sheet)
        assertEquals(
            "🙂 Good",
            sheet!!.requireView()
                .findViewById<android.widget.LinearLayout>(R.id.sheetList)
                .getChildAt(0)
                .findViewById<android.widget.TextView>(R.id.personValue).text.toString(),
        )
    }

    /** Shifts an ISO date, for seeding history in the past. */
    private fun shiftDays(dateIso: String, days: Int): String {
        val format = java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val calendar = java.util.Calendar.getInstance().apply { time = format.parse(dateIso)!! }
        calendar.add(java.util.Calendar.DAY_OF_YEAR, days)
        return format.format(calendar.time)
    }

    @Test
    fun `the tickets card shows the empty state when nothing has been raised`() {
        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")

        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.ticketEmpty).visibility,
        )
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.ticketList).visibility,
        )
        assertEquals(
            activity.getString(R.string.hr_tickets_all_clear),
            activity.findViewById<android.widget.TextView>(R.id.ticketBadge).text.toString(),
        )
    }

    @Test
    fun `a raised ticket replaces the empty state and counts as open`() {
        TicketStore(ApplicationProvider.getApplicationContext())
            .raise("EMP3801", "Payslip for July is missing", "Payroll")

        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "HR000")

        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.ticketEmpty).visibility,
        )
        val list = activity.findViewById<android.widget.LinearLayout>(R.id.ticketList)
        assertEquals(1, list.childCount)
        assertEquals(
            "Payslip for July is missing",
            activity.findViewById<android.widget.TextView>(R.id.ticketSubject).text.toString(),
        )
        assertEquals(
            activity.getString(R.string.hr_tickets_open_badge, 1),
            activity.findViewById<android.widget.TextView>(R.id.ticketBadge).text.toString(),
        )
    }

    @Test
    fun `rejected credentials stay on sign in with one message and no HR sheet`() {
        val (activity, nav) = launch()
        // Neither a wrong password nor an unknown id can be singled out: the server
        // answers both with the same 401 so the form cannot be used to find out who
        // exists. The sheet must not raise itself off a guess either.
        submitSignIn(activity, employeeId = "IL-104282")

        assertEquals(R.id.signInFragment, nav.currentDestination?.id)
        assertEquals(
            activity.getString(R.string.error_bad_credentials),
            activity.findViewById<android.widget.TextView>(R.id.passwordError).text.toString(),
        )
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.hrHelpScrim).visibility,
        )
        // The button has to come back, or a mistyped password locks the screen.
        assertTrue(activity.findViewById<android.view.View>(R.id.signInButton).isEnabled)
    }

    @Test
    fun `a ticket synced from another device is not announced as an HR update`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = TicketStore(context)
        // Arrives from the server already OPEN, with no local record of ever seeing it
        // — which is what a second phone looks like. Nothing has happened to it.
        store.replaceForEmployee(
            "EMP3801",
            listOf(
                Ticket(
                    id = "HRG-0009",
                    employeeId = "EMP3801",
                    subject = "Raised on my other phone",
                    category = "Payroll",
                    createdAtMillis = System.currentTimeMillis(),
                    status = TicketStatus.OPEN,
                )
            ),
        )
        assertTrue(store.unseenUpdates("EMP3801").isEmpty())

        // Once HR moves it, that is a real update and must be announced.
        store.updateStatus("HRG-0009", TicketStatus.IN_PROGRESS, "Looking into it", "HR000")
        assertEquals(
            listOf("HRG-0009"),
            store.unseenUpdates("EMP3801").map { it.id },
        )
    }

    @Test
    fun `the contact HR link raises the sheet with whatever id was typed`() {
        val (activity, _) = launch()
        activity.findViewById<android.widget.EditText>(R.id.employeeIdInput)
            .setText("hyd999999")
        activity.findViewById<android.view.View>(R.id.contactHrLink).performClick()
        idle()

        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.hrHelpScrim).visibility,
        )
        assertEquals(
            "HYD999999",
            activity.findViewById<android.widget.TextView>(R.id.hrHelpId).text.toString(),
        )
        assertEquals(
            EmployeeDirectory.HR_EMAIL,
            activity.findViewById<android.widget.TextView>(R.id.hrHelpEmailAddress)
                .text.toString(),
        )

        // Editing the ID retracts it.
        activity.findViewById<android.widget.EditText>(R.id.employeeIdInput).setText("HYD600071")
        idle()
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.hrHelpScrim).visibility,
        )
    }

    @Test
    fun `a server outage says so rather than blaming the credentials`() {
        stubAuth { Result.failure(ApiException(ApiFailure.Unreachable("tunnel closed"))) }
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")

        assertEquals(R.id.signInFragment, nav.currentDestination?.id)
        // Nothing is pinned on the password: we never got far enough to know.
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.passwordError).visibility,
        )
        assertTrue(activity.findViewById<android.view.View>(R.id.signInButton).isEnabled)
    }

    @Test
    fun `the server decides who is HR, not the employee id`() {
        // An id with no "HR" prefix that the server nonetheless calls HR must land on
        // the dashboard — the prefix rule is only a fallback for the demo records.
        stubAuth { employeeId ->
            val record = EmployeeDirectory.find(employeeId) ?: EmployeeDirectory.EMPLOYEES.first()
            Result.success(
                sessionFor(record).let { session ->
                    session.copy(employee = session.employee.copy(accessRole = AccessRole.HR))
                }
            )
        }
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")

        assertEquals(R.id.insightsFragment, nav.currentDestination?.id)
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.navContainer).visibility,
        )
    }

    @Test
    fun `an expired token is not restored as a session`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = SessionStore(context)
        val employee = EmployeeDirectory.find("EMP3801")!!
        store.remember(
            sessionFor(employee, expiresAtSeconds = System.currentTimeMillis() / 1000 - 60)
        )

        assertNull(store.remembered())
        assertNull(store.token())
        // And the app opens on sign-in rather than a session it cannot authorise.
        val (_, nav) = launch()
        assertEquals(R.id.signInFragment, nav.currentDestination?.id)
    }

    @Test
    fun `a live session survives a restart without the directory`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val store = SessionStore(context)
        store.remember(sessionFor(EmployeeDirectory.find("EMP3801")!!))

        val restored = store.remembered()
        assertNotNull(restored)
        assertEquals("EMP3801", restored!!.employee.employeeId)
        assertEquals("Gunapati Praveen Reddy", restored.employee.name)
        assertNotNull(store.token())

        val (_, nav) = launch()
        assertEquals(R.id.homeFragment, nav.currentDestination?.id)
    }

    @Test
    fun `every destination inflates`() {
        val (_, nav) = launch()
        nav.navigate(R.id.action_signIn_to_home)
        idle()

        // Insights is excluded on purpose: it lives outside mainGraph now, so
        // navigating to it would put the following ids out of scope. It has its own
        // test below.
        val destinations = listOf(
            R.id.chatFragment,
            R.id.moodFragment,
            R.id.pulseFragment,
            R.id.myTicketsFragment,
            R.id.holidaysFragment,
        )
        destinations.forEach { id ->
            nav.navigate(id)
            idle()
            assertEquals(id, nav.currentDestination?.id)
        }
    }

    @Test
    fun `mood check-in opens pre-selected when home passes a face`() {
        val (activity, nav) = launch()
        nav.navigate(R.id.action_signIn_to_home)
        idle()

        nav.navigate(
            R.id.action_home_to_mood,
            Bundle().apply { putString("moodKey", "STRESSED") },
        )
        idle()

        val flipper = activity.findViewById<android.widget.ViewFlipper>(R.id.flipper)
        assertNotNull(flipper)
        // Step 1 ("what's weighing on you?") rather than the picker.
        assertEquals(1, flipper.displayedChild)
    }

    @Test
    fun `chat renders the greeting and answers a suggestion`() {
        val (activity, nav) = launch()
        nav.navigate(R.id.action_signIn_to_home)
        idle()
        nav.navigate(R.id.action_home_to_chat)
        idle()

        stubKnowledgeBase(activity)

        val list = activity.findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.messageList)
        // Day chip + greeting.
        assertEquals(2, list.adapter?.itemCount)

        // Index 0 and 1 are the ticket actions; the Q&A suggestions follow.
        val chipRow = activity.findViewById<android.widget.LinearLayout>(R.id.suggestionRow)
        chipRow.getChildAt(2).performClick()
        idle()
        settle()
        // Day chip, greeting, the question, the answer, and the feedback card.
        assertEquals(5, list.adapter?.itemCount)
    }

    @Test
    fun `holiday list groups every month`() {
        val (activity, nav) = launch()
        nav.navigate(R.id.action_signIn_to_home)
        idle()
        nav.navigate(R.id.holidaysFragment)
        idle()

        val list = activity.findViewById<androidx.recyclerview.widget.RecyclerView>(R.id.holidayList)
        val months = com.infinitylearn.hrgenie.data.HrGenieContent.HOLIDAYS
            .map { it.monthLabel }.distinct().size
        val holidays = com.infinitylearn.hrgenie.data.HrGenieContent.HOLIDAYS.size
        assertEquals(months + holidays, list.adapter?.itemCount)
    }

    @Test
    fun `avatar opens the profile menu and logout returns to sign in`() {
        val (activity, nav) = launch()
        submitSignIn(activity)

        activity.findViewById<android.view.View>(R.id.avatar).performClick()
        idle()

        val home = activity.supportFragmentManager
            .findFragmentById(R.id.navHost)!!
            .childFragmentManager.fragments.first() as HomeFragment
        val popup = home.profileMenu
        assertNotNull("Tapping the avatar should drop a menu", popup)
        assertNotNull(popup!!.contentView.findViewById<android.view.View>(R.id.myProfile))

        popup.contentView.findViewById<android.view.View>(R.id.logout).performClick()
        idle()

        assertEquals(R.id.signInFragment, nav.currentDestination?.id)
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.navContainer).visibility,
        )
    }

    @Test
    fun `profile renders the signed-in record`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HYD609552")

        activity.findViewById<android.view.View>(R.id.avatar).performClick()
        idle()
        val home = activity.supportFragmentManager
            .findFragmentById(R.id.navHost)!!
            .childFragmentManager.fragments.first() as HomeFragment
        home.profileMenu!!.contentView
            .findViewById<android.view.View>(R.id.myProfile).performClick()
        idle()

        assertEquals(R.id.profileFragment, nav.currentDestination?.id)

        fun text(id: Int) =
            activity.findViewById<android.widget.TextView>(id).text.toString()

        assertEquals("Aamy C P", text(R.id.profileName))
        assertEquals("HYD609552", text(R.id.profileEmployeeId))
        assertEquals(
            "Assistant Manager - HRBP • Human Resource & Administration",
            text(R.id.profileRole),
        )
    }

    @Test
    fun `the profile shows only what the HRMS sends`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        nav.navigate(R.id.action_home_to_profile)
        idle()

        assertEquals(R.id.profileFragment, nav.currentDestination?.id)

        // The three-up strip is gender, team and reportees — all from the API. Blood
        // group and mobile are gone with the local records that used to supply them.
        fun statLabel(slot: Int) = activity.findViewById<android.view.View>(slot)
            .findViewById<android.widget.TextView>(R.id.statLabel).text.toString()
        assertEquals(activity.getString(R.string.label_gender), statLabel(R.id.stat1))
        assertEquals(activity.getString(R.string.label_team), statLabel(R.id.stat2))
        assertEquals(activity.getString(R.string.label_reportees), statLabel(R.id.stat3))

        // The stub sends no orgUnitPath, so that row drops out with its divider
        // rather than showing an empty value.
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.orgUnitRow).visibility,
        )
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.orgUnitDivider).visibility,
        )
    }

    @Test
    fun `a manager profile shows the reportee count`() {
        val (activity, nav) = launch()
        // Mohd Faiyaz has two reportees.
        submitSignIn(activity, employeeId = "HYD600071")
        nav.navigate(R.id.action_home_to_profile)
        idle()

        assertEquals(R.id.profileFragment, nav.currentDestination?.id)
        assertEquals(
            "2",
            activity.findViewById<android.view.View>(R.id.stat3)
                .findViewById<android.widget.TextView>(R.id.statValue).text.toString(),
        )
    }

    @Test
    fun `avatar art follows the gender on the record`() {
        assertEquals(
            R.drawable.ic_avatar_female,
            EmployeeDirectory.find("HYD609552")!!.avatarIconRes(),
        )
        assertEquals(
            R.drawable.ic_avatar_male,
            EmployeeDirectory.find("HYD600071")!!.avatarIconRes(),
        )
        // Anything else falls back to the neutral figure.
        assertEquals(
            R.drawable.ic_person,
            EmployeeDirectory.EMPLOYEES.first().copy(gender = "").avatarIconRes(),
        )
    }

    @Test
    fun `profile offers a photo upload when none has been added`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HYD609552")
        nav.navigate(R.id.action_home_to_profile)
        idle()

        // No photo yet: silhouette showing, photo layer hidden, prompt to add one.
        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.profileAvatarIcon).visibility,
        )
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.profileAvatarPhoto).visibility,
        )
        assertEquals(
            activity.getString(R.string.photo_add_hint),
            activity.findViewById<android.widget.TextView>(R.id.photoHint).text.toString(),
        )
        assertNotNull(activity.findViewById<android.view.View>(R.id.photoBadge))
    }

    @Test
    fun `photo store round-trips per employee`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val photos = com.infinitylearn.hrgenie.data.PhotoStore(context)

        assertEquals(false, photos.has("HYD609552"))

        // Case-insensitive, and scoped per employee id.
        photos.fileFor("HYD609552").writeBytes(byteArrayOf(1, 2, 3))
        assertEquals(true, photos.has("hyd609552"))
        assertEquals(false, photos.has("HYD600071"))

        photos.delete("HYD609552")
        assertEquals(false, photos.has("HYD609552"))
    }

    @Test
    fun `a remembered session opens straight on home`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HYD600902")
        assertEquals(R.id.homeFragment, nav.currentDestination?.id)

        // Relaunching skips sign in entirely.
        val (relaunched, relaunchedNav) = launch()
        assertEquals(R.id.homeFragment, relaunchedNav.currentDestination?.id)
        assertEquals(
            "Good morning, Manikanteswar",
            relaunched.findViewById<android.widget.TextView>(R.id.greeting).text.toString(),
        )

        // Logging out clears it, so the next launch asks again.
        relaunched.findViewById<android.view.View>(R.id.avatar).performClick()
        idle()
        val home = relaunched.supportFragmentManager
            .findFragmentById(R.id.navHost)!!
            .childFragmentManager.fragments.first() as HomeFragment
        home.profileMenu!!.contentView
            .findViewById<android.view.View>(R.id.logout).performClick()
        idle()

        val (_, afterLogout) = launch()
        assertEquals(R.id.signInFragment, afterLogout.currentDestination?.id)
    }

    @Test
    fun `unchecking keep me signed in does not persist the session`() {
        val (activity, nav) = launch()
        activity.findViewById<android.view.View>(R.id.keepSignedInRow).performClick()
        submitSignIn(activity, employeeId = "HYD600902")
        assertEquals(R.id.homeFragment, nav.currentDestination?.id)

        val (_, relaunchedNav) = launch()
        assertEquals(R.id.signInFragment, relaunchedNav.currentDestination?.id)
    }

    @Test
    fun `home survives a recreate with only the remembered session`() {
        val (activity, _) = launch()
        submitSignIn(activity, employeeId = "EMP3801")
        idle()

        // Simulates coming back from the cropper after the process was killed: the
        // saved state comes back, but the ViewModel does not.
        val state = Bundle()
        controllers.last().pause().stop().saveInstanceState(state)

        val recreated = Robolectric.buildActivity(MainActivity::class.java).setup(state)
        controllers += recreated
        idle()

        val home = recreated.get()
        assertEquals(
            "Good morning, Gunapati",
            home.findViewById<android.widget.TextView>(R.id.greeting).text.toString(),
        )
        // The attendance card binds too, rather than sitting there blank.
        assertEquals(
            home.getString(R.string.action_check_in),
            home.findViewById<android.widget.TextView>(R.id.attendanceAction).text.toString(),
        )
    }

    @Test
    fun `the mood card disappears once the day is logged`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HYD609552")

        assertEquals(
            android.view.View.VISIBLE,
            activity.findViewById<android.view.View>(R.id.moodCard).visibility,
        )

        // Walk the real check-in: pick a face, then save.
        nav.navigate(
            R.id.action_home_to_mood,
            Bundle().apply { putString("moodKey", "GOOD") },
        )
        idle()
        activity.findViewById<android.view.View>(R.id.saveCheckIn).performClick()
        idle()

        val stored = com.infinitylearn.hrgenie.data.MoodStore(activity)
            .entry("HYD609552", com.infinitylearn.hrgenie.data.HrGenieContent.todayIso)
        assertNotNull(stored)
        assertEquals(com.infinitylearn.hrgenie.data.MoodKey.GOOD, stored!!.mood)

        // Back on Home the prompt is gone for the rest of the day.
        nav.popBackStack(R.id.homeFragment, false)
        idle()
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.moodCard).visibility,
        )
    }

    @Test
    fun `the check-in tab reopens today's entry instead of asking again`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HYD600902")

        // Log a mood.
        nav.navigate(
            R.id.action_home_to_mood,
            Bundle().apply { putString("moodKey", "STRESSED") },
        )
        idle()
        activity.findViewById<android.view.View>(R.id.saveCheckIn).performClick()
        idle()
        nav.popBackStack(R.id.homeFragment, false)
        idle()

        // Coming back through the tab lands on the confirmation, not the picker.
        nav.navigate(R.id.moodFragment)
        idle()
        val flipper = activity.findViewById<android.widget.ViewFlipper>(R.id.flipper)
        assertEquals(2, flipper.displayedChild)

        // And it is the mood that was actually logged.
        assertEquals(
            com.infinitylearn.hrgenie.data.HrGenieContent.mood(
                com.infinitylearn.hrgenie.data.MoodKey.STRESSED,
            ).thanksLine,
            activity.findViewById<android.widget.TextView>(R.id.thanksLine).text.toString(),
        )
    }

    @Test
    fun `a mood logged by one employee does not follow another`() {
        val first = launch()
        submitSignIn(first.first, employeeId = "HYD600902")
        first.second.navigate(
            R.id.action_home_to_mood,
            Bundle().apply { putString("moodKey", "GREAT") },
        )
        idle()
        first.first.findViewById<android.view.View>(R.id.saveCheckIn).performClick()
        idle()

        // A different employee starts the day unanswered.
        SessionStore(ApplicationProvider.getApplicationContext()).forget()
        val (second, secondNav) = launch()
        submitSignIn(second, employeeId = "HYD600071")

        assertEquals(
            android.view.View.VISIBLE,
            second.findViewById<android.view.View>(R.id.moodCard).visibility,
        )
        secondNav.navigate(R.id.moodFragment)
        idle()
        assertEquals(
            0,
            second.findViewById<android.widget.ViewFlipper>(R.id.flipper).displayedChild,
        )
    }

    @Test
    fun `a completed pulse greets instead of asking again`() {
        val (activity, nav) = launch()
        submitSignIn(activity, employeeId = "HYD609552")
        nav.navigate(R.id.pulseFragment)
        idle()

        // Answer every question.
        val options = activity.findViewById<android.widget.LinearLayout>(R.id.optionList)
        repeat(com.infinitylearn.hrgenie.data.HrGenieContent.PULSE_QUESTIONS.size) {
            activity.findViewById<android.widget.LinearLayout>(R.id.optionList)
                .getChildAt(0).performClick()
            idle()
        }
        assertNotNull(options)

        val stored = com.infinitylearn.hrgenie.data.PulseStore(activity)
            .entry("HYD609552", com.infinitylearn.hrgenie.data.HrGenieContent.currentCycle)
        assertNotNull("the cycle should be recorded", stored)

        // Home stops nudging.
        nav.popBackStack(R.id.homeFragment, false)
        idle()
        assertEquals(
            android.view.View.GONE,
            activity.findViewById<android.view.View>(R.id.pulseNudge).visibility,
        )

        // Reopening the tab lands on the month's greeting, not question one.
        nav.navigate(R.id.pulseFragment)
        idle()
        assertEquals(
            2,
            activity.findViewById<android.widget.ViewFlipper>(R.id.flipper).displayedChild,
        )
        assertEquals(
            activity.getString(
                R.string.pulse_month_done_title,
                com.infinitylearn.hrgenie.data.HrGenieContent.currentMonthName,
            ),
            activity.findViewById<android.widget.TextView>(R.id.pulseDoneTitle).text.toString(),
        )
    }

    @Test
    fun `application context is the app under test`() {
        assertEquals(
            "com.infinitylearn.hrgenie",
            ApplicationProvider.getApplicationContext<android.app.Application>().packageName,
        )
    }
}
