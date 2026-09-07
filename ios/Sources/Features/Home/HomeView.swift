import SwiftUI

/// L'accueil du client. Trois questions, trois réponses : où en est mon
/// dossier, qu'est-ce qu'il vous manque, où est ma marchandise.
struct HomeView: View {
    @Environment(Session.self) private var session
    @State private var items: [MineItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showSettings = false
    @State private var showRequest = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: Token.Space.lg) {
                    if loading {
                        ProgressView().padding(.vertical, Token.Space.xxl)
                    } else if items.isEmpty {
                        EmptyState(symbol: "tray", title: "accueil.vide", hint: "accueil.vide_aide")
                        Button("accueil.nouvelle_demande") { showRequest = true }
                            .buttonStyle(PrimaryButtonStyle())
                    } else {
                        ForEach(groups, id: \.title) { group in
                            VStack(alignment: .leading, spacing: Token.Space.md) {
                                Text(group.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Token.Palette.secondary)
                                ForEach(group.items) { item in
                                    NavigationLink(value: item) { row(item) }
                                        .buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    if let error {
                        Label(error, systemImage: "wifi.exclamationmark")
                            .font(.footnote).foregroundStyle(Token.Palette.orange)
                    }
                }
                .padding(Token.Space.lg)
            }
            .background(Token.Palette.background)
            .navigationTitle("accueil.titre")
            .navigationDestination(for: MineItem.self) { item in
                switch item.kind {
                case .cargaison: ShipmentDetailView(token: item.token)
                default: CaseDetailView(token: item.token)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showRequest = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel(Text("accueil.nouvelle_demande"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel(Text("reglages.titre"))
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(isPresented: $showRequest) { RequestView() }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private struct Group { let title: String; let items: [MineItem] }

    private var groups: [Group] {
        var out: [Group] = []
        let dossiers = items.filter { $0.kind == .dossier }
        let cargaisons = items.filter { $0.kind == .cargaison }
        let demandes = items.filter { $0.kind == .demande }
        if !dossiers.isEmpty { out.append(Group(title: String(localized: "accueil.dossiers"), items: dossiers)) }
        if !cargaisons.isEmpty { out.append(Group(title: String(localized: "accueil.cargaisons"), items: cargaisons)) }
        if !demandes.isEmpty { out.append(Group(title: String(localized: "accueil.demandes"), items: demandes)) }
        return out
    }

    private func row(_ item: MineItem) -> some View {
        HStack(spacing: Token.Space.md) {
            Image(systemName: item.kind == .cargaison ? "shippingbox" : item.kind == .demande ? "envelope" : "doc.text")
                .font(.title3)
                .foregroundStyle(Token.Palette.blue)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.reference).font(.subheadline.weight(.medium)).foregroundStyle(Token.Palette.text)
                if let stage = item.stage {
                    Text(stageTitle(stage, kind: item.kind))
                        .font(.caption).foregroundStyle(Token.Palette.tertiary)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward").font(.caption).foregroundStyle(Token.Palette.tertiary)
        }
        .cardSurface()
    }

    private func stageTitle(_ raw: String, kind: MineItem.Kind) -> String {
        let key = kind == .cargaison ? "ship.\(raw)" : "stage.\(raw)"
        return String(localized: String.LocalizationValue(key))
    }

    private func load() async {
        guard let token = session.deviceToken else { return }
        error = nil
        do {
            let bundle = try await session.api.mine(agency: session.agencySlug, deviceToken: token)
            items = bundle.all
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}
