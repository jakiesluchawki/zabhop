import CoreLocation
import SwiftUI

struct CompassView: View {
    @Environment(\.hopPalette) private var palette

    let rotation: CLLocationDirection
    let distance: CLLocationDistance
    let headingAvailable: Bool
    let diameter: CGFloat
    let compact: Bool

    @State private var displayedRotation: CLLocationDirection?

    private var formattedDistance: (value: String, unit: String) {
        let parts = GeoMath.formattedDistance(distance).split(separator: " ", maxSplits: 1)
        return (
            parts.first.map(String.init) ?? "–",
            parts.count > 1 ? String(parts[1]) : ""
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Image("FeltCompass")
                    .resizable()
                    .scaledToFit()
                    .colorMultiply(palette.feltMultiply)

                Image("FeltArrow")
                    .resizable()
                    .scaledToFit()
                    .frame(width: diameter * 0.40, height: diameter * 0.40)
                    .colorMultiply(palette.feltMultiply)
                    .shadow(color: palette.olive.opacity(0.12), radius: 3, y: 2)
                    .rotationEffect(.degrees(displayedRotation ?? rotation))
                    .animation(.easeOut(duration: 0.14), value: displayedRotation)
            }
            .frame(width: diameter, height: diameter)
            .overlay(palette.feltTint.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: compact ? 21 : 24, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Kierunek do sklepu")
            .accessibilityValue(headingAvailable ? "Strzałka wskazuje cel" : "Oczekiwanie na kompas")

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(formattedDistance.value)
                    .font(HopTheme.uiBold(compact ? 50 : 57, relativeTo: .largeTitle))
                    .contentTransition(.numericText())
                    .monospacedDigit()

                Text(formattedDistance.unit)
                    .font(HopTheme.uiBold(compact ? 19 : 21, relativeTo: .title3))
            }
            .foregroundStyle(palette.olive)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .padding(.top, compact ? -5 : -7)

            Text(headingAvailable ? "IDŹ W TYM KIERUNKU" : "PORUSZ TELEFONEM, ŻEBY OBUDZIĆ KOMPAS")
                .font(HopTheme.uiBold(12, relativeTo: .caption))
                .tracking(1.25)
                .foregroundStyle(headingAvailable ? palette.violet : palette.olive)
                .multilineTextAlignment(.center)
                .padding(.top, compact ? -3 : -2)
        }
        .onAppear {
            displayedRotation = rotation
        }
        .onChange(of: rotation) { oldValue, newValue in
            guard distance >= 35 else { return }
            displayedRotation = GeoMath.unwrappedAngle(
                current: displayedRotation ?? oldValue,
                target: newValue
            )
        }
    }
}
