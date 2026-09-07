import SwiftUI

struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(PushRegistrar.self) private var push
    @Environment(\.dismiss) private var dismiss
    @State private var confirmForget = false

    private let languages: [(code: String, label: String)] = [
        ("fr", "Français"), ("en", "English"), ("ar", "العربية"), ("zh-Hans", "中文"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("reglages.langue") {
                    Picker("reglages.langue", selection: Binding(
                        get: { session.language },
                        set: { session.language = $0 }
                    )) {
                        ForEach(languages, id: \.code) { Text($0.label).tag($0.code) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    Text("reglages.langue_aide").font(.caption).foregroundStyle(Token.Palette.tertiary)
                }

                Section("reglages.notifications") {
                    Toggle("reglages.notifications", isOn: Binding(
                        get: { session.notificationsEnabled },
                        set: { value in
                            session.notificationsEnabled = value
                            if value { Task { await push.enable() } } else { push.disable() }
                        }
                    ))
                    Text("reglages.notifications_aide").font(.caption).foregroundStyle(Token.Palette.tertiary)
                    if push.status == .refusee {
                        Link("reglages.ouvrir_reglages", destination: URL(string: UIApplication.openSettingsURLString)!)
                            .font(.footnote)
                    }
                }

                Section("reglages.appareil") {
                    if case .connecte(let phone) = session.state {
                        LabeledContent("reglages.numero", value: phone)
                    }
                    LabeledContent("acces.agence", value: session.agencySlug)
                    Button("reglages.oublier", role: .destructive) { confirmForget = true }
                    Text("reglages.oublier_aide").font(.caption).foregroundStyle(Token.Palette.tertiary)
                }

                Section("reglages.a_propos") {
                    LabeledContent("reglages.version", value: version)
                    Text("dossier.confidentialite").font(.caption).foregroundStyle(Token.Palette.tertiary)
                }
            }
            .navigationTitle("reglages.titre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("action.fermer") { dismiss() }
                }
            }
            .confirmationDialog("reglages.oublier", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("reglages.oublier", role: .destructive) {
                    session.forgetDevice()
                    dismiss()
                }
                Button("action.annuler", role: .cancel) {}
            } message: {
                Text("reglages.oublier_aide")
            }
        }
    }

    private var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(short) (\(build))"
    }
}
