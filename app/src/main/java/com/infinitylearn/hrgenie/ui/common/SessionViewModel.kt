package com.infinitylearn.hrgenie.ui.common

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import com.infinitylearn.hrgenie.data.Employee

/**
 * Activity-scoped session state, shared by every feature screen.
 *
 * Deliberately holds no reference to storage or to a Context — persistence lives in
 * [com.infinitylearn.hrgenie.data.SessionStore] and is driven by the callers, so this
 * stays a plain in-memory holder.
 */
class SessionViewModel : ViewModel() {

    private val _employee = MutableLiveData<Employee?>(null)
    val employee: LiveData<Employee?> = _employee

    private val _isSignedIn = MutableLiveData(false)
    val isSignedIn: LiveData<Boolean> = _isSignedIn

    var keepSignedIn: Boolean = true
        private set

    /**
     * The bearer token for API calls.
     *
     * Held here as well as in [com.infinitylearn.hrgenie.data.SessionStore] because
     * "keep me signed in" only decides whether the session survives a restart — with
     * it off nothing is written to disk, but the token is still needed for every call
     * made while the app is open.
     */
    var token: String? = null
        private set

    /** The person whose data the app is showing; null before sign-in. */
    val signedInEmployee: Employee? get() = _employee.value

    fun signIn(employee: Employee, keepSignedIn: Boolean, token: String? = null) {
        _employee.value = employee
        this.keepSignedIn = keepSignedIn
        this.token = token
        _isSignedIn.value = true
    }

    fun signOut() {
        _employee.value = null
        keepSignedIn = false
        token = null
        _isSignedIn.value = false
    }
}
