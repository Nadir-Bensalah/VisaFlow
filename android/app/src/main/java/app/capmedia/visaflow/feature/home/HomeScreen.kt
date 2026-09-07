package app.capmedia.visaflow.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.CardSurface
import app.capmedia.visaflow.design.EmptyState
import app.capmedia.visaflow.design.Pill
import app.capmedia.visaflow.design.SectionTitle
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type
import app.capmedia.visaflow.model.MineItem
import app.capmedia.visaflow.stageLabel

/**
 * L'accueil. Tout ce que le client a chez cette agence, dossiers et
 * cargaisons mêlés, dans un seul fil. Il ne connaît pas la différence entre
 * une table `cases` et une table `shipments`, et n'a pas à l'apprendre.
 */
@Composable
fun HomeScreen(
    session: Session,
    onOpenCase: (String) -> Unit,
    onOpenShipment: (String) -> Unit,
) {
    LaunchedEffect(Unit) { session.refresh() }
    val items = session.mine?.all.orEmpty()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Token.Space.lg),
        verticalArrangement = Arrangement.spacedBy(Token.Space.md),
    ) {
        item {
            Column {
                Text(
                    stringResource(R.string.home_title),
                    fontSize = Type.displaySize,
                    fontWeight = FontWeight.Bold,
                    color = Token.Palette.text,
                )
                Spacer(Modifier.height(Token.Space.xs))
                Text(
                    stringResource(R.string.home_subtitle),
                    fontSize = Type.bodySize,
                    color = Token.Palette.secondary,
                )
                Spacer(Modifier.height(Token.Space.lg))
            }
        }

        if (items.isEmpty()) {
            item {
                CardSurface {
                    EmptyState(
                        title = stringResource(R.string.home_empty),
                        hint = stringResource(R.string.home_empty_hint),
                    )
                }
            }
        }

        items(items, key = { it.token }) { item ->
            MineRow(item) {
                when (item.kind) {
                    MineItem.Kind.CARGAISON -> onOpenShipment(item.token)
                    else -> onOpenCase(item.token)
                }
            }
        }
    }
}

@Composable
private fun MineRow(item: MineItem, onClick: () -> Unit) {
    CardSurface(modifier = Modifier.clickable(onClick = onClick), spacing = Token.Space.sm) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Token.Space.md),
        ) {
            Column(Modifier.weight(1f)) {
                SectionTitle(
                    when (item.kind) {
                        MineItem.Kind.DOSSIER -> stringResource(R.string.kind_case)
                        MineItem.Kind.CARGAISON -> stringResource(R.string.kind_shipment)
                        MineItem.Kind.DEMANDE -> stringResource(R.string.kind_request)
                    }
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    item.reference,
                    fontSize = Type.headlineSize,
                    fontWeight = FontWeight.SemiBold,
                    color = Token.Palette.text,
                )
            }
            item.stage?.let { Pill(stageLabel(it), toneFor(item.status)) }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = Token.Palette.tertiary,
            )
        }
    }
}

/** La couleur dit l'état avant que le mot soit lu. */
private fun toneFor(status: String?): Color = when (status) {
    "accepte", "livree" -> Token.Palette.green
    "refuse", "bloquee" -> Token.Palette.red
    "annule" -> Token.Palette.tertiary
    else -> Token.Palette.blue
}
