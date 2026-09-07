package app.capmedia.visaflow.data

import app.capmedia.visaflow.model.Agency
import app.capmedia.visaflow.model.Appointment
import app.capmedia.visaflow.model.CaseBundle
import app.capmedia.visaflow.model.CaseDocument
import app.capmedia.visaflow.model.CaseStatus
import app.capmedia.visaflow.model.DocState
import app.capmedia.visaflow.model.MineBundle
import app.capmedia.visaflow.model.MineItem
import app.capmedia.visaflow.model.PortalMessage
import app.capmedia.visaflow.model.QueuePlace
import app.capmedia.visaflow.model.Shipment
import app.capmedia.visaflow.model.ShipmentBundle
import app.capmedia.visaflow.model.ShipmentEventItem
import app.capmedia.visaflow.model.ShipmentStage
import app.capmedia.visaflow.model.Stage
import app.capmedia.visaflow.model.VisaCase
import app.capmedia.visaflow.model.VisaKind
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Le jeu de démonstration. Il sert à trois choses : construire les écrans sans
 * serveur, tourner sur l'appareil de revue d'Apple et de Google, et faire les
 * captures. Les délais sont volontaires : une interface qui n'attend jamais
 * cache ses états de chargement, et ils ressortent en production.
 */
class DemoApi : Api {

    private var lastCode: String? = null

    private fun day(offset: Long): String =
        Instant.now().plus(offset, ChronoUnit.DAYS).toString()

    private val agency = Agency(
        name = "Tunis Consulting",
        mark = "TC",
        accent = "#0066CC",
        phone = "+216 58 746 997",
        inpdpRef = "INPDP-2026-0148",
    )

    override suspend fun requestCode(agency: String, phone: String) {
        delay(600)
        // En démonstration le code est fixe. En production il ne quitte jamais
        // le serveur, et il n'y est stocké que haché.
        lastCode = "123456"
    }

    override suspend fun verifyCode(agency: String, phone: String, code: String): String {
        delay(500)
        if (code.filter { it.isDigit() } != "123456") throw ApiError.BadCode
        return "demo-device-token"
    }

    override suspend fun mine(agency: String, deviceToken: String): MineBundle {
        delay(400)
        return MineBundle(
            ok = true,
            cases = listOf(
                MineItem("VF-2026-0148", "rendez_vous", "ouvert", "demo-case-1"),
                MineItem("VF-2026-0131", "retrait", "accepte", "demo-case-2"),
            ),
            shipments = listOf(
                MineItem("CG-2026-0044", "transit", "en_cours", "demo-ship-1"),
            ),
            requests = emptyList(),
        )
    }

    override suspend fun caseBundle(token: String): CaseBundle {
        delay(400)
        val done = token == "demo-case-2"
        return CaseBundle(
            visaCase = VisaCase(
                reference = if (done) "VF-2026-0131" else "VF-2026-0148",
                stage = if (done) Stage.RETRAIT else Stage.RENDEZ_VOUS,
                status = if (done) CaseStatus.ACCEPTE else CaseStatus.OUVERT,
                travelDate = day(34),
                balance = if (done) 0.0 else 180.0,
                currency = "TND",
            ),
            agency = agency,
            visa = VisaKind(
                country = mapOf("fr" to "France", "en" to "France", "ar" to "فرنسا", "zh" to "法国"),
                label = mapOf("fr" to "Schengen tourisme", "en" to "Schengen tourism", "ar" to "شنغن سياحة", "zh" to "申根旅游"),
                processingDays = 18,
            ),
            documents = listOf(
                CaseDocument("passeport", mapOf("fr" to "Passeport", "en" to "Passport", "ar" to "جواز السفر", "zh" to "护照"), state = DocState.VALIDEE),
                CaseDocument("photo", mapOf("fr" to "Photo d'identité", "en" to "Passport photo", "ar" to "صورة شمسية", "zh" to "证件照"), state = DocState.VALIDEE),
                CaseDocument(
                    "releves",
                    mapOf("fr" to "Relevés bancaires", "en" to "Bank statements", "ar" to "كشوف بنكية", "zh" to "银行流水"),
                    help = mapOf("fr" to "Les trois derniers mois."),
                    state = if (done) DocState.VALIDEE else DocState.MANQUANTE,
                ),
                CaseDocument(
                    "assurance",
                    mapOf("fr" to "Assurance voyage", "en" to "Travel insurance", "ar" to "تأمين سفر", "zh" to "旅行保险"),
                    state = if (done) DocState.VALIDEE else DocState.DEMANDEE,
                ),
            ),
            appointment = if (done) Appointment("retrait", day(2), "Agence, Les Berges du Lac") else null,
            // Le rang dans la file : la première question du client.
            queue = if (done) null else QueuePlace(
                rank = 4,
                total = 11,
                country = mapOf("fr" to "France", "ar" to "فرنسا", "zh" to "法国"),
                city = "Tunis",
                waitDays = 23,
            ),
            messages = listOf(
                PortalMessage("sortant", "Bonjour, il nous manque vos trois derniers relevés bancaires.", day(-2)),
                PortalMessage("entrant", "Je les envoie ce soir.", day(-2)),
            ),
        )
    }

    override suspend fun shipmentBundle(token: String): ShipmentBundle {
        delay(400)
        return ShipmentBundle(
            shipment = Shipment(
                reference = "CG-2026-0044",
                mode = "maritime_lcl",
                stage = ShipmentStage.TRANSIT,
                status = "en_cours",
                originPort = "Ningbo",
                destPort = "Radès",
                etd = day(-19),
                eta = day(16),
                packages = 34,
                weightKg = 812.0,
            ),
            agency = agency,
            events = listOf(
                ShipmentEventItem(ShipmentStage.EMPOTAGE, day(-21), "Ningbo"),
                ShipmentEventItem(ShipmentStage.DEPART, day(-19), "Ningbo"),
                // Il n'existe aucune ligne directe Chine vers Radès : le
                // transbordement est une contrainte physique, pas un incident.
                ShipmentEventItem(ShipmentStage.TRANSIT, day(-4), "Malte"),
            ),
        )
    }

    override suspend fun send(message: String, caseToken: String) {
        delay(300)
    }

    override suspend fun upload(bytes: ByteArray, fileName: String, documentKey: String, caseToken: String) {
        delay(900)
    }
}
