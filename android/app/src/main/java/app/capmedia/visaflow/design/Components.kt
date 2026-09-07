package app.capmedia.visaflow.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Les briques partagées. Elles portent les décisions de style pour que les
 *  écrans ne portent que la logique. */

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        color = Token.Palette.tertiary,
        fontSize = Type.captionSize,
        fontWeight = FontWeight.Medium,
        letterSpacing = androidx.compose.ui.unit.TextUnit(0.06f, androidx.compose.ui.unit.TextUnitType.Em),
    )
}

@Composable
fun Pill(text: String, tone: Color) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(tone.copy(alpha = 0.12f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, color = tone, fontSize = Type.microSize, fontWeight = FontWeight.SemiBold)
    }
}

/** L'avancement du dossier. Un filet plein, pas un anneau : la progression se
 *  lit d'un coup d'œil au bout du bras, pas en s'approchant. */
@Composable
fun ProgressBar(fraction: Float, modifier: Modifier = Modifier, tone: Color = Token.Palette.blue) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(CircleShape)
            .background(Token.Palette.sunken),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(fraction.coerceIn(0.02f, 1f))
                .height(6.dp)
                .clip(CircleShape)
                .background(tone),
        )
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(50.dp),
        enabled = enabled && !busy,
        shape = RoundedCornerShape(Token.Radius.field),
        colors = ButtonDefaults.buttonColors(
            containerColor = Token.Palette.blue,
            contentColor = Color.White,
            disabledContainerColor = Token.Palette.blue.copy(alpha = 0.35f),
            disabledContentColor = Color.White.copy(alpha = 0.8f),
        ),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                color = Color.White,
                strokeWidth = 2.dp,
            )
        } else {
            Text(text, fontSize = Type.headlineSize, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun KeyValue(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Text(label, color = Token.Palette.secondary, fontSize = Type.bodySize)
        Text(
            value,
            color = Token.Palette.text,
            fontSize = Type.bodySize,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.End,
        )
    }
}

/** Le vide n'est pas une erreur. Il se dit avec une phrase, pas avec un blanc. */
@Composable
fun EmptyState(title: String, hint: String? = null) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Token.Space.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Token.Space.sm),
    ) {
        Text(title, color = Token.Palette.secondary, fontSize = Type.bodySize, textAlign = TextAlign.Center)
        if (hint != null) {
            Text(hint, color = Token.Palette.tertiary, fontSize = Type.captionSize, textAlign = TextAlign.Center)
        }
    }
}

@Composable
fun Hairline() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Token.Palette.hairline))
}

@Composable
fun BorderedBox(content: @Composable () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(Token.Radius.small))
            .border(1.dp, Token.Palette.hairline, RoundedCornerShape(Token.Radius.small))
            .padding(Token.Space.md),
    ) { content() }
}
