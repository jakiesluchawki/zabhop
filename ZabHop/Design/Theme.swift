import SwiftUI

enum HopThemeChoice: String, CaseIterable, Identifiable {
    case roseMeadow
    case sageForest
    case blueMorning
    case honeySunset

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .roseMeadow: "Różana Łąka"
        case .sageForest: "Szałwiowy Las"
        case .blueMorning: "Błękitny Poranek"
        case .honeySunset: "Miodowy Zachód"
        }
    }

    var next: HopThemeChoice {
        let themes = Self.allCases
        guard let index = themes.firstIndex(of: self) else { return .roseMeadow }
        return themes[(index + 1) % themes.count]
    }

    var palette: HopPalette {
        switch self {
        case .roseMeadow: .roseMeadow
        case .sageForest: .sageForest
        case .blueMorning: .blueMorning
        case .honeySunset: .honeySunset
        }
    }
}

struct HopPalette: Equatable {
    let canvas: Color
    let rose: Color
    let olive: Color
    let oliveDark: Color
    let violet: Color
    let violetBright: Color
    let ivory: Color
    let mist: Color
    let feltTint: Color
    let feltMultiply: Color

    var mutedOlive: Color { olive.opacity(0.72) }
    var hairline: Color { olive.opacity(0.20) }

    static let roseMeadow = HopPalette(
        canvas: Color(red: 1.00, green: 0.882, blue: 0.922),
        rose: Color(red: 0.965, green: 0.806, blue: 0.846),
        olive: Color(red: 0.427, green: 0.392, blue: 0.208),
        oliveDark: Color(red: 0.300, green: 0.274, blue: 0.145),
        violet: Color(red: 0.455, green: 0.259, blue: 0.851),
        violetBright: Color(red: 0.604, green: 0.408, blue: 1.000),
        ivory: Color(red: 1.000, green: 0.969, blue: 0.945),
        mist: Color(red: 0.886, green: 0.945, blue: 1.000),
        feltTint: Color(red: 1.00, green: 0.77, blue: 0.86),
        feltMultiply: .white
    )

    static let sageForest = HopPalette(
        canvas: Color(red: 0.865, green: 0.914, blue: 0.824),
        rose: Color(red: 0.735, green: 0.838, blue: 0.693),
        olive: Color(red: 0.295, green: 0.374, blue: 0.222),
        oliveDark: Color(red: 0.170, green: 0.245, blue: 0.145),
        violet: Color(red: 0.310, green: 0.438, blue: 0.302),
        violetBright: Color(red: 0.430, green: 0.600, blue: 0.407),
        ivory: Color(red: 0.982, green: 0.972, blue: 0.906),
        mist: Color(red: 0.820, green: 0.910, blue: 0.850),
        feltTint: Color(red: 0.58, green: 0.78, blue: 0.52),
        feltMultiply: Color(red: 0.87, green: 1.00, blue: 0.86)
    )

    static let blueMorning = HopPalette(
        canvas: Color(red: 0.833, green: 0.922, blue: 0.965),
        rose: Color(red: 0.733, green: 0.873, blue: 0.945),
        olive: Color(red: 0.245, green: 0.378, blue: 0.438),
        oliveDark: Color(red: 0.135, green: 0.270, blue: 0.330),
        violet: Color(red: 0.245, green: 0.455, blue: 0.705),
        violetBright: Color(red: 0.330, green: 0.610, blue: 0.880),
        ivory: Color(red: 0.965, green: 0.980, blue: 0.962),
        mist: Color(red: 0.785, green: 0.905, blue: 0.980),
        feltTint: Color(red: 0.52, green: 0.76, blue: 0.96),
        feltMultiply: Color(red: 0.86, green: 0.96, blue: 1.00)
    )

