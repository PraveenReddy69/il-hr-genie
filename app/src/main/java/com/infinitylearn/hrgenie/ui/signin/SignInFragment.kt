package com.infinitylearn.hrgenie.ui.signin

import android.animation.ValueAnimator
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.text.method.PasswordTransformationMethod
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.widget.TextView
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.Auth
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.Session
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.data.net.ApiException
import com.infinitylearn.hrgenie.data.net.ApiFailure
import com.infinitylearn.hrgenie.databinding.FragmentSignInBinding
import com.infinitylearn.hrgenie.push.PushTokenStore
import kotlinx.coroutines.launch
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyBottomInsetPadding
import com.infinitylearn.hrgenie.ui.common.applyPressScale
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance
import java.util.Locale

class SignInFragment : Fragment() {

    private var _binding: FragmentSignInBinding? = null
    private val binding get() = _binding!!

    private val session: SessionViewModel by activityViewModels()

    private var haloAnimator: ValueAnimator? = null
    private var passwordVisible = false
    private var keepSignedIn = true

    /** A sign-in is in flight; a second tap would send a second request. */
    private var signingIn = false

    /** The ID the HR sheet is currently about, used to prefill the mail draft. */
    private var pendingEmployeeId: String? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentSignInBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.scroller.applyTopInsetPadding()
        binding.scroller.applyBottomInsetPadding()
        binding.content.playScreenEntrance()

        startHaloPulse()
        bindKeepSignedIn()
        bindPasswordToggle()
        bindHrHelp()

        binding.signInButton.applyPressScale()
        binding.signInButton.setOnClickListener { attemptSignIn() }

        binding.forgotPassword.setOnClickListener {
            // Real build: deep-link to the Infinity Learn password reset flow.
        }

