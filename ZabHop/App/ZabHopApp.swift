import Foundation
import SwiftUI

@main
struct ZabHopApp: App {
#if DEBUG
    init() {
        if ProcessInfo.processInfo.arguments.contains("--uitest-reset-onboarding") {
            UserDefaults.standard.removeObject(forKey: "zabhop.hasStarted")
        }
    }
#endif

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.light)
        }
    }
}
