package app.capmedia.visaflow.feature.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.EmptyState
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type
import app.capmedia.visaflow.model.PortalMessage
import app.capmedia.visaflow.shortDate
import kotlinx.coroutines.launch

/**
 * La conversation. Elle remplace le fil WhatsApp de l'employé : ici, le
 * message reste attaché au dossier, et il survit au départ de la personne qui
 * l'a écrit.
 */
@Composable
fun MessagesScreen(session: Session, caseToken: String) {
    var messages by remember { mutableStateOf<List<PortalMessage>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        runCatching { session.api.caseBundle(caseToken) }
            .onSuccess { messages = it.messages }
    }

    LaunchedEffect(caseToken) { load() }

    Column(Modifier.fillMaxSize()) {
        if (messages.isEmpty()) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                EmptyState(stringResource(R.string.messages_empty))
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(Token.Space.lg),
                verticalArrangement = Arrangement.spacedBy(Token.Space.sm),
            ) {
                items(messages) { message ->
                    Bubble(message)
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(Token.Space.md),
            horizontalArrangement = Arrangement.spacedBy(Token.Space.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(R.string.messages_placeholder)) },
                shape = RoundedCornerShape(Token.Radius.field),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Token.Palette.blue,
                    unfocusedBorderColor = Token.Palette.hairline,
                ),
            )
            TextButton(
                enabled = draft.isNotBlank() && !sending,
                onClick = {
                    val body = draft.trim()
                    draft = ""
                    sending = true
                    scope.launch {
                        runCatching { session.api.send(body, caseToken) }
                        load()
                        sending = false
                    }
                },
            ) {
                Text(stringResource(R.string.messages_send), color = Token.Palette.blue)
            }
        }
    }
}

@Composable
private fun Bubble(message: PortalMessage) {
    val mine = !message.fromAgency
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        Box(
            Modifier
                .clip(RoundedCornerShape(Token.Radius.small))
                .background(if (mine) Token.Palette.blue.copy(alpha = 0.10f) else Token.Palette.sunken)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Text(message.body, fontSize = Type.bodySize, color = Token.Palette.text)
        }
        Text(
            shortDate(message.at),
            fontSize = Type.microSize,
            color = Token.Palette.tertiary,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
        )
    }
}
