plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    // Tout vit sous app.capmedia. Jamais un autre préfixe.
    namespace = "app.capmedia.visaflow"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.capmedia.visaflow"
        // Android 8 couvre 98 % du parc libyen et tunisien. Descendre plus bas
        // coûterait Compose sans rien gagner.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Les quatre langues du produit. L'arabe impose le RTL, et le RTL
        // n'est pas une traduction : c'est l'ordre des colonnes, le sens des
        // flèches et la place des chiffres dans la phrase.
        resourceConfigurations += listOf("en", "fr", "ar", "zh-rCN")

        // Le backend réel, injecté à la compilation. Valeurs publiques.
        buildConfigField("String", "SUPABASE_URL", "\"https://ppzjkvgfgoxmdbbsphbr.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwemprdmdmZ294bWRiYnNwaGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MTU4MTEsImV4cCI6MjEwNDM5MTgxMX0.rQSTYZsPOdTPTccl6I8ehfW5otPCh0On05aR5auRM4Y\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true; buildConfig = true }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.graphics)
    implementation(libs.compose.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.navigation.compose)
    implementation(libs.datastore.preferences)
    implementation(libs.security.crypto)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)

    debugImplementation(libs.compose.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
