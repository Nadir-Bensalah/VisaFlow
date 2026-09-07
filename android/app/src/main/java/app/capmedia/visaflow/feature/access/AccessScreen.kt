package app.capmedia.visaflow.feature.access

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.PrimaryButton
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type

/**
 * L'entrée. Pas de mot de passe, pas de compte à créer : le numéro est
 * l'identité. Un client de guichet n'a pas d'adresse électronique active, il a
 * un téléphone, et c'est ce numéro que l'agence connaît déjà.
 */
@Composable
fun PhoneScreen(session: Session) {
    var phone by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Token.Space.xl),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.access_title),
            fontSize = Type.displaySize,
            fontWeight = FontWeight.Bold,
            color = Token.Palette.text,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Token.Space.sm))
        Text(
            stringResource(R.string.access_subtitle),
            fontSize = Type.bodySize,
            color = Token.Palette.secondary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Token.Space.xxl))

        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.access_phone)) },
            singleLine = true,
            // Le clavier téléphonique, pas le clavier texte : un numéro se
            // tape à une main, dans une file d'attente.
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            shape = RoundedCornerShape(Token.Radius.field),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Token.Palette.blue,
                unfocusedBorderColor = Token.Palette.hairline,
            ),
        )

        Spacer(Modifier.height(Token.Space.lg))
        PrimaryButton(
            text = stringResource(R.string.access_send),
            onClick = { session.requestCode(phone) },
            enabled = phone.filter { it.isDigit() }.length >= 6,
            busy = session.busy,
        )

        session.lastError?.let {
            Spacer(Modifier.height(Token.Space.md))
            Text(it, color = Token.Palette.red, fontSize = Type.captionSize, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(Token.Space.xl))
        Text(
            stringResource(R.string.access_privacy),
            fontSize = Type.microSize,
            color = Token.Palette.tertiary,
            textAlign = TextAlign.Center,
        )
    }
}

/** Le code à usage unique. Six chiffres, une seule fois, et l'appareil est
 *  ensuite reconnu quatre-vingt-dix jours. */
@Composable
fun CodeScreen(session: Session, phone: String) {
    var code by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Token.Space.xl),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.code_title),
            fontSize = Type.titleSize,
            fontWeight = FontWeight.Bold,
            color = Token.Palette.text,
        )
        Spacer(Modifier.height(Token.Space.sm))
        Text(
            stringResource(R.string.code_sent_to, phone),
            fontSize = Type.bodySize,
            color = Token.Palette.secondary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Token.Space.xxl))

        OutlinedTextField(
            value = code,
            onValueChange = { if (it.length <= 6) code = it.filter { c -> c.isDigit() } },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.code_label)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            shape = RoundedCornerShape(Token.Radius.field),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Token.Palette.blue,
                unfocusedBorderColor = Token.Palette.hairline,
            ),
        )

        Spacer(Modifier.height(Token.Space.lg))
        PrimaryButton(
            text = stringResource(R.string.code_confirm),
            onClick = { session.verify(code) },
            enabled = code.length == 6,
            busy = session.busy,
        )

        session.lastError?.let {
            Spacer(Modifier.height(Token.Space.md))
            Text(it, color = Token.Palette.red, fontSize = Type.captionSize, textAlign = TextAlign.Center)
        }

        Spacer(Modifier.height(Token.Space.md))
        TextButton(onClick = { session.back() }) {
            Text(stringResource(R.string.code_change_number), color = Token.Palette.blue)
        }
    }
}
