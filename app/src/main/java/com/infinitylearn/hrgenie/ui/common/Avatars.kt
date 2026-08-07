package com.infinitylearn.hrgenie.ui.common

import android.view.View
import android.widget.ImageView
import androidx.annotation.DrawableRes
import com.infinitylearn.hrgenie.R
import com.infinitylearn.hrgenie.data.Employee
import com.infinitylearn.hrgenie.data.PhotoStore
import java.util.Locale

/**
 * Silhouette for an employee with no photo. Follows the gender on the record and
 * falls back to a neutral figure when it is missing or something else.
 */
@DrawableRes
fun Employee.avatarIconRes(): Int = when (gender.trim().lowercase(Locale.ROOT)) {
    "female", "f" -> R.drawable.ic_avatar_female
    "male", "m" -> R.drawable.ic_avatar_male
    else -> R.drawable.ic_person
}

/**
 * Shows the uploaded photo if there is one, otherwise the gendered silhouette.
 * Exactly one of the two views is visible afterwards.
 */
fun Employee.bindAvatar(photoView: ImageView, iconView: ImageView, photos: PhotoStore) {
    val bitmap = photos.load(employeeId)
    if (bitmap != null) {
        photoView.setImageBitmap(bitmap)
        photoView.visibility = View.VISIBLE
        iconView.visibility = View.GONE
    } else {
        iconView.setImageResource(avatarIconRes())
        iconView.visibility = View.VISIBLE
        photoView.visibility = View.GONE
    }
}
