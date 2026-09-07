import Foundation
import Observation

/// La session du client. Le numéro est l'identité, l'appareil est reconnu
/// quatre-vingt-dix jours, et le jeton vit dans le trousseau.
@MainActor
@Observable
final class Session {
    enum State: Equatable {
        case anonyme
        case attenteCode(phone: String)
        case connecte(phone: String)
    }

    private enum Key {
        static let token = "device.token"
        static let phone = "device.phone"
        static let agency = "device.agency"
        static let language = "app.language"
        static let notifications = "app.notifications"
    }

    let api: API
    private(set) var state: State = .anonyme
    private(set) var deviceToken: String?
    var agencySlug: String {
        didSet { UserDefaults.standard.set(agencySlug, forKey: Key.agency) }
    }
    var language: String {
        didSet {
            UserDefaults.standard.set([language], forKey: "AppleLanguages")
            UserDefaults.standard.set(language, forKey: Key.language)
        }
    }
    var notificationsEnabled: Bool {
        didSet { UserDefaults.standard.set(notificationsEnabled, forKey: Key.notifications) }
    }
    var lastError: String?

    init(api: API = DemoAPI()) {
        self.api = api
        self.agencySlug = UserDefaults.standard.string(forKey: Key.agency) ?? "tca"
        self.language = UserDefaults.standard.string(forKey: Key.language)
            ?? Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "fr"
        self.notificationsEnabled = UserDefaults.standard.bool(forKey: Key.notifications)

        // Affordance de test : les captures et les tests d'interface entrent
        // directement, sans passer par le code. Jamais activée en production.
        if ProcessInfo.processInfo.arguments.contains("-connecte") {
            self.deviceToken = "demo-device-token"
            self.state = .connecte(phone: "+216 98 111 222")
            return
        }

        if let token = Keychain.get(Key.token), let phone = Keychain.get(Key.phone) {
            self.deviceToken = token
            self.state = .connecte(phone: phone)
        }
    }

    /// La langue effective pour choisir un libellé traduit venu du serveur.
    var contentLocale: String { language == "zh-Hans" ? "zh" : language }

    func requestCode(phone: String) async {
        lastError = nil
        do {
            try await api.requestCode(agency: agencySlug, phone: phone)
            state = .attenteCode(phone: phone)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func verify(code: String) async {
        guard case .attenteCode(let phone) = state else { return }
        lastError = nil
        do {
            let token = try await api.verifyCode(agency: agencySlug, phone: phone, code: code)
            Keychain.set(token, for: Key.token)
            Keychain.set(phone, for: Key.phone)
            deviceToken = token
            state = .connecte(phone: phone)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func forgetDevice() {
        Keychain.remove(Key.token)
        Keychain.remove(Key.phone)
        deviceToken = nil
        state = .anonyme
    }

    func backToPhone() {
        state = .anonyme
        lastError = nil
    }
}
