import SwiftUI

struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            switch session.state {
            case .anonyme:
                PhoneView()
            case .attenteCode:
                CodeView()
            case .connecte:
                HomeView()
            }
        }
        .animation(Token.ease, value: session.state)
        .environment(\.layoutDirection, session.language == "ar" ? .rightToLeft : .leftToRight)
    }
}
