import UIKit

/// Le seul rôle du délégué : recevoir le jeton APNs. SwiftUI ne l'expose pas.
final class AppDelegate: NSObject, UIApplicationDelegate {
    static let tokenReceived = Notification.Name("visaflow.apns.token")

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(name: Self.tokenReceived, object: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Rien à faire : l'app fonctionne sans notifications, elle prévient
        // simplement moins bien.
    }
}
