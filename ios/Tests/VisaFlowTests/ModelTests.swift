import Foundation
import Testing
@testable import VisaFlow

@Suite("Modèle")
struct ModelTests {

    @Test("L'avancement compte les pièces obligatoires validées, pas les autres")
    func progressCountsRequiredOnly() async throws {
        let bundle = try await DemoAPI().caseBundle(token: "demo-case")
        // Deux validées sur quatre obligatoires.
        #expect(abs(bundle.progress - 0.5) < 0.001)
    }

    @Test("Les pièces manquantes excluent celles déjà validées")
    func missingExcludesValidated() async throws {
        let bundle = try await DemoAPI().caseBundle(token: "demo-case")
        #expect(bundle.missing.count == 2)
        #expect(bundle.missing.allSatisfy { $0.state != .validee })
    }

    @Test("Un libellé retombe sur le français quand la langue manque")
    func labelFallsBackToFrench() {
        let doc = CaseDocument(
            key: "x", label: ["fr": "Passeport"], help: nil,
            state: .manquante, required: true, receivedAt: nil, rejectionReason: nil
        )
        #expect(doc.title("zh") == "Passeport")
        #expect(doc.title("fr") == "Passeport")
    }

    @Test("Les dates du serveur se décodent dans les trois formes envoyées")
    func decodesServerDates() throws {
        struct Wrapper: Decodable { let at: Date }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let d = ISO8601DateFormatter.visaflow.date(from: text) { return d }
            if let d = ISO8601DateFormatter.visaflowFractional.date(from: text) { return d }
            if let d = DateFormatter.plainDay.date(from: text) { return d }
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: text))
        }
        let cases = [
            #"{"at":"2026-09-07T10:30:00Z"}"#,
            #"{"at":"2026-09-07T10:30:00.123Z"}"#,
            #"{"at":"2026-09-07"}"#,
        ]
        for json in cases {
            let value = try decoder.decode(Wrapper.self, from: Data(json.utf8))
            #expect(value.at.timeIntervalSince1970 > 0)
        }
    }

    @Test("Le regroupement de l'accueil range chaque ligne dans sa famille")
    func mineGroupsByKind() async throws {
        let mine = try await DemoAPI().mine(agency: "tca", deviceToken: "demo")
        let all = mine.all
        #expect(all.count == 2)
        #expect(all.contains { $0.kind == .dossier })
        #expect(all.contains { $0.kind == .cargaison })
    }
}

@Suite("Accès")
struct AccessTests {

    @Test("Un mauvais code est refusé")
    func wrongCodeRejected() async {
        await #expect(throws: APIError.self) {
            _ = try await DemoAPI().verifyCode(agency: "tca", phone: "+21620000000", code: "123456")
        }
    }

    @Test("Le bon code rend un jeton d'appareil")
    func rightCodeReturnsToken() async throws {
        let token = try await DemoAPI().verifyCode(agency: "tca", phone: "+21620000000", code: DemoAPI.demoCode)
        #expect(!token.isEmpty)
    }

    @MainActor
    @Test("La session passe par l'attente du code, puis se connecte")
    func sessionFlow() async {
        let session = Session(api: DemoAPI())
        session.forgetDevice()
        #expect(session.state == .anonyme)

        await session.requestCode(phone: "+21698111222")
        #expect(session.state == .attenteCode(phone: "+21698111222"))

        await session.verify(code: "000000")
        #expect(session.state == .connecte(phone: "+21698111222"))
        #expect(session.deviceToken != nil)

        session.forgetDevice()
        #expect(session.state == .anonyme)
        #expect(session.deviceToken == nil)
    }

    @MainActor
    @Test("Un code faux laisse la session en attente et remonte l'erreur")
    func wrongCodeKeepsWaiting() async {
        let session = Session(api: DemoAPI())
        session.forgetDevice()
        await session.requestCode(phone: "+21698111222")
        await session.verify(code: "999999")
        #expect(session.state == .attenteCode(phone: "+21698111222"))
        #expect(session.lastError != nil)
    }
}
