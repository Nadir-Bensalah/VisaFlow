package app.capmedia.visaflow

import androidx.compose.runtime.Composable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Le serveur envoie des dates ISO, jamais du texte formaté. Le formatage se
 * fait ici, dans la langue et le fuseau du téléphone : une date mise en forme
 * côté serveur serait fausse pour un client libyen à Tunis.
 */
@Composable
fun shortDate(iso: String?): String = formatDate(iso)

fun formatDate(iso: String?, locale: Locale = Locale.getDefault()): String {
    if (iso.isNullOrBlank()) return "—"
    return runCatching {
        val instant = Instant.parse(iso)
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .format(instant.atZone(ZoneId.systemDefault()))
    }.recoverCatching {
        // Le serveur envoie aussi des dates nues, sans heure ni fuseau.
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .format(LocalDate.parse(iso))
    }.getOrDefault("—")
}

fun daysUntil(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        java.time.Duration.between(Instant.now(), Instant.parse(iso)).toDays()
    }.getOrNull()
}
