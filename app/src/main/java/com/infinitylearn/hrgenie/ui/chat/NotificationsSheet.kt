package com.infinitylearn.hrgenie.ui.chat

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.infinitylearn.hrgenie.MainActivity
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.databinding.SheetNotificationsBinding
import com.infinitylearn.hrgenie.push.NotificationAccess

/**
 * Explains what notifications are for, at the one moment it is obvious.
 *
 * Shown after a ticket is raised rather than before: the ask has to earn its
 * interruption, and "we will tell you when HR replies to HRG-0011" only means
 * something once there is an HRG-0011. Raising the ticket is never blocked by this —
 * it is already filed by the time the sheet appears.
 *
 * Declining costs nothing. Ticket updates still arrive in chat and on My tickets;
 * the notification only saves the employee from checking.
 */
class NotificationsSheet : BottomSheetDialogFragment() {

    private var _binding: SheetNotificationsBinding? = null

    private val ticketId: String get() = requireArguments().getString(ARG_TICKET_ID).orEmpty()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = SheetNotificationsBinding.inflate(inflater, container, false)
        return _binding!!.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val binding = _binding ?: return
        val activity = activity as? MainActivity

        // Two different asks. Once the platform has stopped offering its dialog, the
        // only honest button is one that opens settings — a button that silently does
        // nothing would read as the app being broken.
        val toSettings = activity != null && NotificationAccess.needsSettings(activity)

        binding.notifyTitle.setText(R.string.notify_title)
        binding.notifyBody.text = getString(
            if (toSettings) R.string.notify_body_settings else R.string.notify_body,
            ticketId,
        )
        binding.notifyAllow.setText(
            if (toSettings) R.string.notify_open_settings else R.string.notify_allow
        )

        binding.notifyAllow.setOnClickListener {
            if (toSettings) {
                activity?.let(NotificationAccess::openSettings)
            } else {
                activity?.askForNotifications()
            }
            dismiss()
        }
        binding.notifyLater.setOnClickListener { dismiss() }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    companion object {
        private const val ARG_TICKET_ID = "ticketId"

        fun of(ticketId: String) = NotificationsSheet().apply {
            arguments = Bundle().apply { putString(ARG_TICKET_ID, ticketId) }
        }
    }
}
