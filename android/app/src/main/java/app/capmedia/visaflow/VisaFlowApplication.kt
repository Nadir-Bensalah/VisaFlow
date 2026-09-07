package app.capmedia.visaflow

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class VisaFlowApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    /**
     * Deux canaux, pas un. Un client qui coupe les nouvelles commerciales ne
     * doit pas couper l'alerte « votre passeport est prêt » : mélanger les
     * deux dans un canal unique revient à choisir pour lui.
     */
    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_DOSSIER,
                getString(R.string.channel_case),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = getString(R.string.channel_case_hint) },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_INFO,
                getString(R.string.channel_info),
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = getString(R.string.channel_info_hint) },
        )
    }

    companion object {
        const val CHANNEL_DOSSIER = "dossier"
        const val CHANNEL_INFO = "info"
    }
}
