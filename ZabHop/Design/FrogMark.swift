import SwiftUI

struct FrogMark: View {
    var mood: Mood = .happy

    enum Mood {
        case happy
        case searching
        case worried
    }

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width, proxy.size.height)
            ZStack {
                Circle()
                    .fill(HopTheme.frog)
                    .overlay(Circle().stroke(HopTheme.ink, lineWidth: size * 0.075))

                eye(x: -0.22, size: size)
                eye(x: 0.22, size: size)

                mouth(size: size)

                Circle()
                    .fill(HopTheme.coral.opacity(0.7))
                    .frame(width: size * 0.12)
                    .offset(x: -size * 0.30, y: size * 0.13)

                Circle()
                    .fill(HopTheme.coral.opacity(0.7))
                    .frame(width: size * 0.12)
                    .offset(x: size * 0.30, y: size * 0.13)
            }
            .frame(width: size, height: size)
            .rotationEffect(.degrees(-2))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private func eye(x: CGFloat, size: CGFloat) -> some View {
        ZStack {
            Circle().fill(HopTheme.paper)
            Circle().fill(HopTheme.ink).padding(size * 0.035)
            Circle().fill(.white).frame(width: size * 0.035)
                .offset(x: -size * 0.018, y: -size * 0.025)
        }
        .frame(width: size * 0.22, height: size * 0.22)
        .offset(x: size * x, y: -size * 0.11)
    }

    @ViewBuilder
    private func mouth(size: CGFloat) -> some View {
        switch mood {
        case .happy:
            SmileShape()
                .stroke(HopTheme.ink, style: StrokeStyle(lineWidth: size * 0.055, lineCap: .round))
                .frame(width: size * 0.38, height: size * 0.20)
                .offset(y: size * 0.16)
        case .searching:
            Capsule()
                .fill(HopTheme.ink)
                .frame(width: size * 0.18, height: size * 0.07)
                .offset(y: size * 0.20)
        case .worried:
            SmileShape()
                .stroke(HopTheme.ink, style: StrokeStyle(lineWidth: size * 0.055, lineCap: .round))
                .frame(width: size * 0.34, height: size * 0.18)
                .rotationEffect(.degrees(180))
                .offset(y: size * 0.23)
        }
    }
}

private struct SmileShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.midX, y: rect.maxY)
        )
        return path
    }
}