        // Clear a stale error as soon as the user starts correcting that field.
        binding.employeeIdInput.doAfterTextChanged {
            binding.employeeIdError.visibility = View.GONE
            if (binding.hrHelp.root.visibility == View.VISIBLE) hideHrHelp()
        }
        binding.passwordInput.doAfterTextChanged { text ->
            binding.passwordError.visibility = View.GONE
            // The design's 4px dot tracking would stretch the hint, so only widen
            // the field once there is something to mask.
            binding.passwordInput.letterSpacing = if (text.isNullOrEmpty()) 0f else DOT_TRACKING
        }
    }

    private fun bindKeepSignedIn() {
        binding.keepSignedInBox.isSelected = keepSignedIn
        binding.keepSignedInRow.setOnClickListener {
            keepSignedIn = !keepSignedIn
            binding.keepSignedInBox.isSelected = keepSignedIn
            binding.keepSignedInBox.text = if (keepSignedIn) "✓" else ""
        }
    }

    private fun bindPasswordToggle() {
        binding.togglePassword.setOnClickListener {
            passwordVisible = !passwordVisible
            val input = binding.passwordInput
            val cursor = input.selectionEnd
            input.transformationMethod =
                if (passwordVisible) null else PasswordTransformationMethod.getInstance()
            input.setSelection(cursor.coerceIn(0, input.text.length))
            binding.togglePassword.setText(
                if (passwordVisible) R.string.action_hide else R.string.action_show
            )
        }
    }

    /** Pulsing halo behind the app mark — 3.2s ease-in-out, per the handoff. */
    private fun startHaloPulse() {
        haloAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 3200L
            repeatCount = ValueAnimator.INFINITE
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { animator ->
                val t = animator.animatedFraction
                val halo = _binding?.halo ?: return@addUpdateListener
                halo.scaleX = 1f + t * 0.35f
                halo.scaleY = 1f + t * 0.35f
                halo.alpha = 1f - t
            }
            start()
        }
    }

    private fun attemptSignIn() {
        if (signingIn) return

        val employeeId = binding.employeeIdInput.text.toString().trim().uppercase(Locale.ROOT)
        val password = binding.passwordInput.text.toString()

        // Blank fields first: no point asking the server about an empty form.
        val missingId = employeeId.isEmpty()
        val missingPassword = password.isEmpty()
        showError(
            binding.employeeIdError,
            if (missingId) R.string.error_employee_id_required else null,
        )
        showError(
            binding.passwordError,
            if (missingPassword) R.string.error_password_required else null,
        )
        if (missingId || missingPassword) return

        setBusy(true)
        viewLifecycleOwner.lifecycleScope.launch {
            val result = Auth.signIn(employeeId, password)
            // The screen can go away while the call is in flight.
            if (_binding == null) return@launch
            setBusy(false)
            result
                .onSuccess { onSignedIn(it) }
                .onFailure { showSignInFailure(it) }
        }
    }

    private fun onSignedIn(signedIn: Session) {
        val employee = signedIn.employee

        // "Keep me signed in" decides only whether this outlives the process; the
        // token is held in the session either way, because every later call needs it.
        val store = SessionStore(requireContext())
        if (keepSignedIn) store.remember(signedIn) else store.forget()
        session.signIn(employee, keepSignedIn, signedIn.token)
        pairDeviceForPush(employee.employeeId)

        // The server says who is HR; the app does not guess from the id.
        findNavController().navigate(
            if (employee.isHr) R.id.action_signIn_to_insights else R.id.action_signIn_to_home
        )
    }

    /**
     * Says what actually went wrong.
     *
     * A rejected password and an unknown id both come back as 401 — the server will
     * not say which, so that nobody can use the form to discover whether an id exists.
     * One message covers both, and it goes under the password rather than the id so it
     * does not look like a verdict on the id alone.
     */
    private fun showSignInFailure(error: Throwable) {
        when (val failure = (error as? ApiException)?.failure) {
            is ApiFailure.Http -> if (failure.code == HTTP_UNAUTHORISED) {
                showError(binding.passwordError, R.string.error_bad_credentials)
            } else {
                Log.w(TAG, "Sign-in rejected: ${failure.code} ${failure.message}")
                notify(getString(R.string.error_signin_server, failure.code))
            }

            ApiFailure.Timeout -> notify(getString(R.string.error_signin_timeout))
            is ApiFailure.Unreachable -> notify(getString(R.string.error_signin_unreachable))
            is ApiFailure.Unusable -> notify(getString(R.string.error_signin_unusable))
            null -> {
                Log.w(TAG, "Sign-in failed", error)
                notify(getString(R.string.error_signin_unusable))
            }
        }
    }

    /** Blocks a second submit and shows the wait, which is a real network round trip. */
    private fun setBusy(busy: Boolean) {
        signingIn = busy
        binding.signInButton.isEnabled = !busy
        binding.signInButton.alpha = if (busy) 0.6f else 1f
        binding.signInButton.setText(
            if (busy) R.string.action_signing_in else R.string.action_sign_in
        )
    }

    private fun notify(message: String) {
        Snackbar.make(binding.root, message, Snackbar.LENGTH_LONG).show()
    }

    /**
     * Pairs this device's push token with whoever just signed in.
     *
     * The token identifies the install, not the person, so the server needs the pair
     * to address a push. Until POST /api/devices exists there is nowhere to send it —
     * the token is kept locally and the log line says what would be sent.
     */
    private fun pairDeviceForPush(employeeId: String) {
        val tokens = PushTokenStore(requireContext())
        tokens.refresh { token ->
            if (!tokens.needsRegistering(employeeId)) return@refresh
            Log.i(
                "HrGeniePush",
                "Device ready to pair: employeeId=$employeeId token=${token.take(12)}…",
            )
            // TODO: POST /api/devices { employeeId, token, platform: "android" }
            tokens.markRegistered(employeeId)
        }
    }

    // ------------------------------------------------------- connect to HR sheet

    private fun bindHrHelp() {
        // The sheet sits at the window bottom, so it has to clear the navigation bar
        // itself — otherwise its buttons render underneath the system controls.
        binding.hrHelp.root.applyBottomInsetPadding()
        hideHrHelp(animate = false)
        binding.hrHelp.hrHelpDismiss.setOnClickListener {
            hideHrHelp()
            binding.employeeIdInput.requestFocus()
        }
        binding.hrHelpScrim.setOnClickListener { hideHrHelp() }
        binding.contactHrLink.setOnClickListener {
            showHrHelp(binding.employeeIdInput.text.toString().trim().uppercase(Locale.ROOT))
        }
        binding.hrHelp.hrHelpEmail.setOnClickListener { emailHrTeam() }
        binding.hrHelp.hrHelpContact.setOnClickListener { emailHrTeam() }
        binding.hrHelp.hrHelpEmailAddress.text = EmployeeDirectory.HR_EMAIL
    }

    private fun showHrHelp(employeeId: String) {
        binding.hrHelp.hrHelpId.text = employeeId
        pendingEmployeeId = employeeId

        binding.hrHelpScrim.visibility = View.VISIBLE
        binding.hrHelp.root.visibility = View.VISIBLE
        binding.hrHelp.root.post {
            binding.hrHelp.root.translationY = binding.hrHelp.root.height.toFloat()
            binding.hrHelp.root.animate()
                .translationY(0f)
                .setDuration(280L)
                .setInterpolator(DecelerateInterpolator())
                .start()
        }
    }

    private fun hideHrHelp(animate: Boolean = true) {
        binding.hrHelpScrim.visibility = View.GONE
        val sheet = binding.hrHelp.root
        if (!animate) {
            sheet.visibility = View.GONE
            return
        }
        sheet.animate()
            .translationY(sheet.height.toFloat())
            .setDuration(200L)
            .withEndAction { _binding?.hrHelp?.root?.visibility = View.GONE }
            .start()
    }

    private fun emailHrTeam() {
        val id = pendingEmployeeId.orEmpty()
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:${EmployeeDirectory.HR_EMAIL}")
            putExtra(Intent.EXTRA_SUBJECT, getString(R.string.hr_help_email_subject, id))
            putExtra(Intent.EXTRA_TEXT, getString(R.string.hr_help_email_body, id))
        }
        // Hands off to the user's mail app — nothing is sent on their behalf.
        // Catching beats resolveActivity, which package visibility can blank out.
        runCatching { startActivity(intent) }.onFailure {
            Snackbar.make(binding.root, R.string.no_email_app, Snackbar.LENGTH_SHORT).show()
        }
    }

    private fun showError(field: TextView, message: Int?) {
        if (message == null) {
            field.visibility = View.GONE
        } else {
            field.setText(message)
            field.visibility = View.VISIBLE
        }
    }

    override fun onDestroyView() {
        haloAnimator?.cancel()
        haloAnimator = null
        super.onDestroyView()
        _binding = null
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
    }

    private companion object {
        /** 4px at 17sp, per the handoff. */
        const val DOT_TRACKING = 0.23f

        const val TAG = "HrGenieAuth"
        const val HTTP_UNAUTHORISED = 401
    }
}
