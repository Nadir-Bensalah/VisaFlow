package app.capmedia.visaflow.feature.case

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.CardSurface
import app.capmedia.visaflow.design.KeyValue
import app.capmedia.visaflow.design.Pill
import app.capmedia.visaflow.design.ProgressBar
import app.capmedia.visaflow.design.SectionTitle
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type
import app.capmedia.visaflow.docStateLabel
import app.capmedia.visaflow.model.CaseBundle
import app.capmedia.visaflow.model.DocState
import app.capmedia.visaflow.shortDate
import app.capmedia.visaflow.stageLabel
import kotlinx.coroutines.launch

/**
 * Le dossier vu par le client. Trois questions, dans cet ordre : où en
 * est-il, que manque-t-il, et quand est le rendez-vous. Tout le reste est du
 * détail d'agence, et n'a rien à faire ici.
 */
@Composable
fun CaseDetailScreen(session: Session, token: String) {
    var bundle by remember { mutableStateOf<CaseBundle?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val locale = session.language

    suspend fun load() {
        try {
            bundle = session.api.caseBundle(token)
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }

    LaunchedEffect(token) { load() }

    // Le geste naturel du client est la photo prise avec son téléphone. Le
    // sélecteur système ouvre l'appareil photo et la galerie sans demander la
    // moindre permission : une permission refusée bloquerait le dépôt.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        val key = uploading
        uploading = null
        if (uri == null || key == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: return@launch
                session.api.upload(bytes, uri.lastPathSegment ?: "piece", key, token)
                load()
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    val data = bundle
    if (data == null) {
        Column(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(error ?: stringResource(R.string.loading), color = Token.Palette.secondary)
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Token.Space.lg),
        verticalArrangement = Arrangement.spacedBy(Token.Space.md),
    ) {
        item {
            CardSurface {
                SectionTitle(data.visa.title(locale))
                Text(
                    data.visaCase.reference,
                    fontSize = Type.titleSize,
                    fontWeight = FontWeight.Bold,
                    color = Token.Palette.text,
                )
                Spacer(Modifier.height(Token.Space.xs))
                ProgressBar(data.progress)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stageLabel(data.visaCase.stage.name.lowercase()),
                        color = Token.Palette.secondary,
                        fontSize = Type.captionSize,
                    )
                    Text(
                        "${(data.progress * 100).toInt()} %",
                        color = Token.Palette.tertiary,
                        fontSize = Type.captionSize,
                    )
                }
            }
        }

        // Le rang dans la file. C'est la première question du client, et
        // personne d'autre ne sait y répondre.
        data.queue?.let { place ->
            item {
                CardSurface {
                    SectionTitle(stringResource(R.string.queue_title))
                    Text(
                        place.rank.toString(),
                        fontSize = Type.displaySize,
                        fontWeight = FontWeight.Bold,
                        color = Token.Palette.text,
                    )
                    Text(
                        stringResource(R.string.queue_rank, place.rank, place.total, place.place(locale)),
                        fontSize = Type.bodySize,
                        color = Token.Palette.secondary,
                    )
                    place.waitDays?.let {
                        Text(
                            stringResource(R.string.queue_wait, it),
                            fontSize = Type.captionSize,
                            color = Token.Palette.tertiary,
                        )
                    }
                }
            }
        }

        item {
            CardSurface {
                SectionTitle(stringResource(R.string.case_documents))
                if (data.missing.isEmpty()) {
                    Text(
                        stringResource(R.string.case_all_good),
                        color = Token.Palette.green,
                        fontSize = Type.bodySize,
                        fontWeight = FontWeight.Medium,
                    )
                } else {
                    data.documents.forEach { doc ->
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Token.Space.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    doc.title(locale),
                                    fontSize = Type.bodySize,
                                    color = Token.Palette.text,
                                    fontWeight = FontWeight.Medium,
                                )
                                doc.rejectionReason?.let {
                                    Text(it, fontSize = Type.captionSize, color = Token.Palette.red)
                                }
                                doc.hint(locale)?.let {
                                    Text(it, fontSize = Type.captionSize, color = Token.Palette.tertiary)
                                }
                            }
                            Pill(docStateLabel(doc.state.name.lowercase()), toneFor(doc.state))
                            if (doc.state.isPending) {
                                TextButton(onClick = { uploading = doc.key; picker.launch("*/*") }) {
                                    Text(stringResource(R.string.case_upload), color = Token.Palette.blue)
                                }
                            }
                        }
                        Spacer(Modifier.height(Token.Space.xs))
                    }
                }
            }
        }

        data.appointment?.let { appt ->
            item {
                CardSurface {
                    SectionTitle(stringResource(R.string.case_appointment))
                    Text(
                        shortDate(appt.at),
                        fontSize = Type.titleSize,
                        fontWeight = FontWeight.SemiBold,
                        color = Token.Palette.text,
                    )
                    appt.location?.let {
                        Text(it, fontSize = Type.bodySize, color = Token.Palette.secondary)
                    }
                }
            }
        }

        if (data.visaCase.balance > 0) {
            item {
                CardSurface {
                    SectionTitle(stringResource(R.string.case_balance))
                    KeyValue(
                        stringResource(R.string.case_balance),
                        "${data.visaCase.balance.toInt()} ${data.visaCase.currency}",
                    )
                    // On dit le solde, on ne l'encaisse pas. Collecter pour le
                    // compte d'un tiers exige un agrément de la Banque Centrale.
                    Text(
                        stringResource(R.string.case_balance_hint),
                        fontSize = Type.captionSize,
                        color = Token.Palette.tertiary,
                    )
                }
            }
        }

        data.visaCase.refusalReason?.let {
            item {
                CardSurface {
                    SectionTitle(stringResource(R.string.case_refused))
                    Text(it, fontSize = Type.bodySize, color = Token.Palette.red)
                }
            }
        }
    }
}

private fun toneFor(state: DocState) = when (state) {
    DocState.VALIDEE -> Token.Palette.green
    DocState.REFUSEE, DocState.MANQUANTE -> Token.Palette.red
    DocState.EXPIREE, DocState.DEMANDEE -> Token.Palette.orange
    DocState.RECUE -> Token.Palette.blue
}
