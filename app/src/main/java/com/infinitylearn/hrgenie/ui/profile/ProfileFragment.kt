package com.infinitylearn.hrgenie.ui.profile

import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.navigation.fragment.findNavController
import com.canhub.cropper.CropImageContract
import com.canhub.cropper.CropImageContractOptions
import com.canhub.cropper.CropImageOptions
import com.canhub.cropper.CropImageView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.Employee
import com.infinitylearn.hrgenie.data.EmployeeDirectory
import com.infinitylearn.hrgenie.data.PhotoStore
import com.infinitylearn.hrgenie.data.SessionStore
import com.infinitylearn.hrgenie.databinding.FragmentProfileBinding
import com.infinitylearn.hrgenie.databinding.ItemProfileFieldBinding
import com.infinitylearn.hrgenie.databinding.ItemProfileStatBinding
import com.infinitylearn.hrgenie.ui.common.SessionViewModel
import com.infinitylearn.hrgenie.ui.common.applyStatusScrim
import com.infinitylearn.hrgenie.ui.common.applyTopInsetPadding
import com.infinitylearn.hrgenie.ui.common.bindAvatar
import com.infinitylearn.hrgenie.ui.common.playScreenEntrance

/** The signed-in employee's HRMS record, laid out like the directory profile card. */
class ProfileFragment : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    private val session: SessionViewModel by activityViewModels()

    private val photos: PhotoStore by lazy { PhotoStore(requireContext().applicationContext) }

    /**
     * Picks and crops in one pass: the cropper shows its own gallery/camera chooser,
     * then hands back a square image. No storage permission is involved.
     */
    private val cropPhoto = registerForActivityResult(CropImageContract()) { result ->
        // A cancel returns unsuccessful with no error; only report real failures.
        if (!result.isSuccessful) {
            result.error?.let {
                Log.w(TAG, "Crop failed", it)
                Snackbar.make(binding.root, R.string.photo_failed, Snackbar.LENGTH_SHORT).show()
            }
            return@registerForActivityResult
        }

        // The process can be killed behind the cropper, so resolve the employee from
        // storage rather than assuming the in-memory session survived.
        val employee = signedInEmployee() ?: return@registerForActivityResult

        // Copy the cropper's output into our slot; this overwrites any previous photo.
        val stored = result.uriContent?.let { photos.save(employee.employeeId, it) } == true
        if (!stored) Log.w(TAG, "Crop returned ${result.uriContent} but nothing was stored")

        renderAvatar(employee)
        Snackbar.make(
            binding.root,
            if (stored) R.string.photo_saved else R.string.photo_failed,
            Snackbar.LENGTH_SHORT,
        ).show()
    }

    /** The session survives normally; storage is the backstop after process death. */
    private fun signedInEmployee(): Employee? = session.signedInEmployee
        ?: SessionStore(requireContext()).remembered()?.employee

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.header.applyTopInsetPadding()
        binding.content.playScreenEntrance()
        binding.backButton.setOnClickListener { findNavController().popBackStack() }

        // Nothing to show if the process was restored without a session.
        val employee = signedInEmployee() ?: run {
            findNavController().popBackStack()
            return
        }
        bind(employee)
        binding.profileAvatarWrap.setOnClickListener { onAvatarTapped(employee) }
    }

    private fun bind(employee: Employee) {
        binding.profileName.text = employee.name
        binding.profileEmployeeId.text = employee.employeeId
        binding.profileRole.text = employee.roleLine
        renderAvatar(employee)

        bindStats(employee)

        // Only what the HRMS actually returns. Anything it does not hold is absent
        // rather than filled in from somewhere else.
        field(binding.fieldTitle, R.string.label_designation, employee.title)
        field(binding.fieldDepartment, R.string.label_department, employee.department)
        field(binding.fieldJoining, R.string.label_date_of_joining, employee.dateOfJoiningLabel)
        field(binding.fieldDob, R.string.label_dob, employee.dateOfBirthLabel)
        field(binding.fieldOfficialEmail, R.string.label_official_email, employee.officialEmail)
        field(binding.fieldOrgUnit, R.string.label_org_unit, employee.orgUnit)
        // Last row in the card, so its divider and padded container go with it —
        // otherwise an absent org unit leaves a gap at the bottom.
        val orgUnit = if (employee.orgUnit.isBlank()) View.GONE else View.VISIBLE
        binding.orgUnitRow.visibility = orgUnit
        binding.orgUnitDivider.visibility = orgUnit
    }

    // ---------------------------------------------------------------- photo upload

    private fun renderAvatar(employee: Employee) {
        employee.bindAvatar(binding.profileAvatarPhoto, binding.profileAvatarIcon, photos)
        binding.photoHint.setText(
            if (photos.has(employee.employeeId)) R.string.photo_change_hint
            else R.string.photo_add_hint
        )
    }

    private fun onAvatarTapped(employee: Employee) {
        if (!photos.has(employee.employeeId)) {
            launchPicker()
            return
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.photo_sheet_title)
            .setMessage(R.string.photo_stays_on_device)
            .setItems(
                arrayOf(
                    getString(R.string.action_choose_photo),
                    getString(R.string.action_remove_photo),
                )
            ) { _, which ->
                if (which == 0) launchPicker() else removePhoto(employee)
            }
            .show()
    }

    private fun launchPicker() {
        val ink = ContextCompat.getColor(requireContext(), R.color.ink)
        val options = CropImageOptions().apply {
            imageSourceIncludeGallery = true
            imageSourceIncludeCamera = true
            // Circular mask locked to 1:1, matching how the avatar renders.
            cropShape = CropImageView.CropShape.OVAL
            fixAspectRatio = true
            aspectRatioX = 1
            aspectRatioY = 1
            guidelines = CropImageView.Guidelines.ON
            outputRequestWidth = OUTPUT_PX
            outputRequestHeight = OUTPUT_PX
            activityTitle = getString(R.string.photo_sheet_title)
            cropMenuCropButtonTitle = getString(R.string.action_done)
            activityBackgroundColor = ink
            toolbarColor = ink
            // No customOutputUri: the library rejects file:// targets outright, so it
            // writes to its own cache and we copy that content:// result in below.
            outputCompressFormat = Bitmap.CompressFormat.JPEG
            outputCompressQuality = JPEG_QUALITY
        }
        cropPhoto.launch(CropImageContractOptions(uri = null, cropImageOptions = options))
    }

    private fun removePhoto(employee: Employee) {
        photos.delete(employee.employeeId)
        renderAvatar(employee)
        Snackbar.make(binding.root, R.string.photo_removed, Snackbar.LENGTH_SHORT).show()
    }

    // --------------------------------------------------------------------- details

    /**
     * The three headline facts, all from the HRMS.
     *
     * No longer branches on whether the person manages anyone: blood group and mobile
     * are not in the API, so there is nothing left to rearrange around.
     */
    private fun bindStats(employee: Employee) {
        stat(binding.stat1, R.string.label_gender, employee.gender)
        stat(binding.stat2, R.string.label_team, employee.team)
        stat(binding.stat3, R.string.label_reportees, employee.reportees.toString())
    }

    /**
     * A stat holds its slot in a fixed three-across row, so an unknown value shows a
     * dash rather than collapsing the row and shifting its neighbours.
     */
    private fun stat(slot: ItemProfileStatBinding, label: Int, value: String) {
        slot.statValue.text = value.ifBlank { getString(R.string.value_unknown) }
        slot.statLabel.setText(label)
    }

    /**
     * Fields stack, so one the HRMS does not hold is dropped entirely — an empty row
     * under a label reads as missing data rather than as data we were never sent.
     */
    private fun field(slot: ItemProfileFieldBinding, label: Int, value: String) {
        slot.root.visibility = if (value.isBlank()) View.GONE else View.VISIBLE
        if (value.isBlank()) return
        slot.fieldLabel.setText(label)
        slot.fieldValue.text = value
    }

    override fun onResume() {
        super.onResume()
        applyStatusScrim(R.color.ink, lightIcons = true)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private companion object {
        const val TAG = "ProfileFragment"

        /** Square edge the cropper writes. */
        const val OUTPUT_PX = 512
        const val JPEG_QUALITY = 88
    }
}
