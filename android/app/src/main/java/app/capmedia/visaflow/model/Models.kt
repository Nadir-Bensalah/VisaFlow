package app.capmedia.visaflow.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Le modèle vu par le client, calqué sur ios/Sources/Model/Models.swift.
 * Il ne contient que ce que le serveur accepte de lui envoyer : pas de note
 * interne, pas de coût de fret, pas de référence consulat. Ce qui n'est pas là
 * ne peut pas fuiter.
 */

@Serializable
enum class Stage {
    @SerialName("nouveau") NOUVEAU,
    @SerialName("pieces") PIECES,
    @SerialName("verification") VERIFICATION,
    @SerialName("rendez_vous") RENDEZ_VOUS,
    @SerialName("depot") DEPOT,
    @SerialName("consulat") CONSULAT,
    @SerialName("decision") DECISION,
    @SerialName("retrait") RETRAIT,
    @SerialName("clos") CLOS;

    val key: String get() = "stage_" + name.lowercase()
}

@Serializable
enum class ShipmentStage {
    @SerialName("demande") DEMANDE,
    @SerialName("ramassage") RAMASSAGE,
    @SerialName("entrepot") ENTREPOT,
    @SerialName("empotage") EMPOTAGE,
    @SerialName("depart") DEPART,
    @SerialName("transit") TRANSIT,
    @SerialName("arrivee") ARRIVEE,
    @SerialName("douane") DOUANE,
    @SerialName("livraison") LIVRAISON,
    @SerialName("livre") LIVRE;

    val key: String get() = "ship_" + name.lowercase()
}

@Serializable
enum class CaseStatus {
    @SerialName("ouvert") OUVERT,
    @SerialName("accepte") ACCEPTE,
    @SerialName("refuse") REFUSE,
    @SerialName("annule") ANNULE,
}

@Serializable
enum class DocState {
    @SerialName("manquante") MANQUANTE,
    @SerialName("demandee") DEMANDEE,
    @SerialName("recue") RECUE,
    @SerialName("validee") VALIDEE,
    @SerialName("refusee") REFUSEE,
    @SerialName("expiree") EXPIREE;

    val isPending: Boolean get() = this != VALIDEE
    val key: String get() = "doc_" + name.lowercase()
}

@Serializable
data class Agency(
    val name: String,
    val mark: String = "",
    val accent: String? = null,
    val phone: String? = null,
    @SerialName("inpdp_ref") val inpdpRef: String? = null,
)

@Serializable
data class CaseDocument(
    val key: String,
    val label: Map<String, String> = emptyMap(),
    val help: Map<String, String>? = null,
    val state: DocState,
    val required: Boolean = true,
    @SerialName("received_at") val receivedAt: String? = null,
    @SerialName("rejection_reason") val rejectionReason: String? = null,
) {
    fun title(locale: String): String = label[locale] ?: label["fr"] ?: key
    fun hint(locale: String): String? = help?.get(locale) ?: help?.get("fr")
}

@Serializable
data class Appointment(
    val kind: String,
    val at: String,
    val location: String? = null,
)

@Serializable
data class PortalMessage(
    val direction: String,
    val body: String,
    val at: String,
) {
    val fromAgency: Boolean get() = direction == "sortant"
}

@Serializable
data class VisaCase(
    val reference: String,
    val stage: Stage,
    val status: CaseStatus,
    @SerialName("travel_date") val travelDate: String? = null,
    @SerialName("decision_at") val decisionAt: String? = null,
    @SerialName("refusal_reason") val refusalReason: String? = null,
    val balance: Double = 0.0,
    val currency: String = "TND",
)

@Serializable
data class VisaKind(
    val country: Map<String, String> = emptyMap(),
    val label: Map<String, String> = emptyMap(),
    @SerialName("processing_days") val processingDays: Int = 0,
) {
    fun title(locale: String): String {
        val c = country[locale] ?: country["fr"] ?: ""
        val l = label[locale] ?: label["fr"] ?: ""
        return if (c.isEmpty()) l else "$c · $l"
    }
}

/**
 * Le rang dans la file de créneaux. C'est la première question du client, et
 * aucune agence tunisienne ne sait y répondre aujourd'hui.
 */
@Serializable
data class QueuePlace(
    val rank: Int,
    val total: Int,
    val country: Map<String, String> = emptyMap(),
    val city: String = "",
    @SerialName("wait_days") val waitDays: Int? = null,
) {
    fun place(locale: String): String {
        val c = country[locale] ?: country["fr"] ?: ""
        return if (city.isEmpty()) c else "$c · $city"
    }
}

/** Ce que rend `portal_case` côté serveur, tel quel. */
@Serializable
data class CaseBundle(
    @SerialName("case") val visaCase: VisaCase,
    val agency: Agency,
    val visa: VisaKind,
    val documents: List<CaseDocument> = emptyList(),
    val appointment: Appointment? = null,
    val queue: QueuePlace? = null,
    val messages: List<PortalMessage> = emptyList(),
) {
    val missing: List<CaseDocument> get() = documents.filter { it.state.isPending }

    /** L'avancement, calculé sur les pièces obligatoires validées. */
    val progress: Float
        get() {
            val required = documents.filter { it.required }
            if (required.isEmpty()) return 0f
            return required.count { it.state == DocState.VALIDEE }.toFloat() / required.size
        }
}

@Serializable
data class ShipmentEventItem(
    val stage: ShipmentStage,
    val at: String,
    val location: String? = null,
)

@Serializable
data class Shipment(
    val reference: String,
    val mode: String = "",
    val stage: ShipmentStage,
    val status: String = "",
    @SerialName("origin_port") val originPort: String? = null,
    @SerialName("dest_port") val destPort: String? = null,
    val etd: String? = null,
    val eta: String? = null,
    @SerialName("delivered_at") val deliveredAt: String? = null,
    @SerialName("blocked_reason") val blockedReason: String? = null,
    val packages: Int? = null,
    @SerialName("weight_kg") val weightKg: Double? = null,
)

@Serializable
data class ShipmentBundle(
    val shipment: Shipment,
    val agency: Agency,
    val events: List<ShipmentEventItem> = emptyList(),
)

/** Une ligne de la page d'accueil : un dossier, une cargaison ou une demande. */
@Serializable
data class MineItem(
    val reference: String,
    val stage: String? = null,
    val status: String? = null,
    val token: String,
) {
    enum class Kind { DOSSIER, CARGAISON, DEMANDE }

    /** Posé par le client selon la liste d'origine : le serveur ne l'envoie pas. */
    @kotlinx.serialization.Transient
    var kind: Kind = Kind.DOSSIER
}

@Serializable
data class MineBundle(
    val ok: Boolean = false,
    val cases: List<MineItem> = emptyList(),
    val shipments: List<MineItem> = emptyList(),
    val requests: List<MineItem> = emptyList(),
) {
    val all: List<MineItem>
        get() = cases.map { it.also { x -> x.kind = MineItem.Kind.DOSSIER } } +
            shipments.map { it.also { x -> x.kind = MineItem.Kind.CARGAISON } } +
            requests.map { it.also { x -> x.kind = MineItem.Kind.DEMANDE } }
}
