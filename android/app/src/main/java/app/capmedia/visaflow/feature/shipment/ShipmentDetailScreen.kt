package app.capmedia.visaflow.feature.shipment

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.capmedia.visaflow.R
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.CardSurface
import app.capmedia.visaflow.design.KeyValue
import app.capmedia.visaflow.design.SectionTitle
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.design.Type
import app.capmedia.visaflow.model.ShipmentBundle
import app.capmedia.visaflow.shipStageLabel
import app.capmedia.visaflow.shortDate

/**
 * La cargaison. Le client veut savoir où est sa marchandise et quand elle
 * arrive. Le fil des étapes le dit mieux qu'un statut : il montre aussi le
 * transbordement, qui est la vraie source de retard sur la route de Chine.
 */
@Composable
fun ShipmentDetailScreen(session: Session, token: String) {
    var bundle by remember { mutableStateOf<ShipmentBundle?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(token) {
        try {
            bundle = session.api.shipmentBundle(token)
        } catch (e: Exception) {
            error = e.message
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
                SectionTitle(stringResource(R.string.kind_shipment))
                Text(
                    data.shipment.reference,
                    fontSize = Type.titleSize,
                    fontWeight = FontWeight.Bold,
                    color = Token.Palette.text,
                )
                Text(
                    shipStageLabel(data.shipment.stage.name.lowercase()),
                    fontSize = Type.bodySize,
                    color = Token.Palette.blue,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        item {
            CardSurface {
                data.shipment.originPort?.let {
                    KeyValue(stringResource(R.string.ship_from), it)
                }
                data.shipment.destPort?.let {
                    KeyValue(stringResource(R.string.ship_to), it)
                }
                KeyValue(stringResource(R.string.ship_etd), shortDate(data.shipment.etd))
                KeyValue(stringResource(R.string.ship_eta), shortDate(data.shipment.eta))
                data.shipment.packages?.let {
                    KeyValue(stringResource(R.string.ship_packages), it.toString())
                }
                data.shipment.weightKg?.let {
                    KeyValue(stringResource(R.string.ship_weight), "${it.toInt()} kg")
                }
            }
        }

        data.shipment.blockedReason?.let {
            item {
                CardSurface {
                    SectionTitle(stringResource(R.string.ship_blocked))
                    Text(it, fontSize = Type.bodySize, color = Token.Palette.red)
                }
            }
        }

        item {
            CardSurface {
                SectionTitle(stringResource(R.string.ship_timeline))
                data.events.forEachIndexed { index, event ->
                    Row(verticalAlignment = Alignment.Top) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                Modifier
                                    .size(9.dp)
                                    .clip(CircleShape)
                                    .background(Token.Palette.blue),
                            )
                            if (index < data.events.lastIndex) {
                                Box(
                                    Modifier
                                        .width(1.dp)
                                        .height(34.dp)
                                        .background(Token.Palette.hairline),
                                )
                            }
                        }
                        Spacer(Modifier.width(Token.Space.md))
                        Column(Modifier.fillMaxWidth()) {
                            Text(
                                shipStageLabel(event.stage.name.lowercase()),
                                fontSize = Type.bodySize,
                                fontWeight = FontWeight.Medium,
                                color = Token.Palette.text,
                            )
                            Text(
                                listOfNotNull(shortDate(event.at), event.location).joinToString(" · "),
                                fontSize = Type.captionSize,
                                color = Token.Palette.tertiary,
                            )
                            Spacer(Modifier.height(Token.Space.md))
                        }
                    }
                }
            }
        }
    }
}
