import Foundation

/// Ce que l'app sait demander au serveur. Cinq appels, pas un de plus : le
/// client ne parle jamais aux tables, seulement à des fonctions qui décident
/// elles-mêmes de ce qu'elles rendent.
protocol API: Sendable {
    func requestCode(agency: String, phone: String) async throws
    func verifyCode(agency: String, phone: String, code: String) async throws -> String
    func mine(agency: String, deviceToken: String) async throws -> MineBundle
    func caseBundle(token: String) async throws -> CaseBundle
    func shipmentBundle(token: String) async throws -> ShipmentBundle
    func send(message: String, caseToken: String) async throws
    func upload(_ data: Data, fileName: String, documentKey: String, caseToken: String) async throws
}

enum APIError: LocalizedError {
    case network
    case badCode
    case blocked
    case notFound
    case server(String)

    var errorDescription: String? {
        switch self {
        case .network: String(localized: "erreur.reseau")
        case .badCode: String(localized: "erreur.code")
        case .blocked: String(localized: "erreur.bloque")
        case .notFound: String(localized: "erreur.introuvable")
        case .server(let message): message
        }
    }
}

/// L'implémentation qui parle à Supabase, par ses fonctions RPC.
struct LiveAPI: API {
    let baseURL: URL
    let anonKey: String
    private let session: URLSession = .shared

    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = ISO8601DateFormatter.visaflow.date(from: text) { return date }
            if let date = ISO8601DateFormatter.visaflowFractional.date(from: text) { return date }
            if let date = DateFormatter.plainDay.date(from: text) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "date illisible : \(text)")
            )
        }
        return d
    }

    private func rpc(_ name: String, _ body: [String: Any]) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent("rest/v1/rpc/\(name)"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 20

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        switch http.statusCode {
        case 200...299: return data
        case 404: throw APIError.notFound
        case 429: throw APIError.blocked
        default:
            let message = String(data: data, encoding: .utf8) ?? ""
            throw APIError.server(message.isEmpty ? "\(http.statusCode)" : message)
        }
    }

    func requestCode(agency: String, phone: String) async throws {
        _ = try await rpc("issue_otp", ["p_agency_slug": agency, "p_phone": phone, "p_purpose": "suivi"])
    }

    func verifyCode(agency: String, phone: String, code: String) async throws -> String {
        let data = try await rpc("verify_otp", [
            "p_agency_slug": agency, "p_phone": phone, "p_code": code, "p_platform": "ios",
        ])
        struct Result: Decodable { let ok: Bool; let device_token: String?; let reason: String? }
        let result = try JSONDecoder().decode(Result.self, from: data)
        guard result.ok, let token = result.device_token else {
            throw result.reason == "bloque" ? APIError.blocked : APIError.badCode
        }
        return token
    }

    func mine(agency: String, deviceToken: String) async throws -> MineBundle {
        let data = try await rpc("portal_mine", ["p_agency_slug": agency, "p_device_token": deviceToken])
        return try decoder.decode(MineBundle.self, from: data)
    }

    func caseBundle(token: String) async throws -> CaseBundle {
        let data = try await rpc("portal_case", ["p_token": token])
        return try decoder.decode(CaseBundle.self, from: data)
    }

    func shipmentBundle(token: String) async throws -> ShipmentBundle {
        let data = try await rpc("portal_shipment", ["p_token": token])
        return try decoder.decode(ShipmentBundle.self, from: data)
    }

    func send(message: String, caseToken: String) async throws {
        _ = try await rpc("portal_send", ["p_token": caseToken, "p_body": message])
    }

    func upload(_ data: Data, fileName: String, documentKey: String, caseToken: String) async throws {
        // Le fichier passe par la fonction de bord portal-upload : elle valide
        // le jeton, dépose avec la clé de service et impose le chemin. Le
        // client ne choisit jamais où sa pièce atterrit.
        var request = URLRequest(url: baseURL.appendingPathComponent("functions/v1/portal-upload"))
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(mimeType(for: fileName), forHTTPHeaderField: "Content-Type")
        request.setValue(caseToken, forHTTPHeaderField: "x-portal-token")
        request.setValue(documentKey, forHTTPHeaderField: "x-document-key")
        request.setValue(fileName, forHTTPHeaderField: "x-file-name")
        request.timeoutInterval = 60
        let (_, response) = try await session.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.network
        }
    }

    private func mimeType(for name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "pdf": return "application/pdf"
        default: return "image/jpeg"
        }
    }
}

extension ISO8601DateFormatter {
    static let visaflow: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    static let visaflowFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

extension DateFormatter {
    static let plainDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
