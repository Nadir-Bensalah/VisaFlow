import SwiftUI

@main
struct VisaFlowApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var session = Session(api: AppEnvironment.api)
    @State private var push = PushRegistrar()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(push)
                .tint(Token.Palette.blue)
                .background(Token.Palette.background)
                .onReceive(NotificationCenter.default.publisher(for: AppDelegate.tokenReceived)) { note in
                    if let data = note.object as? Data { push.store(token: data) }
                }
        }
    }
}

/// Le seul endroit qui décide si l'app parle à un serveur ou au jeu de
/// démonstration. Sans adresse configurée, elle tourne en démonstration : c'est
/// ce qui permet de la montrer au comptoir sans réseau.
enum AppEnvironment {
    static var api: API {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String,
            let url = URL(string: raw), !raw.isEmpty,
            let key = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String,
            !key.isEmpty
        else { return DemoAPI() }
        return LiveAPI(baseURL: url, anonKey: key)
    }

    static var isDemo: Bool { api is DemoAPI }
}
