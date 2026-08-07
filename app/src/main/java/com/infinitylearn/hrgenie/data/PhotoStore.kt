package com.infinitylearn.hrgenie.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

/**
 * Profile photos the employee has uploaded themselves. One JPEG per employee id in
 * internal storage, so the image never leaves the device and no storage permission
 * is needed. The cropper writes into [fileFor] directly; this class only locates,
 * reads and clears those files. Swap for an HRMS upload when that endpoint exists.
 */
class PhotoStore(private val context: Context) {

    private val dir: File
        get() = File(context.filesDir, DIR_NAME).apply { mkdirs() }

    fun fileFor(employeeId: String): File =
        File(dir, "${employeeId.lowercase(Locale.ROOT)}.jpg")

    fun has(employeeId: String): Boolean = fileFor(employeeId).let { it.exists() && it.length() > 0 }

    /**
     * Copies [source] into this employee's slot. Used when the cropper couldn't write
     * to our file directly and handed back its own output instead.
     */
    fun save(employeeId: String, source: Uri): Boolean = runCatching {
        val target = fileFor(employeeId)
        // Never copy a file onto itself — that would truncate it to nothing.
        if (source.scheme == "file" && source.path == target.path) return has(employeeId)

        context.contentResolver.openInputStream(source)?.use { input ->
            FileOutputStream(target).use(input::copyTo)
        } ?: return false
        has(employeeId)
    }.getOrElse {
        Log.w(TAG, "Could not copy cropped photo", it)
        false
    }

    fun load(employeeId: String): Bitmap? {
        val file = fileFor(employeeId)
        return if (has(employeeId)) BitmapFactory.decodeFile(file.path) else null
    }

    fun delete(employeeId: String): Boolean = fileFor(employeeId).delete()

    private companion object {
        const val TAG = "PhotoStore"
        const val DIR_NAME = "profile-photos"
    }
}
