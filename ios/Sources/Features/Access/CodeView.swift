import SwiftUI

/// Six chiffres, une fois par appareil. Ensuite l'appareil est reconnu
/// quatre-vingt-dix jours : le code n'est pas redemandé à chaque visite, et
/// c'est ce qui rend le coût d'envoi tenable.
struct CodeView: View {
    @Environment(Session.self) private var session
    @State private var code = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    private var phone: String {
        if case .attenteCode(let value) = session.state { return value }
        return ""
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Token.Space.xl) {
                VStack(alignment: .leading, spacing: Token.Space.sm) {
                    Image(systemName: "message.badge.filled.fill")
                        .font(.system(size: 40, weight: .light))
                        .foregroundStyle(Token.Palette.blue)
                        .padding(.bottom, Token.Space.sm)
                    Text("code.titre").font(.largeTitle.bold()).foregroundStyle(Token.Palette.text)
                    Text("code.envoye \(phone)").font(.body).foregroundStyle(Token.Palette.secondary)
                }

                SectionCard {
                    VStack(spacing: Token.Space.md) {
                        TextField("······", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .font(.system(size: 30, weight: .semibold, design: .rounded))
                            .multilineTextAlignment(.center)
                            .kerning(8)
                            .focused($focused)
                            .padding(Token.Space.md)
                            .background(Token.Palette.background, in: RoundedRectangle(cornerRadius: Token.Radius.field))
                            .onChange(of: code) { _, value in
                                code = String(value.filter(\.isNumber).prefix(6))
                                if code.count == 6 { Task { await confirm() } }
                            }

                        if AppEnvironment.isDemo {
                            Pill(text: String(localized: "code.demo"), tone: .orange)
                        }

                        Button("code.confirmer") { Task { await confirm() } }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(code.count < 6 || busy)

                        Button("code.retour") { session.backToPhone() }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }

                if let error = session.lastError {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(Token.Palette.red)
                }
            }
            .padding(Token.Space.xl)
        }
        .background(Token.Palette.background)
        .onAppear { focused = true }
    }

    private func confirm() async {
        guard !busy else { return }
        busy = true
        await session.verify(code: code)
        busy = false
        if session.lastError != nil { code = "" }
    }
}
