import Foundation

/// Le jeu de démonstration, dans l'app. Il sert trois choses : voir l'app sans
/// serveur, faire tourner les tests sans réseau, et montrer l'écran à un client
/// au comptoir. Le code `000000` ouvre la porte.
struct DemoAPI: API {
    static let demoCode = "000000"

    private static let day: TimeInterval = 86_400

    private func date(_ days: Double) -> Date { Date().addingTimeInterval(days * Self.day) }

    func requestCode(agency: String, phone: String) async throws {
        try await Task.sleep(for: .milliseconds(300))
    }

    func verifyCode(agency: String, phone: String, code: String) async throws -> String {
        try await Task.sleep(for: .milliseconds(300))
        guard code == Self.demoCode else { throw APIError.badCode }
        return "demo-device-token"
    }

    func mine(agency: String, deviceToken: String) async throws -> MineBundle {
        MineBundle(
            ok: true,
            cases: [MineItem(reference: "VF-2026-0142", stage: "pieces", status: "ouvert", token: "demo-case")],
            shipments: [MineItem(reference: "EXP-2026-0031", stage: "transit", status: "en_cours", token: "demo-ship")],
            requests: []
        )
    }

    func caseBundle(token: String) async throws -> CaseBundle {
        CaseBundle(
            visaCase: VisaCase(
                reference: "VF-2026-0142", stage: .pieces, status: .ouvert,
                travelDate: date(21), decisionAt: nil, refusalReason: nil,
                balance: 260, currency: "TND"
            ),
            agency: Agency(name: "Tunis Consulting", mark: "TC", accent: "#0066CC",
                           phone: "+216 58 746 997", inpdpRef: "À déclarer"),
            visa: VisaKind(
                country: ["fr": "Chine", "en": "China", "ar": "الصين", "zh": "中国"],
                label: ["fr": "Affaires 48 h", "en": "Business 48h", "ar": "أعمال 48 ساعة", "zh": "商务48小时"],
                processingDays: 3
            ),
            documents: [
                CaseDocument(key: "passeport",
                             label: ["fr": "Passeport valable 6 mois", "en": "Passport valid 6 months",
                                     "ar": "جواز سفر صالح 6 أشهر", "zh": "护照（有效期6个月以上）"],
                             help: ["fr": "Deux pages vierges face à face."],
                             state: .validee, required: true, receivedAt: date(-6), rejectionReason: nil),
                CaseDocument(key: "photo",
                             label: ["fr": "Photo 33 x 48 mm, fond blanc", "en": "Photo 33 x 48 mm",
                                     "ar": "صورة 33×48 مم", "zh": "白底照片"],
                             help: nil, state: .validee, required: true, receivedAt: date(-6), rejectionReason: nil),
                CaseDocument(key: "invitation",
                             label: ["fr": "Lettre d’invitation chinoise", "en": "Chinese invitation letter",
                                     "ar": "رسالة دعوة صينية", "zh": "中方邀请函"],
                             help: ["fr": "Le cachet de l’entreprise chinoise est obligatoire."],
                             state: .demandee, required: true, receivedAt: nil, rejectionReason: nil),
                CaseDocument(key: "banque",
                             label: ["fr": "Relevé bancaire, 3 derniers mois", "en": "Bank statement",
                                     "ar": "كشف حساب بنكي", "zh": "近三个月银行流水"],
                             help: nil, state: .manquante, required: true, receivedAt: nil, rejectionReason: nil),
            ],
            appointment: Appointment(kind: "agence", at: date(3), location: "85 rue de Palestine, Tunis"),
            messages: [
                PortalMessage(direction: "sortant", body: "Bonjour Mohamed, il nous manque encore la lettre d’invitation.", at: date(-2)),
                PortalMessage(direction: "entrant", body: "Je l’envoie demain matin.", at: date(-1.8)),
            ]
        )
    }

    func shipmentBundle(token: String) async throws -> ShipmentBundle {
        ShipmentBundle(
            shipment: Shipment(
                reference: "EXP-2026-0031", mode: "maritime_lcl", stage: .transit, status: "en_cours",
                originPort: "Nansha", destPort: "Radès", etd: date(-18), eta: date(11),
                deliveredAt: nil, blockedReason: nil, packages: 120, weightKg: 3400
            ),
            agency: Agency(name: "Tunis Consulting", mark: "TC", accent: "#0066CC",
                           phone: "+216 58 746 997", inpdpRef: nil),
            events: [
                ShipmentEventItem(stage: .demande, at: date(-32), location: "Guangzhou"),
                ShipmentEventItem(stage: .ramassage, at: date(-30), location: "Guangzhou"),
                ShipmentEventItem(stage: .entrepot, at: date(-28), location: "Guangzhou"),
                ShipmentEventItem(stage: .empotage, at: date(-22), location: "Nansha"),
                ShipmentEventItem(stage: .depart, at: date(-18), location: "Nansha"),
                ShipmentEventItem(stage: .transit, at: date(-17), location: "En mer"),
            ]
        )
    }

    func send(message: String, caseToken: String) async throws {
        try await Task.sleep(for: .milliseconds(200))
    }

    func upload(_ data: Data, fileName: String, documentKey: String, caseToken: String) async throws {
        try await Task.sleep(for: .milliseconds(400))
    }
}
