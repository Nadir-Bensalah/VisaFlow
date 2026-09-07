package app.capmedia.visaflow.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.capmedia.visaflow.model.MineBundle
import kotlinx.coroutines.launch

/**
 * La session du client. Le numéro est l'identité, l'appareil est reconnu
 * quatre-vingt-dix jours, et le jeton vit dans le magasin chiffré. Le même
 * modèle que ios/Sources/Data/Session.swift, au mot près.
 */
class Session(
    val api: Api,
    private val store: SecureStore,
    private val prefs: android.content.SharedPreferences,
) : ViewModel() {

    sealed interface State {
        data object Anonyme : State
        data class AttenteCode(val phone: String) : State
        data class Connecte(val phone: String) : State
    }

    var state by mutableStateOf<State>(State.Anonyme)
        private set

    var deviceToken by mutableStateOf<String?>(null)
        private set

    var agencySlug by mutableStateOf(prefs.getString(KEY_AGENCY, "tca") ?: "tca")
        private set

    var language by mutableStateOf(prefs.getString(KEY_LANGUAGE, "fr") ?: "fr")
        private set

    var notificationsEnabled by mutableStateOf(prefs.getBoolean(KEY_NOTIFICATIONS, true))
        private set

    var busy by mutableStateOf(false)
        private set

    var lastError by mutableStateOf<String?>(null)

    var mine by mutableStateOf<MineBundle?>(null)
        private set

    init {
        val token = store.read(SecureStore.TOKEN)
        val phone = store.read(SecureStore.PHONE)
        if (!token.isNullOrBlank() && !phone.isNullOrBlank()) {
            deviceToken = token
            state = State.Connecte(phone)
            refresh()
        }
    }

    fun chooseAgency(slug: String) {
        agencySlug = slug.trim().lowercase()
        prefs.edit().putString(KEY_AGENCY, agencySlug).apply()
    }

    fun chooseLanguage(code: String) {
        language = code
        prefs.edit().putString(KEY_LANGUAGE, code).apply()
    }

    fun chooseNotifications(on: Boolean) {
        notificationsEnabled = on
        prefs.edit().putBoolean(KEY_NOTIFICATIONS, on).apply()
    }

    fun requestCode(phone: String) {
        val clean = phone.trim()
        if (clean.length < 6) return
        run {
            lastError = null
            busy = true
            viewModelScope.launch {
                try {
                    api.requestCode(agencySlug, clean)
                    state = State.AttenteCode(clean)
                } catch (e: Exception) {
                    lastError = e.message
                } finally {
                    busy = false
                }
            }
        }
    }

    fun verify(code: String) {
        val phone = (state as? State.AttenteCode)?.phone ?: return
        lastError = null
        busy = true
        viewModelScope.launch {
            try {
                val token = api.verifyCode(agencySlug, phone, code)
                store.write(SecureStore.TOKEN, token)
                store.write(SecureStore.PHONE, phone)
                deviceToken = token
                state = State.Connecte(phone)
                refresh()
            } catch (e: Exception) {
                lastError = e.message
            } finally {
                busy = false
            }
        }
    }

    fun refresh() {
        val token = deviceToken ?: return
        viewModelScope.launch {
            try {
                mine = api.mine(agencySlug, token)
            } catch (e: Exception) {
                lastError = e.message
            }
        }
    }

    /** Se déconnecter efface le jeton, pas seulement l'écran. Un appareil
     *  prêté ne doit pas garder l'accès aux dossiers du précédent client. */
    fun signOut() {
        store.clear()
        deviceToken = null
        mine = null
        state = State.Anonyme
    }

    fun back() {
        if (state is State.AttenteCode) state = State.Anonyme
    }

    companion object {
        private const val KEY_AGENCY = "device.agency"
        private const val KEY_LANGUAGE = "app.language"
        private const val KEY_NOTIFICATIONS = "app.notifications"

        fun factory(context: Context, api: Api): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = Session(
                    api = api,
                    store = SecureStore(context),
                    prefs = context.getSharedPreferences("visaflow", Context.MODE_PRIVATE),
                ) as T
            }
    }
}
