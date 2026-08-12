import SwiftUI

struct StormBackground: View {
    @Environment(\.hopPalette) private var palette

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.055, green: 0.13, blue: 0.12),
                        Color(red: 0.02, green: 0.065, blue: 0.06),
                        .black
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                CloudCluster()
                    .fill(palette.mist.opacity(0.11))
                    .frame(width: proxy.size.width * 0.9, height: 180)
                    .rotationEffect(.degrees(-8))
                    .offset(x: -80, y: -proxy.size.height * 0.34)

                CloudCluster()
                    .fill(palette.olive.opacity(0.055))
                    .frame(width: proxy.size.width, height: 210)
                    .rotationEffect(.degrees(12))
                    .offset(x: 90, y: proxy.size.height * 0.34)

                Canvas { context, size in
                    var seed: UInt64 = 0xC10D5
                    for _ in 0..<72 {
                        seed = seed &* 6364136223846793005 &+ 1
                        let x = CGFloat(seed % 10_000) / 10_000 * size.width
                        seed = seed &* 6364136223846793005 &+ 1
                        let y = CGFloat(seed % 10_000) / 10_000 * size.height
                        seed = seed &* 6364136223846793005 &+ 1
                        let diameter = CGFloat(1 + seed % 3)
                        context.fill(
                            Path(ellipseIn: CGRect(x: x, y: y, width: diameter, height: diameter)),
                            with: .color(palette.ivory.opacity(0.09))
                        )
                    }
                }
                .blendMode(.screen)
            }
            .ignoresSafeArea()
        }
        .accessibilityHidden(true)
    }
}

struct CloudCluster: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addEllipse(in: CGRect(x: rect.minX, y: rect.midY - rect.height * 0.20, width: rect.width * 0.38, height: rect.height * 0.45))
        path.addEllipse(in: CGRect(x: rect.minX + rect.width * 0.18, y: rect.minY + rect.height * 0.08, width: rect.width * 0.42, height: rect.height * 0.72))
        path.addEllipse(in: CGRect(x: rect.minX + rect.width * 0.48, y: rect.minY + rect.height * 0.18, width: rect.width * 0.38, height: rect.height * 0.60))
        path.addEllipse(in: CGRect(x: rect.minX + rect.width * 0.70, y: rect.midY - rect.height * 0.14, width: rect.width * 0.30, height: rect.height * 0.42))
        path.addRoundedRect(
            in: CGRect(x: rect.minX + rect.width * 0.08, y: rect.midY, width: rect.width * 0.84, height: rect.height * 0.30),
            cornerSize: CGSize(width: rect.height * 0.15, height: rect.height * 0.15)
        )
        return path
    }
}
