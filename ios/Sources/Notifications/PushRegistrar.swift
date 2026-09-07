import Observation
import UIKit
import UserNotifications

/// Les notifications poussées sont la seule vraie raison de faire une
/// application plutôt qu'une page web : un message WhatsApp coûte à chaque
/// envoi, une notification n'en coûte aucun.
@MainActor
@Observable
final class PushRegistrar: NSObject {
    enum Status: Equatable { case inconnue, accordee, refusee }

    private(set) var status: Status = .inconnue
    private(set) var deviceToken: String?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        Task { await refresh() }
    }

    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        status = switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: .accordee
        case .denied: .refusee
        default: .inconnue
        }
    }

    func enable() async {
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
            status = granted ? .accordee : .refusee
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            status = .refusee
        }
    }

    func disable() {
        UIApplication.shared.unregisterForRemoteNotifications()
        deviceToken = nil
    }

    /// Appelé par le délégué d'application. Le jeton part au serveur, rattaché
    /// à l'appareil déjà reconnu : une notification envoyée au mauvais appareil
    /// est une fuite.
    func store(token: Data) {
        deviceToken = token.map { String(format: "%02x", $0) }.joined()
    }
}

extension PushRegistrar: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
