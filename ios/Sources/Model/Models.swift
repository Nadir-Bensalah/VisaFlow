import Foundation

/// Le modèle vu par le client. Il ne contient que ce que le serveur accepte de
/// lui envoyer : pas de note interne, pas de coût de fret, pas de référence
/// consulat. Ce qui n'est pas là ne peut pas fuiter.

enum Stage: String, Codable, CaseIterable, Sendable {
    case nouveau, pieces, verification, rendez_vous, depot
    case consulat, decision, retrait, clos

    var titleKey: String { "stage.\(rawValue)" }
}

enum ShipmentStage: String, Codable, CaseIterable, Sendable {
    case demande, ramassage, entrepot, empotage, depart
    case transit, arrivee, douane, livraison, livre

    var titleKey: String { "ship.\(rawValue)" }
}

enum CaseStatus: String, Codable, Sendable {
    case ouvert, accepte, refuse, annule
}

enum DocState: String, Codable, Sendable {
    case manquante, demandee, recue, validee, refusee, expiree

    var isPending: Bool { self != .validee }
    var titleKey: String { "doc.\(rawValue)" }
}

struct Agency: Codable, Sendable, Hashable {
    var name: String
    var mark: String
    var accent: String?
    var phone: String?
    var inpdpRef: String?

    enum CodingKeys: String, CodingKey {
        case name, mark, accent, phone
        case inpdpRef = "inpdp_ref"
    }
}

struct CaseDocument: Codable, Sendable, Hashable, Identifiable {
    var key: String
    var label: [String: String]
    var help: [String: String]?
    var state: DocState
    var required: Bool
    var receivedAt: Date?
    var rejectionReason: String?

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, label, help, state, required
        case receivedAt = "received_at"
        case rejectionReason = "rejection_reason"
    }

    func title(_ locale: String) -> String { label[locale] ?? label["fr"] ?? key }
    func hint(_ locale: String) -> String? { help?[locale] ?? help?["fr"] }
}

struct Appointment: Codable, Sendable, Hashable {
    var kind: String
    var at: Date
    var location: String?
}

struct PortalMessage: Codable, Sendable, Hashable, Identifiable {
    var direction: String
    var body: String
    var at: Date

    var id: String { "\(at.timeIntervalSince1970)-\(body.hashValue)" }
    var fromAgency: Bool { direction == "sortant" }
}

struct VisaCase: Codable, Sendable, Hashable, Identifiable {
    var reference: String
    var stage: Stage
    var status: CaseStatus
    var travelDate: Date?
    var decisionAt: Date?
    var refusalReason: String?
    var balance: Double
    var currency: String

    var id: String { reference }

    enum CodingKeys: String, CodingKey {
        case reference, stage, status, balance, currency
        case travelDate = "travel_date"
        case decisionAt = "decision_at"
        case refusalReason = "refusal_reason"
    }
}

struct VisaKind: Codable, Sendable, Hashable {
    var country: [String: String]
    var label: [String: String]
    var processingDays: Int

    enum CodingKeys: String, CodingKey {
        case country, label
        case processingDays = "processing_days"
    }

    func title(_ locale: String) -> String {
        let c = country[locale] ?? country["fr"] ?? ""
        let l = label[locale] ?? label["fr"] ?? ""
        return c.isEmpty ? l : "\(c) · \(l)"
    }
}

/// Ce que rend `portal_case` côté serveur, tel quel.
struct CaseBundle: Codable, Sendable {
    var visaCase: VisaCase
    var agency: Agency
    var visa: VisaKind
    var documents: [CaseDocument]
    var appointment: Appointment?
    var messages: [PortalMessage]

    enum CodingKeys: String, CodingKey {
        case visaCase = "case"
        case agency, visa, documents, appointment, messages
    }

    var missing: [CaseDocument] { documents.filter { $0.state.isPending } }

    /// L'avancement, calculé sur les pièces obligatoires validées.
    var progress: Double {
        let required = documents.filter(\.required)
        guard !required.isEmpty else { return 0 }
        let done = required.filter { $0.state == .validee }.count
        return Double(done) / Double(required.count)
    }
}

struct ShipmentEventItem: Codable, Sendable, Hashable, Identifiable {
    var stage: ShipmentStage
    var at: Date
    var location: String?
    var id: String { "\(stage.rawValue)-\(at.timeIntervalSince1970)" }
}

struct Shipment: Codable, Sendable, Hashable {
    var reference: String
    var mode: String
    var stage: ShipmentStage
    var status: String
    var originPort: String?
    var destPort: String?
    var etd: Date?
    var eta: Date?
    var deliveredAt: Date?
    var blockedReason: String?
    var packages: Int?
    var weightKg: Double?

    enum CodingKeys: String, CodingKey {
        case reference, mode, stage, status, etd, eta, packages
        case originPort = "origin_port"
        case destPort = "dest_port"
        case deliveredAt = "delivered_at"
        case blockedReason = "blocked_reason"
        case weightKg = "weight_kg"
    }
}

struct ShipmentBundle: Codable, Sendable {
    var shipment: Shipment
    var agency: Agency
    var events: [ShipmentEventItem]
}

/// Une ligne de la page d'accueil : un dossier, une cargaison ou une demande.
struct MineItem: Codable, Sendable, Hashable, Identifiable {
    enum Kind: String, Codable, Sendable { case dossier, cargaison, demande }

    var reference: String
    var stage: String?
    var status: String?
    var token: String
    /// Posé par le client selon la liste d'origine : le serveur ne l'envoie pas.
    var kind: Kind = .dossier

    var id: String { token }

    enum CodingKeys: String, CodingKey { case reference, stage, status, token }
}

struct MineBundle: Codable, Sendable {
    var ok: Bool
    var cases: [MineItem]
    var shipments: [MineItem]
    var requests: [MineItem]

    var all: [MineItem] {
        cases.map { withKind($0, .dossier) }
            + shipments.map { withKind($0, .cargaison) }
            + requests.map { withKind($0, .demande) }
    }

    private func withKind(_ item: MineItem, _ kind: MineItem.Kind) -> MineItem {
        var copy = item
        copy.kind = kind
        return copy
    }
}