    static let honeySunset = HopPalette(
        canvas: Color(red: 1.000, green: 0.874, blue: 0.694),
        rose: Color(red: 0.980, green: 0.740, blue: 0.475),
        olive: Color(red: 0.440, green: 0.310, blue: 0.145),
        oliveDark: Color(red: 0.305, green: 0.195, blue: 0.080),
        violet: Color(red: 0.760, green: 0.330, blue: 0.220),
        violetBright: Color(red: 0.915, green: 0.475, blue: 0.260),
        ivory: Color(red: 1.000, green: 0.962, blue: 0.840),
        mist: Color(red: 1.000, green: 0.885, blue: 0.655),
        feltTint: Color(red: 1.00, green: 0.65, blue: 0.30),
        feltMultiply: Color(red: 1.00, green: 0.94, blue: 0.78)
    )
}

private struct HopPaletteKey: EnvironmentKey {
    static let defaultValue = HopPalette.roseMeadow
}

extension EnvironmentValues {
    var hopPalette: HopPalette {
        get { self[HopPaletteKey.self] }
        set { self[HopPaletteKey.self] = newValue }
    }
}

enum HopTheme {
    // CHMURNIK-inspired felt palette used by the approved web redesign.
    static let canvas = Color(red: 1.00, green: 0.882, blue: 0.922)
    static let rose = Color(red: 0.965, green: 0.806, blue: 0.846)
    static let olive = Color(red: 0.427, green: 0.392, blue: 0.208)
    static let oliveDark = Color(red: 0.300, green: 0.274, blue: 0.145)
    static let violet = Color(red: 0.455, green: 0.259, blue: 0.851)
    static let violetBright = Color(red: 0.604, green: 0.408, blue: 1.000)
    static let ivory = Color(red: 1.000, green: 0.969, blue: 0.945)
    static let mist = Color(red: 0.886, green: 0.945, blue: 1.000)
    static let mutedOlive = olive.opacity(0.72)
    static let hairline = olive.opacity(0.20)

    // Kept for the legacy procedural marks that remain in the target but are no
    // longer used by the redesigned screens.
    static let ink = oliveDark
    static let frog = olive
    static let paper = ivory
    static let rain = mist
    static let fog = ivory
    static let coral = rose

    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("Romie-Regular", size: size, relativeTo: style)
    }

    static func ui(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("Roobert-Regular", size: size, relativeTo: style)
    }

    static func uiBold(_ size: CGFloat, relativeTo style: Font.TextStyle = .headline) -> Font {
        .custom("Roobert-Bold", size: size, relativeTo: style)
    }
}

struct FeltCardModifier: ViewModifier {
    @Environment(\.hopPalette) private var palette

    var padding: CGFloat = 18
    var cornerRadius: CGFloat = 28

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(palette.ivory.opacity(0.72))
                    .stroke(palette.olive.opacity(0.12), lineWidth: 1)
            )
            .shadow(color: palette.olive.opacity(0.09), radius: 14, y: 8)
    }
}

extension View {
    func feltCard(padding: CGFloat = 18, cornerRadius: CGFloat = 28) -> some View {
        modifier(FeltCardModifier(padding: padding, cornerRadius: cornerRadius))
    }
}

struct HopPrimaryButtonStyle: ButtonStyle {
    var palette: HopPalette = .roseMeadow
    var minimumHeight: CGFloat = 54

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HopTheme.uiBold(16, relativeTo: .headline))
            .foregroundStyle(palette.ivory)
            .padding(.horizontal, 16)
            .frame(minHeight: minimumHeight)
            .background(
                palette.violet.opacity(configuration.isPressed ? 0.76 : 1),
                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct HopSecondaryButtonStyle: ButtonStyle {
    var palette: HopPalette = .roseMeadow
    var minimumHeight: CGFloat = 54

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HopTheme.uiBold(16, relativeTo: .headline))
            .foregroundStyle(palette.olive)
            .padding(.horizontal, 16)
            .frame(minHeight: minimumHeight)
            .background(
                palette.ivory.opacity(configuration.isPressed ? 0.54 : 0.30),
                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(palette.olive, lineWidth: 1)
            }
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
