import PhotosUI
import SwiftUI

/// Le dossier, vu par le client. Ce qu'il veut savoir tient en trois blocs :
/// où j'en suis, ce qu'il vous manque, quand je passe.
struct CaseDetailView: View {
    @Environment(Session.self) private var session
    let token: String

    @State private var bundle: CaseBundle?
    @State private var loading = true
    @State private var error: String?
    @State private var uploading: String?
    @State private var pickerItem: PhotosPickerItem?
    @State private var pendingKey: String?
    @State private var showMessages = false

    var body: some View {
        ScrollView {
            VStack(spacing: Token.Space.lg) {
                if let bundle {
                    header(bundle)
                    steps(bundle)
                    if let place = bundle.queue { queueRank(place) }
                    missing(bundle)
                    if let appointment = bundle.appointment { rendezVous(appointment) }
                    if bundle.visaCase.balance > 0 { balance(bundle) }
                    contact(bundle)
                } else if loading {
                    ProgressView().padding(.vertical, Token.Space.xxl)
                } else {
                    EmptyState(symbol: "questionmark.folder", title: "dossier.introuvable", hint: "dossier.introuvable_aide")
                }
                if let error {
                    Label(error, systemImage: "wifi.exclamationmark")
                        .font(.footnote).foregroundStyle(Token.Palette.orange)
                }
            }
            .padding(Token.Space.lg)
        }
        .background(Token.Palette.background)
        .navigationTitle(bundle?.visaCase.reference ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if bundle != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showMessages = true } label: { Image(systemName: "bubble.left.and.bubble.right") }
                        .accessibilityLabel(Text("messages.titre"))
                }
            }
        }
        .sheet(isPresented: $showMessages) {
            if let bundle { MessagesView(token: token, initial: bundle.messages) }
        }
        .photosPicker(isPresented: .init(get: { pendingKey != nil && pickerItem == nil },
                                         set: { if !$0 { pendingKey = nil } }),
                      selection: $pickerItem, matching: .images)
        .onChange(of: pickerItem) { _, item in
            guard let item, let key = pendingKey else { return }
            Task { await upload(item: item, key: key) }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: - Blocs

    private func header(_ bundle: CaseBundle) -> some View {
        VStack(alignment: .leading, spacing: Token.Space.sm) {
            Text(bundle.visa.title(session.contentLocale))
                .font(.title2.bold())
                .foregroundStyle(Token.Palette.text)
            HStack(spacing: Token.Space.sm) {
                Pill(text: String(localized: String.LocalizationValue(bundle.visaCase.stage.titleKey)),
                     tone: tone(for: bundle.visaCase), dot: true)
                if let travel = bundle.visaCase.travelDate {
                    Text(travel, format: .dateTime.day().month(.abbreviated))
                        .font(.caption).foregroundStyle(Token.Palette.tertiary)
                }
            }
            ProgressLine(value: bundle.progress,
                         tone: bundle.progress >= 1 ? Token.Palette.green : Token.Palette.blue)
                .padding(.top, Token.Space.xs)
            if bundle.visaCase.status == .refuse, let reason = bundle.visaCase.refusalReason {
                Text(reason).font(.footnote).foregroundStyle(Token.Palette.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func steps(_ bundle: CaseBundle) -> some View {
        SectionCard("dossier.avancement") {
            StepTimeline(steps: Stage.allCases.map { stage in
                let order = Stage.allCases
                let current = order.firstIndex(of: bundle.visaCase.stage) ?? 0
                let index = order.firstIndex(of: stage) ?? 0
                return StepTimeline.Step(
                    id: stage.rawValue,
                    title: String(localized: String.LocalizationValue(stage.titleKey)),
                    detail: nil,
                    done: index < current,
                    current: index == current
                )
            })
        }
    }

    // Le rang dans la file. Répond à « combien de temps encore ? », la
    // question qui, sinon, fait décrocher le téléphone à l'agence.
    private func queueRank(_ place: QueuePlace) -> some View {
        SectionCard("dossier.file") {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(place.rank)")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Token.Palette.text)
                Text(String(format: NSLocalizedString("file.rang", comment: ""), place.rank, place.total, place.place(session.contentLocale)))
                    .font(.body)
                    .foregroundStyle(Token.Palette.secondary)
                if let d = place.waitDays {
                    Text(String(format: NSLocalizedString("file.attente", comment: ""), d))
                        .font(.caption)
                        .foregroundStyle(Token.Palette.tertiary)
                }
            }
        }
    }

    private func missing(_ bundle: CaseBundle) -> some View {
        SectionCard("dossier.manquant") {
            if bundle.missing.isEmpty {
                Label("dossier.complet", systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(Token.Palette.green)
            } else {
                VStack(spacing: Token.Space.md) {
                    ForEach(bundle.missing) { doc in
                        VStack(alignment: .leading, spacing: Token.Space.sm) {
                            Text(doc.title(session.contentLocale))
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Token.Palette.text)
                            if let hint = doc.hint(session.contentLocale) {
                                Text(hint).font(.caption).foregroundStyle(Token.Palette.tertiary)
                            }
                            if doc.state == .refusee, let reason = doc.rejectionReason {
                                Text(reason).font(.caption).foregroundStyle(Token.Palette.red)
                            }
                            Button {
                                pendingKey = doc.key
                            } label: {
                                Label(uploading == doc.key ? "dossier.envoi" : "dossier.envoyer",
                                      systemImage: "camera")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .disabled(uploading != nil)
                        }
                        .padding(.bottom, Token.Space.sm)
                        Divider().opacity(doc.key == bundle.missing.last?.key ? 0 : 1)
                    }
                    Text("dossier.envoi_aide").font(.caption).foregroundStyle(Token.Palette.tertiary)
                }
            }
        }
    }

    private func rendezVous(_ appointment: Appointment) -> some View {
        SectionCard("dossier.rendezvous") {
            VStack(alignment: .leading, spacing: 4) {
                Text(appointment.at, format: .dateTime.weekday(.wide).day().month(.wide).hour().minute())
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Token.Palette.text)
                if let place = appointment.location {
                    Text(place).font(.caption).foregroundStyle(Token.Palette.tertiary)
                }
            }
        }
    }

    private func balance(_ bundle: CaseBundle) -> some View {
        SectionCard("dossier.solde") {
            Text(bundle.visaCase.balance, format: .currency(code: bundle.visaCase.currency))
                .font(.title3.weight(.semibold))
                .foregroundStyle(Token.Palette.text)
        }
    }

    private func contact(_ bundle: CaseBundle) -> some View {
        SectionCard("dossier.contact") {
            VStack(alignment: .leading, spacing: Token.Space.sm) {
                Text(bundle.agency.name).font(.subheadline.weight(.medium))
                if let phone = bundle.agency.phone {
                    HStack(spacing: Token.Space.md) {
                        Link(destination: URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })")!) {
                            Label("dossier.appeler", systemImage: "phone")
                        }
                        Link(destination: URL(string: "https://wa.me/\(phone.filter(\.isNumber))")!) {
                            Label("WhatsApp", systemImage: "message")
                        }
                    }
                    .font(.subheadline)
                }
                Text("dossier.confidentialite").font(.caption).foregroundStyle(Token.Palette.tertiary)
            }
        }
    }

    private func tone(for kase: VisaCase) -> Pill.Tone {
        switch kase.status {
        case .accepte: .green
        case .refuse: .red
        case .annule: .gray
        case .ouvert: kase.stage == .retrait ? .green : .blue
        }
    }

    // MARK: - Réseau

    private func load() async {
        error = nil
        do {
            bundle = try await session.api.caseBundle(token: token)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func upload(item: PhotosPickerItem, key: String) async {
        uploading = key
        defer { uploading = nil; pickerItem = nil; pendingKey = nil }
        do {
            guard let raw = try await item.loadTransferable(type: Data.self) else { return }
            // On ré-encode l'image sans ses métadonnées avant l'envoi : une
            // photo de passeport embarque en général la position GPS du domicile
            // du client, qui n'a rien à faire dans un dossier de visa.
            let data = ImageCleaner.stripped(raw)
            try await session.api.upload(data, fileName: "\(key).jpg", documentKey: key, caseToken: token)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
