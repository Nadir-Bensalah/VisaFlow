import SwiftUI

/// Les mêmes jetons que la version web. Une seule identité visuelle, deux
/// plateformes. Rien n'est écrit en dur ailleurs dans l'app.
enum Token {
    enum Palette {
        static let background = Color(hex: 0xF5F5F7)
        static let card = Color.white
        static let elevated = Color(hex: 0xFBFBFD)
        static let text = Color(hex: 0x1D1D1F)
        static let secondary = Color(hex: 0x4B4B50)
        static let tertiary = Color(hex: 0x6E6E73)
        static let blue = Color(hex: 0x0066CC)
        static let green = Color(hex: 0x1F7A2E)
        static let orange = Color(hex: 0xB04503)
        static let red = Color(hex: 0xD10000)
        static let violet = Color(hex: 0x5E5CE6)
        static let hairline = Color.black.opacity(0.08)
        static let sunken = Color.black.opacity(0.025)
    }

    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    enum Radius {
        static let card: CGFloat = 18
        static let small: CGFloat = 12
        static let field: CGFloat = 10
    }

    /// La courbe d'apple.com : elle démarre doucement et s'arrête longuement.
    static let ease = Animation.timingCurve(0.28, 0.11, 0.32, 1, duration: 0.3)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension View {
    /// La carte du produit : un filet, pas une ombre. L'ombre est réservée à
    /// ce qui est réellement au-dessus, une feuille ou une alerte.
    func cardSurface(padding: CGFloat = Token.Space.lg) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Token.Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: Token.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Token.Radius.card, style: .continuous)
                    .stroke(Token.Palette.hairline, lineWidth: 1)
            )
    }
}
