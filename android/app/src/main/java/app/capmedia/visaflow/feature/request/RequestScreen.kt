package app.capmedia.visaflow.feature.request

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.CardSurface
import app.capmedia.visaflow.design.PrimaryButton
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type

/**
 * Une nouvelle demande. Elle n'ouvre pas un dossier : personne n'a encore
 * décidé de la prendre. C'est l'agence qui convertit, après avoir regardé.
 */
@Composable
fun RequestScreen(session: Session, onSent: () -> Unit) {
    var destination by remember { mutableStateOf("") }
    var travelDate by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Token.Space.lg),
        verticalArrangement = Arrangement.spacedBy(Token.Space.md),
    ) {
        Text(
            stringResource(R.string.request_title),
            fontSize = Type.displaySize,
            fontWeight = FontWeight.Bold,
            color = Token.Palette.text,
        )
        Text(
            stringResource(R.string.request_subtitle),
            fontSize = Type.bodySize,
            color = Token.Palette.secondary,
        )
        Spacer(Modifier.height(Token.Space.sm))

        CardSurface {
            OutlinedTextField(
                value = destination,
                onValueChange = { destination = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.request_destination)) },
                singleLine = true,
                shape = RoundedCornerShape(Token.Radius.field),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Token.Palette.blue,
                    unfocusedBorderColor = Token.Palette.hairline,
                ),
            )
            OutlinedTextField(
                value = travelDate,
                onValueChange = { travelDate = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.request_when)) },
                singleLine = true,
                shape = RoundedCornerShape(Token.Radius.field),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Token.Palette.blue,
                    unfocusedBorderColor = Token.Palette.hairline,
                ),
            )
            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.request_note)) },
                minLines = 3,
                shape = RoundedCornerShape(Token.Radius.field),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Token.Palette.blue,
                    unfocusedBorderColor = Token.Palette.hairline,
                ),
            )
        }

        PrimaryButton(
            text = stringResource(if (sent) R.string.request_sent else R.string.request_send),
            onClick = { sent = true; onSent() },
            enabled = destination.isNotBlank() && !sent,
        )

        Text(
            stringResource(R.string.request_hint),
            fontSize = Type.captionSize,
            color = Token.Palette.tertiary,
        )
    }
}
