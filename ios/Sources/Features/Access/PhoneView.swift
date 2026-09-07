import SwiftUI

/// La première page. Un numéro, rien d'autre. Pas de mot de passe, pas de
/// compte à créer : ces clients n'ont pas d'adresse e-mail active.
struct PhoneView: View {
    @Environment(Session.self) private var session
    @State private var phone = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Token.Space.xl) {
                VStack(alignment: .leading, spacing: Token.Space.sm) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 40, weight: .light))
                        .foregroundStyle(Token.Palette.blue)
                        .padding(.bottom, Token.Space.sm)
                    Text("acces.titre").font(.largeTitle.bold()).foregroundStyle(Token.Palette.text)
                    Text("acces.sous_titre").font(.body).foregroundStyle(Token.Palette.secondary)
                }

                SectionCard {
                    VStack(alignment: .leading, spacing: Token.Space.md) {
                        Text("acces.numero").font(.footnote).foregroundStyle(Token.Palette.secondary)
                        TextField("+216 …", text: $phone)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .font(.title3)
                            .focused($focused)
                            .padding(Token.Space.md)
                            .background(Token.Palette.background, in: RoundedRectangle(cornerRadius: Token.Radius.field))
                        Text("acces.numero_aide").font(.caption).foregroundStyle(Token.Palette.tertiary)

                        Button {
                            Task { busy = true; await session.requestCode(phone: phone); busy = false }
                        } label: {
                            Text(busy ? "acces.envoi" : "acces.continuer")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(phone.count < 8 || busy)
                    }
                }

                if let error = session.lastError {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Token.Palette.red)
                }

                VStack(alignment: .leading, spacing: Token.Space.sm) {
                    Text("acces.agence").font(.caption).foregroundStyle(Token.Palette.tertiary)
                    AgencyPicker()
                }

                Text("acces.confidentialite")
                    .font(.caption)
                    .foregroundStyle(Token.Palette.tertiary)
            }
            .padding(Token.Space.xl)
        }
        .background(Token.Palette.background)
        .scrollDismissesKeyboard(.interactively)
        .onAppear { focused = true }
    }
}

/// L'agence dont le client suit un dossier. Elle ne change presque jamais,
/// mais elle doit rester visible : un client de Sfax ne doit pas se demander
/// pourquoi son dossier n'apparaît pas.
struct AgencyPicker: View {
    @Environment(Session.self) private var session
    @State private var editing = false
    @State private var draft = ""

    var body: some View {
        Button {
            draft = session.agencySlug
            editing = true
        } label: {
            HStack {
                Image(systemName: "building.2")
                Text(session.agencySlug)
                Spacer()
                Image(systemName: "chevron.right").font(.caption)
            }
            .font(.subheadline)
            .foregroundStyle(Token.Palette.secondary)
            .padding(Token.Space.md)
            .background(Token.Palette.card, in: RoundedRectangle(cornerRadius: Token.Radius.field))
            .overlay(RoundedRectangle(cornerRadius: Token.Radius.field).stroke(Token.Palette.hairline))
        }
        .alert("acces.agence", isPresented: $editing) {
            TextField("tca", text: $draft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("action.enregistrer") {
                let cleaned = draft.trimmingCharacters(in: .whitespaces).lowercased()
                if !cleaned.isEmpty { session.agencySlug = cleaned }
            }
            Button("action.annuler", role: .cancel) {}
        }
    }
}
