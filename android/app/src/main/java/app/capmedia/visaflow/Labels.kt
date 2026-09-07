package app.capmedia.visaflow

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Les libellés des étapes viennent du serveur sous forme de clés, pas de
 * texte. Traduire côté serveur obligerait à connaître la langue du téléphone,
 * et un client qui change de langue verrait la moitié de l'écran figée.
 */
@Composable
fun stageLabel(raw: String): String = resolve("stage_$raw", raw)

@Composable
fun shipStageLabel(raw: String): String = resolve("ship_$raw", raw)

@Composable
fun docStateLabel(raw: String): String = resolve("doc_$raw", raw)

@Composable
private fun resolve(name: String, fallback: String): String {
    val context = LocalContext.current
    val id = context.resources.getIdentifier(name, "string", context.packageName)
    // Une clé inconnue affiche la clé brute plutôt qu'un vide : on voit tout
    // de suite qu'il manque une traduction, au lieu de la découvrir en revue.
    return if (id != 0) context.getString(id) else fallback
}
