package app.capmedia.visaflow.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.CardSurface
import app.capmedia.visaflow.design.Hairline
import app.capmedia.visaflow.design.SectionTitle
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type

private val LANGUAGES = listOf(
    "fr" to "Français",
    "en" to "English",
    "ar" to "العربية",
    "zh" to "中文",
)

/**
 * Les réglages. Quatre choses seulement : la langue, les notifications,
 * l'agence, et la sortie. Un écran de réglages qui déborde est un écran que
 * personne ne lit.
 */
@Composable
fun SettingsScreen(session: Session) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Token.Space.lg),
        verticalArrangement = Arrangement.spacedBy(Token.Space.md),
    ) {
        Text(
            stringResource(R.string.settings_title),
            fontSize = Type.displaySize,
            fontWeight = FontWeight.Bold,
            color = Token.Palette.text,
        )
        Spacer(Modifier.height(Token.Space.sm))

        CardSurface {
            SectionTitle(stringResource(R.string.settings_language))
            LANGUAGES.forEachIndexed { index, (code, label) ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { session.chooseLanguage(code) },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(label, fontSize = Type.bodySize, color = Token.Palette.text)
                    if (session.language == code) {
                        Text("✓", color = Token.Palette.blue, fontWeight = FontWeight.Bold)
                    }
                }
                if (index < LANGUAGES.lastIndex) Hairline()
            }
            Text(
                stringResource(R.string.settings_language_hint),
                fontSize = Type.captionSize,
                color = Token.Palette.tertiary,
            )
        }

        CardSurface {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.settings_notifications),
                        fontSize = Type.bodySize,
                        color = Token.Palette.text,
                    )
                    // La notification poussée ne coûte rien, là où chaque
                    // message WhatsApp modèle est facturé par Meta.
                    Text(
                        stringResource(R.string.settings_notifications_hint),
                        fontSize = Type.captionSize,
                        color = Token.Palette.tertiary,
                    )
                }
                Switch(
                    checked = session.notificationsEnabled,
                    onCheckedChange = { session.chooseNotifications(it) },
                    colors = SwitchDefaults.colors(checkedTrackColor = Token.Palette.blue),
                )
            }
        }

        CardSurface {
            SectionTitle(stringResource(R.string.settings_agency))
            Text(session.agencySlug, fontSize = Type.bodySize, color = Token.Palette.text)
            (session.state as? Session.State.Connecte)?.let {
                Text(it.phone, fontSize = Type.captionSize, color = Token.Palette.tertiary)
            }
        }

        CardSurface {
            TextButton(onClick = { session.signOut() }) {
                Text(stringResource(R.string.settings_sign_out), color = Token.Palette.red)
            }
            Text(
                stringResource(R.string.settings_sign_out_hint),
                fontSize = Type.captionSize,
                color = Token.Palette.tertiary,
            )
        }

        Text(
            stringResource(R.string.settings_privacy),
            fontSize = Type.microSize,
            color = Token.Palette.tertiary,
        )
    }
}
