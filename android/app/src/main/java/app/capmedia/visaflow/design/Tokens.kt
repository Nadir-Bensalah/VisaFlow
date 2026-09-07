package app.capmedia.visaflow.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Les mêmes jetons que l'iOS et que le web. Une seule identité visuelle, trois
 * plateformes. Rien n'est écrit en dur ailleurs dans l'application : une
 * couleur posée à la main dans un écran est une dette, pas un raccourci.
 *
 * Valeurs reprises telles quelles de ios/Sources/Design/Tokens.swift.
 */
object Token {

    object Palette {
        val background = Color(0xFFF5F5F7)
        val card = Color.White
        val elevated = Color(0xFFFBFBFD)
        val text = Color(0xFF1D1D1F)
        val secondary = Color(0xFF4B4B50)
        val tertiary = Color(0xFF6E6E73)
        val blue = Color(0xFF0066CC)
        val green = Color(0xFF1F7A2E)
        val orange = Color(0xFFB04503)
        val red = Color(0xFFD10000)
        val violet = Color(0xFF5E5CE6)
        val hairline = Color(0x14000000)
        val sunken = Color(0x06000000)
    }

    object Space {
        val xs: Dp = 4.dp
        val sm: Dp = 8.dp
        val md: Dp = 12.dp
        val lg: Dp = 16.dp
        val xl: Dp = 24.dp
        val xxl: Dp = 32.dp
    }

    object Radius {
        val card = 18.dp
        val small = 12.dp
        val field = 10.dp
    }

    /**
     * La courbe d'apple.com. Elle démarre doucement et s'arrête longuement,
     * ce qui est exactement l'inverse d'une courbe Material par défaut.
     */
    val easing = CubicBezierEasing(0.28f, 0.11f, 0.32f, 1f)

    fun <T> ease(durationMillis: Int = 300) = tween<T>(durationMillis, easing = easing)
}

/**
 * La carte du produit : un filet, jamais une ombre. L'ombre est réservée à ce
 * qui est réellement au-dessus, une feuille ou une alerte. C'est la règle qui
 * distingue le plus vite une interface Apple d'une interface Material.
 */
@Composable
fun CardSurface(
    modifier: Modifier = Modifier,
    padding: Dp = Token.Space.lg,
    spacing: Dp = Token.Space.md,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    androidx.compose.foundation.layout.Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Token.Radius.card))
            .background(Token.Palette.card)
            .border(1.dp, Token.Palette.hairline, RoundedCornerShape(Token.Radius.card))
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

/** Les gouttières de l'écran, identiques partout. */
val ScreenPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp)

object Type {
    val displaySize = 34.sp
    val titleSize = 22.sp
    val headlineSize = 17.sp
    val bodySize = 16.sp
    val captionSize = 13.sp
    val microSize = 11.sp
}
