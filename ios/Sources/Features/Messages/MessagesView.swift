import SwiftUI

/// La conversation avec l'agence. Le client écrit peu et lit beaucoup : la
/// liste est donc lisible d'abord, le composeur ensuite.
struct MessagesView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    let token: String
    let initial: [PortalMessage]

    @State private var messages: [PortalMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Token.Space.md) {
                        if messages.isEmpty {
                            EmptyState(symbol: "bubble.left", title: "messages.vide", hint: "messages.vide_aide")
                        }
                        ForEach(messages) { message in
                            bubble(message)
                        }
                    }
                    .padding(Token.Space.lg)
                }

                Divider()

                HStack(spacing: Token.Space.sm) {
                    TextField("messages.ecrire", text: $draft, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(Token.Space.md)
                        .background(Token.Palette.background, in: RoundedRectangle(cornerRadius: Token.Radius.field))
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || sending)
                }
                .padding(Token.Space.md)
                .background(Token.Palette.card)
            }
            .background(Token.Palette.background)
            .navigationTitle("messages.titre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("action.fermer") { dismiss() }
                }
            }
            .onAppear { messages = initial.sorted { $0.at < $1.at } }
            .alert("erreur.titre", isPresented: .init(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("action.fermer", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func bubble(_ message: PortalMessage) -> some View {
        HStack {
            if !message.fromAgency { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                Text(message.body).font(.subheadline).foregroundStyle(Token.Palette.text)
                Text(message.at, format: .dateTime.day().month(.abbreviated).hour().minute())
                    .font(.caption2).foregroundStyle(Token.Palette.tertiary)
            }
            .padding(Token.Space.md)
            .background(
                message.fromAgency ? Token.Palette.card : Token.Palette.blue.opacity(0.10),
                in: RoundedRectangle(cornerRadius: Token.Radius.small)
            )
            if message.fromAgency { Spacer(minLength: 40) }
        }
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            try await session.api.send(message: body, caseToken: token)
            messages.append(PortalMessage(direction: "entrant", body: body, at: Date()))
            draft = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}
