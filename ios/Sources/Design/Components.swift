import SwiftUI

/// Les composants du produit. Aucun n'imite un contrôle système : quand iOS en
/// fournit un, on prend celui d'iOS.

struct SectionCard<Content: View>: View {
    var title: LocalizedStringKey?
    var trailing: AnyView?
    @ViewBuilder var content: Content

    init(_ title: LocalizedStringKey? = nil, trailing: AnyView? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.trailing = trailing
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Token.Space.md) {
            if title != nil || trailing != nil {
                HStack {
                    if let title {
                        Text(title).font(.headline).foregroundStyle(Token.Palette.text)
                    }
                    Spacer(minLength: 0)
                    trailing
                }
            }
            content
        }
        .cardSurface()
    }
}

struct Pill: View {
    enum Tone { case gray, blue, green, orange, red, violet

        var fill: Color {
            switch self {
            case .gray: Token.Palette.tertiary.opacity(0.12)
            case .blue: Token.Palette.blue.opacity(0.10)
            case .green: Token.Palette.green.opacity(0.12)
            case .orange: Token.Palette.orange.opacity(0.12)
            case .red: Token.Palette.red.opacity(0.10)
            case .violet: Token.Palette.violet.opacity(0.12)
            }
        }
        var ink: Color {
            switch self {
            case .gray: Token.Palette.secondary
            case .blue: Token.Palette.blue
            case .green: Token.Palette.green
            case .orange: Token.Palette.orange
            case .red: Token.Palette.red
            case .violet: Token.Palette.violet
            }
        }
    }

    var text: String
    var tone: Tone = .gray
    var dot: Bool = false

    var body: some View {
        HStack(spacing: 6) {
            if dot { Circle().fill(tone.ink).frame(width: 6, height: 6) }
            Text(text).font(.caption).fontWeight(.medium)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(tone.fill, in: Capsule())
        .foregroundStyle(tone.ink)
    }
}

struct ProgressLine: View {
    var value: Double
    var tone: Color = Token.Palette.blue

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Token.Palette.tertiary.opacity(0.15))
                Capsule().fill(tone)
                    .frame(width: max(6, geo.size.width * min(max(value, 0), 1)))
                    .animation(Token.ease, value: value)
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel(Text("suivi.avancement"))
        .accessibilityValue(Text("\(Int(value * 100)) %"))
    }
}

/// Le fil des étapes. Fait rare et volontaire : il est vertical, parce qu'un
/// client lit une progression de haut en bas, pas de gauche à droite.
struct StepTimeline: View {
    struct Step: Identifiable {
        let id: String
        let title: String
        let detail: String?
        let done: Bool
        let current: Bool
    }

    var steps: [Step]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                HStack(alignment: .top, spacing: Token.Space.md) {
                    VStack(spacing: 0) {
                        Circle()
                            .fill(step.done ? Token.Palette.green : Token.Palette.card)
                            .frame(width: 14, height: 14)
                            .overlay(
                                Circle().stroke(
                                    step.done ? Token.Palette.green
                                    : step.current ? Token.Palette.blue
                                    : Token.Palette.hairline,
                                    lineWidth: 2
                                )
                            )
                            .overlay {
                                if step.current {
                                    Circle().stroke(Token.Palette.blue.opacity(0.25), lineWidth: 4)
                                        .frame(width: 22, height: 22)
                                }
                            }
                        if index < steps.count - 1 {
                            Rectangle()
                                .fill(Token.Palette.hairline)
                                .frame(width: 2)
                                .frame(minHeight: 26)
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.title)
                            .font(.subheadline)
                            .fontWeight(step.current ? .semibold : .regular)
                            .foregroundStyle(step.current ? Token.Palette.text : Token.Palette.secondary)
                        if let detail = step.detail {
                            Text(detail).font(.caption).foregroundStyle(Token.Palette.tertiary)
                        }
                    }
                    .padding(.bottom, index < steps.count - 1 ? Token.Space.md : 0)
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

struct EmptyState: View {
    var symbol: String
    var title: LocalizedStringKey
    var hint: LocalizedStringKey?

    var body: some View {
        VStack(spacing: Token.Space.md) {
            Image(systemName: symbol)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Token.Palette.tertiary.opacity(0.5))
            Text(title).font(.headline).foregroundStyle(Token.Palette.text)
            if let hint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(Token.Palette.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Token.Space.xxl)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Token.Palette.blue, in: Capsule())
            .foregroundStyle(.white)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(Token.ease, value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Token.Palette.card, in: Capsule())
            .overlay(Capsule().stroke(Token.Palette.hairline, lineWidth: 1))
            .foregroundStyle(Token.Palette.text)
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}
