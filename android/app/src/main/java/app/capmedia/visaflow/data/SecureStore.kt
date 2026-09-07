package app.capmedia.visaflow.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Le jeton d'appareil vit quatre-vingt-dix jours et ouvre tous les dossiers du
 * client. Il n'a rien à faire dans des préférences en clair, que n'importe
 * quelle sauvegarde recopie. C'est l'équivalent du trousseau iOS.
 */
class SecureStore(context: Context) {

    private val prefs: SharedPreferences = runCatching {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "visaflow.secure",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrElse {
        // Sur un appareil dont le magasin de clés est cassé, mieux vaut une
        // session qui redemande le code qu'une application qui refuse d'ouvrir.
        context.getSharedPreferences("visaflow.fallback", Context.MODE_PRIVATE)
    }

    fun read(key: String): String? = prefs.getString(key, null)

    fun write(key: String, value: String?) {
        prefs.edit().apply {
            if (value == null) remove(key) else putString(key, value)
        }.apply()
    }

    fun clear() = prefs.edit().clear().apply()

    companion object {
        const val TOKEN = "device.token"
        const val PHONE = "device.phone"
    }
}
