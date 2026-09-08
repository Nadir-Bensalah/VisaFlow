package app.capmedia.visaflow

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.capmedia.visaflow.data.Api
import app.capmedia.visaflow.data.DemoApi
import app.capmedia.visaflow.data.LiveApi
import app.capmedia.visaflow.data.Session
import app.capmedia.visaflow.design.Token
import app.capmedia.visaflow.feature.access.CodeScreen
import app.capmedia.visaflow.feature.access.PhoneScreen
import app.capmedia.visaflow.feature.case.CaseDetailScreen
import app.capmedia.visaflow.feature.home.HomeScreen
import app.capmedia.visaflow.feature.messages.MessagesScreen
import app.capmedia.visaflow.feature.settings.SettingsScreen
import app.capmedia.visaflow.feature.shipment.ShipmentDetailScreen
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.runtime.CompositionLocalProvider

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // `adb shell am start … --ez connecte true` ouvre l'app déjà connectée,
        // pour les captures et les tests d'interface.
        val demo = intent?.getBooleanExtra("connecte", false) == true
        setContent { VisaFlowApp(demoSignedIn = demo) }
    }
}

/**
 * Le thème. Material3 sert de charpente, mais toutes les couleurs viennent
 * des jetons du produit : une application qui prend les couleurs par défaut
 * de Material ne ressemble à rien d'autre qu'à Material.
 */
private val Scheme = lightColorScheme(
    primary = Token.Palette.blue,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    background = Token.Palette.background,
    onBackground = Token.Palette.text,
    surface = Token.Palette.card,
    onSurface = Token.Palette.text,
    error = Token.Palette.red,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VisaFlowApp(demoSignedIn: Boolean = false) {
    val context = androidx.compose.ui.platform.LocalContext.current
    // Le backend réel si l'application est configurée, sinon la démonstration.
    // Les deux valeurs sont publiques : la clé anon vit dans l'app, ce sont les
    // politiques qui protègent.
    val api: Api = remember(demoSignedIn) {
        // La démonstration (captures, revue) garde ses données fictives ; le
        // reste du temps, le vrai backend.
        val url = BuildConfig.SUPABASE_URL
        val key = BuildConfig.SUPABASE_ANON_KEY
        if (demoSignedIn || url.isBlank() || key.isBlank()) DemoApi() else LiveApi(url, key)
    }
    val session: Session = viewModel(factory = Session.factory(context, api, demoSignedIn))

    // La langue choisie doit vraiment repeindre l'app : les textes (stringResource
    // lit les ressources du contexte) ET le sens de lecture. Sans ça, choisir
    // l'arabe ne changeait rien, l'app restait en français aligné à gauche.
    val locale = remember(session.language) {
        when (session.language) {
            "ar" -> java.util.Locale("ar")
            "en" -> java.util.Locale.ENGLISH
            "zh" -> java.util.Locale.SIMPLIFIED_CHINESE
            else -> java.util.Locale.FRENCH
        }
    }
    val localized = remember(locale) {
        val config = android.content.res.Configuration(context.resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        context.createConfigurationContext(config)
    }
    val direction = if (session.language == "ar") LayoutDirection.Rtl else LayoutDirection.Ltr

    CompositionLocalProvider(
        androidx.compose.ui.platform.LocalContext provides localized,
        androidx.compose.ui.platform.LocalConfiguration provides localized.resources.configuration,
        LocalLayoutDirection provides direction,
    ) {
        MaterialTheme(colorScheme = Scheme) {
            when (val state = session.state) {
                is Session.State.Anonyme -> Surface { PhoneScreen(session) }
                is Session.State.AttenteCode -> Surface { CodeScreen(session, state.phone) }
                is Session.State.Connecte -> SignedIn(session)
            }
        }
    }
}

@Composable
private fun Surface(content: @Composable () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Token.Palette.background),
    ) { content() }
}

private sealed class Tab(val route: String, val labelRes: Int) {
    data object Home : Tab("accueil", R.string.tab_home)
    data object Messages : Tab("messages", R.string.tab_messages)
    data object Settings : Tab("reglages", R.string.tab_settings)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SignedIn(session: Session) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val tabs = listOf(Tab.Home, Tab.Messages, Tab.Settings)
    val onDetail = route?.startsWith("dossier/") == true || route?.startsWith("cargaison/") == true

    Scaffold(
        containerColor = Token.Palette.background,
        topBar = {
            if (onDetail) {
                TopAppBar(
                    title = { Text(stringResource(R.string.app_name)) },
                    navigationIcon = {
                        IconButton(onClick = { nav.popBackStack() }) {
                            // Le chevron se retourne tout seul en arabe :
                            // AutoMirrored, jamais l'icône fixe.
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Token.Palette.background,
                        titleContentColor = Token.Palette.text,
                    ),
                )
            }
        },
        bottomBar = {
            if (!onDetail) {
                NavigationBar(containerColor = Token.Palette.card) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = route == tab.route,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(Tab.Home.route) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    when (tab) {
                                        Tab.Home -> Icons.Default.Home
                                        Tab.Messages -> Icons.Default.MailOutline
                                        Tab.Settings -> Icons.Default.Settings
                                    },
                                    contentDescription = null,
                                )
                            },
                            label = { Text(stringResource(tab.labelRes)) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Token.Palette.blue,
                                selectedTextColor = Token.Palette.blue,
                                indicatorColor = Token.Palette.blue.copy(alpha = 0.10f),
                                unselectedIconColor = Token.Palette.tertiary,
                                unselectedTextColor = Token.Palette.tertiary,
                            ),
                        )
                    }
                }
            }
        },
    ) { inner ->
        NavHost(
            navController = nav,
            startDestination = Tab.Home.route,
            modifier = Modifier.padding(inner),
        ) {
            composable(Tab.Home.route) {
                HomeScreen(
                    session = session,
                    onOpenCase = { nav.navigate("dossier/$it") },
                    onOpenShipment = { nav.navigate("cargaison/$it") },
                )
            }
            composable(Tab.Messages.route) {
                val first = session.mine?.cases?.firstOrNull()?.token
                if (first == null) {
                    Surface {
                        app.capmedia.visaflow.design.EmptyState(stringResource(R.string.messages_empty))
                    }
                } else {
                    MessagesScreen(session, first)
                }
            }
            composable(Tab.Settings.route) { SettingsScreen(session) }
            composable(
                route = "dossier/{token}",
                arguments = listOf(navArgument("token") { type = NavType.StringType }),
            ) { backStack ->
                CaseDetailScreen(session, backStack.arguments?.getString("token").orEmpty())
            }
            composable(
                route = "cargaison/{token}",
                arguments = listOf(navArgument("token") { type = NavType.StringType }),
            ) { backStack ->
                ShipmentDetailScreen(session, backStack.arguments?.getString("token").orEmpty())
            }
        }
    }
}
