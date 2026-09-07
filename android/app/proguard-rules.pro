# kotlinx.serialization génère ses sérialiseurs à la compilation. Sans ces
# règles, la release compile mais tout appel réseau échoue au décodage.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class app.capmedia.visaflow.model.** {
    *** Companion;
}
-keepclasseswithmembers class app.capmedia.visaflow.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Tink, la bibliothèque de chiffrement derrière EncryptedSharedPreferences,
# annote son code avec errorprone, qui n'est pas dans les dépendances de
# production. R8 s'arrête sur ces classes absentes : elles ne servent qu'au
# compilateur, jamais à l'exécution.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
