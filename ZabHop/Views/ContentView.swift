import Combine
import CoreLocation
import Foundation
import MapKit
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var locationService = LocationService()
    @StateObject private var storeSearch = StoreSearchService()
    @StateObject private var walkingRoute = WalkingRouteService()

    @AppStorage("zabhop.hasStarted") private var hasStarted = false
    @AppStorage("zabhop.storeMode") private var storeMode: StoreMode = .zabka
    @AppStorage("zabhop.storeAvailability") private var availability: StoreAvailability = .openNow
    @AppStorage("zabhop.visualTheme") private var visualTheme: HopThemeChoice = .roseMeadow
    @State private var selectedStoreID: Store.ID?
    @State private var showingStores = false
    @State private var arrivalNotifiedStoreID: Store.ID?
    @State private var evaluationDate = Date()

    private static let minuteTicker = Timer.publish(
        every: 60,
        tolerance: 2,
        on: .main,
        in: .common
    ).autoconnect()

    private var selectedStore: Store? {
        storeSearch.stores.first { $0.id == selectedStoreID } ?? storeSearch.stores.first
    }

    private var palette: HopPalette { visualTheme.palette }

    var body: some View {
        GeometryReader { proxy in
            let layout = ActiveScreenLayout(size: proxy.size)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    brandHeader(layout: layout)

                    Rectangle()
                        .fill(palette.hairline)
                        .frame(height: 1)
                        .padding(.horizontal, layout.horizontalInset)

                    storeModePicker(layout: layout)
                    availabilityPicker(layout: layout)

                    if hasStarted {
                        activeContent(layout: layout)
                    } else {
                        landingContent(layout: layout)
                    }

                    disclaimer(layout: layout)
                }
                .padding(.bottom, hasStarted ? layout.bottomPadding : 16)
            }
            // The scroll viewport must match the window, including iPad's iPhone
            // compatibility size. Decorative tiles must not enlarge its layout.
            .frame(width: proxy.size.width, height: proxy.size.height)
            .background(alignment: .top) {
                ZStack(alignment: .top) {
                    palette.canvas

                    VStack(spacing: 0) {
                        ForEach(0..<3, id: \.self) { index in
                            Image("FeltBackground")
                                .resizable()
                                .scaledToFit()
                                .frame(width: proxy.size.width, height: proxy.size.width)
                                .rotationEffect(.degrees(index.isMultiple(of: 2) ? 0 : 180))
                                .colorMultiply(palette.feltMultiply)
                                .overlay(palette.feltTint.opacity(0.08))
                        }
                    }
                    .opacity(0.34)
                }
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .scrollBounceBehavior(.basedOnSize)
            .refreshable {
                guard hasStarted else { return }
                await refresh()
            }
        }
        .environment(\.hopPalette, palette)
        .tint(palette.violet)
        .animation(.easeInOut(duration: 0.28), value: visualTheme)
        .task {
            if hasStarted {
                locationService.start()
                await refreshCatalogs()
            }
        }
        .onReceive(locationService.$location.compactMap { $0 }) { location in
            Task {
                let now = Date()
                evaluationDate = now
                await storeSearch.search(
                    near: location,
                    mode: storeMode,
                    availability: availability,
                    at: now
                )
                if await storeSearch.refreshCatalogIfNeeded(mode: storeMode) {
                    await storeSearch.search(
                        near: location,
                        mode: storeMode,
                        availability: availability,
                        force: true,
                        at: Date()
                    )
                }
                if selectedStoreID == nil {
                    selectedStoreID = storeSearch.stores.first?.id
                }
                if let selectedStore {
                    walkingRoute.update(for: selectedStore, from: location)
                }
                checkArrival(at: location)
            }
        }
        .onReceive(Self.minuteTicker) { date in
            evaluationDate = date
            guard hasStarted, let location = locationService.location else { return }
            Task {
                await storeSearch.search(
                    near: location,
                    mode: storeMode,
                    availability: availability,
                    force: true,
                    at: date
                )
                if let selectedStore {
                    walkingRoute.update(for: selectedStore, from: location, now: date)
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else {
                walkingRoute.cancel()
                return
            }
            let now = Date()
            evaluationDate = now
            guard hasStarted, let location = locationService.location else { return }
            Task {
                await storeSearch.search(
                    near: location,
                    mode: storeMode,
                    availability: availability,
                    force: true,
                    at: now
                )
                if let selectedStore {
                    walkingRoute.update(for: selectedStore, from: location, force: true, now: now)
                }
                await refreshCatalogs()
            }
        }
        .onChange(of: storeSearch.stores) { _, stores in
            if let selectedStoreID, stores.contains(where: { $0.id == selectedStoreID }) {
                return
            }
            self.selectedStoreID = stores.first?.id
        }
        .onChange(of: selectedStoreID) { _, _ in
            guard let selectedStore, let location = locationService.location else { return }
            walkingRoute.update(for: selectedStore, from: location, force: true)
        }
        .sheet(isPresented: $showingStores) {
            if let location = locationService.location {
                StoreListSheet(
                    stores: storeSearch.stores,
                    currentLocation: location,
                    mode: storeMode,
                    availability: availability,
                    evaluationDate: evaluationDate,
                    selectedWalkingEstimate: walkingRoute.estimate,
                    selectedStoreID: $selectedStoreID
                )
                .environment(\.hopPalette, palette)
            }
        }
    }

    private func brandHeader(layout: ActiveScreenLayout) -> some View {
        HStack(spacing: layout.isCompact ? 8 : 10) {
            Image("FeltFrog")
                .resizable()
                .scaledToFill()
                .frame(width: layout.headerIconSize, height: layout.headerIconSize)
                .colorMultiply(palette.feltMultiply)
                .overlay(palette.feltTint.opacity(0.09))
                .clipShape(RoundedRectangle(cornerRadius: layout.isCompact ? 10 : 12, style: .continuous))

            VStack(alignment: .leading, spacing: -2) {
                Text("ŻabHop")
                    .font(HopTheme.display(layout.isCompact ? 26 : 29, relativeTo: .title2))
                    .foregroundStyle(palette.oliveDark)

                Text("TERENOWY SKLEP RADAR")
                    .font(HopTheme.uiBold(9, relativeTo: .caption2))
                    .tracking(layout.isCompact ? 0.8 : 1.1)
                    .foregroundStyle(palette.olive)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }

            Spacer(minLength: 2)

            Button {
                visualTheme = visualTheme.next
            } label: {
                Image(systemName: "paintpalette.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.violet)
                    .frame(width: 30, height: 30)
                    .background(palette.ivory.opacity(0.32), in: Circle())
                    .overlay {
                        Circle().stroke(palette.olive.opacity(0.22), lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Motyw: \(visualTheme.displayName). Przełącz na \(visualTheme.next.displayName)")

            statusPill
        }
        .padding(.horizontal, layout.horizontalInset)
        .padding(.vertical, layout.headerVerticalPadding)
    }

    private func storeModePicker(layout: ActiveScreenLayout) -> some View {
        HStack(spacing: 4) {
            ForEach(StoreMode.allCases) { mode in
                Button {
                    selectStoreMode(mode)
                } label: {
                    Text(mode.buttonTitle)
                        .font(HopTheme.uiBold(13, relativeTo: .footnote))
                        .frame(maxWidth: .infinity)
                        .frame(height: layout.storeModeHeight)
                }
                .buttonStyle(.plain)
                .foregroundStyle(storeMode == mode ? palette.ivory : palette.olive)
                .background(
                    storeMode == mode ? palette.violet : Color.clear,
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
                .accessibilityAddTraits(storeMode == mode ? .isSelected : [])
            }
        }
        .padding(4)
        .background(palette.ivory.opacity(0.72), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(palette.olive.opacity(0.20), lineWidth: 1)
        }
        .padding(.horizontal, layout.horizontalInset)
        .padding(.top, layout.storeModeTopPadding)
    }

    private func availabilityPicker(layout: ActiveScreenLayout) -> some View {
        HStack(spacing: 4) {
            ForEach(StoreAvailability.allCases) { option in
                Button {
                    selectAvailability(option)
                } label: {
                    Text(option.buttonTitle)
                        .font(HopTheme.uiBold(12, relativeTo: .caption))
                        .frame(maxWidth: .infinity)
                        .frame(height: layout.availabilityHeight)
                }
                .buttonStyle(.plain)
                .foregroundStyle(availability == option ? palette.violet : palette.olive)
                .background(
                    availability == option ? palette.rose.opacity(0.58) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                )
                .accessibilityAddTraits(availability == option ? .isSelected : [])
            }
        }
        .padding(3)
        .background(palette.ivory.opacity(0.48), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(palette.olive.opacity(0.16), lineWidth: 1)
        }
        .padding(.horizontal, layout.horizontalInset)
        .padding(.top, layout.availabilityTopPadding)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Kiedy chcesz zrobić zakupy")
    }

    private func landingContent(layout: ActiveScreenLayout) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Image("FeltFrog")
                .resizable()
                .scaledToFill()
                .frame(width: layout.landingImageWidth, height: layout.landingImageWidth / 1.13)
                .colorMultiply(palette.feltMultiply)
                .overlay(palette.feltTint.opacity(0.09))
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .padding(.top, 20)

            Text(storeMode.nearestTitle)
                .font(HopTheme.uiBold(11, relativeTo: .caption))
                .tracking(1.7)
                .foregroundStyle(palette.olive)
                .padding(.top, 18)

            Text("Hop, po\nzakupy.")
                .font(HopTheme.display(57, relativeTo: .largeTitle))
                .foregroundStyle(palette.oliveDark)
                .tracking(-1.4)
                .lineSpacing(-9)
                .padding(.top, 4)

            Text("Jedno kliknięcie. Potem idziesz za naprawdę wielką strzałką.")
                .font(HopTheme.ui(17, relativeTo: .body))
                .foregroundStyle(palette.olive)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)

            Button {
                hasStarted = true
                locationService.start()
            } label: {
                Text(landingButtonTitle)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(HopPrimaryButtonStyle(palette: palette))
            .accessibilityIdentifier("welcome.start")
            .padding(.top, 18)

            Button {
                showStoreSearchInMaps()
            } label: {
                Text(storeMode == .zabka ? "Pokaż Żabki w Apple Maps" : "Pokaż sklepy w Apple Maps")
                    .font(HopTheme.ui(13, relativeTo: .footnote))
                    .underline()
                    .foregroundStyle(palette.olive)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("welcome.maps")
        }
        .padding(.horizontal, layout.horizontalInset)
    }

    @ViewBuilder
    private func activeContent(layout: ActiveScreenLayout) -> some View {
        switch locationService.state {
        case .denied, .restricted:
            permissionCard
                .padding(.horizontal, layout.horizontalInset)
                .padding(.top, layout.navigationTopPadding)

        case .failed(let message):
            errorCard(title: "Żaba zgubiła trop", message: message) {
                locationService.refreshLocation()
            }
            .padding(.horizontal, layout.horizontalInset)
            .padding(.top, layout.navigationTopPadding)

        default:
            if let location = locationService.location,
               let store = selectedStore {
                navigationContent(store: store, location: location, layout: layout)
            } else {
                searchStateContent
                    .padding(.horizontal, layout.horizontalInset)
                    .padding(.top, layout.navigationTopPadding)
            }
        }
    }

    private func navigationContent(
        store: Store,
        location: CLLocation,
        layout: ActiveScreenLayout
    ) -> some View {
        let distance = store.distance(from: location)
        let openingStatus = store.assessedOpeningStatus(
            at: evaluationDate,
            mode: storeMode,
            availability: availability
        )
        let targetBearing = GeoMath.bearing(from: location.coordinate, to: store.coordinate)
        let rotation = GeoMath.compassRotation(
            targetBearing: targetBearing,
            deviceHeading: locationService.heading ?? 0
        )
        let storeIndex = storeSearch.stores.firstIndex(where: { $0.id == store.id }) ?? 0

        return VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(storeMode.nearestTitle)
                        .font(HopTheme.uiBold(11, relativeTo: .caption))
                        .tracking(1.6)
                        .foregroundStyle(palette.olive)

                    Text("KIERUNEK NA ŻYWO")
                        .font(HopTheme.uiBold(12, relativeTo: .caption))
                        .foregroundStyle(palette.violet)
                }

                Spacer()

                Button("Odśwież") {
                    Task { await refresh() }
                }
                .font(HopTheme.ui(13, relativeTo: .footnote))
                .foregroundStyle(palette.olive)
                .underline()
            }
            .padding(.top, layout.navigationTopPadding)
            .padding(.bottom, layout.navigationHeaderBottomPadding)

            CompassView(
                rotation: rotation,
                distance: distance,
                headingAvailable: locationService.heading != nil,
                diameter: layout.compassDiameter,
                compact: layout.isCompact
            )

            Rectangle()
                .fill(palette.hairline)
                .frame(height: 1)
                .padding(.top, layout.dividerTopPadding)

            HStack(spacing: layout.isCompact ? 11 : 14) {
                Text(String(format: "%02d", storeIndex + 1))
                    .font(HopTheme.uiBold(11, relativeTo: .caption))
                    .foregroundStyle(palette.ivory)
                    .frame(width: layout.storeBadgeSize, height: layout.storeBadgeSize)
                    .background(palette.olive, in: Circle())

                VStack(alignment: .leading, spacing: layout.isCompact ? 1 : 3) {
                    Text(distance < 35 ? "Jesteś na miejscu!" : store.name)
                        .font(HopTheme.display(layout.storeTitleSize, relativeTo: .title2))
                        .foregroundStyle(palette.oliveDark)
                        .lineLimit(1)

                    Text(store.address)
                        .font(HopTheme.ui(12, relativeTo: .caption))
                        .foregroundStyle(palette.olive)
                        .lineLimit(layout.isCompact ? 1 : 2)

                    Text(openingStatus.label)
                        .font(HopTheme.uiBold(11, relativeTo: .caption2))
                        .foregroundStyle(statusColor(openingStatus))
                        .lineLimit(1)

                    if distance >= 35, let walkingEstimate = walkingRoute.estimate {
                        HStack(spacing: 4) {
                            Image(systemName: "figure.walk")
                            Text("\(walkingEstimate.formattedDuration) pieszo")
                            if walkingEstimate.isRouteBased {
                                Text("· trasa Apple Maps")
                            }
                        }
                        .font(HopTheme.uiBold(10, relativeTo: .caption2))
                        .foregroundStyle(palette.olive)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.vertical, layout.storeRowVerticalPadding)

            Rectangle()
                .fill(palette.hairline)
                .frame(height: 1)

            HStack(spacing: 10) {
                Button {
                    showingStores = true
                } label: {
                    Text("\(storeSearch.stores.count) sklepów")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(HopSecondaryButtonStyle(palette: palette, minimumHeight: layout.buttonHeight))

                Button {
                    openInMaps(store)
                } label: {
                    Text("Trasa pieszo")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(HopPrimaryButtonStyle(palette: palette, minimumHeight: layout.buttonHeight))
            }
            .padding(.top, layout.buttonTopPadding)
        }
        .padding(.horizontal, layout.horizontalInset)
    }

    @ViewBuilder
    private var searchStateContent: some View {
        switch storeSearch.state {
        case .failed(let message):
            errorCard(title: "Sklepy schowały się w chmurach", message: message) {
                storeSearch.retry(
                    near: locationService.location,
                    mode: storeMode,
                    availability: availability
                )
            }

        case .empty:
            if availability == .openNow {
                errorCard(
                    title: "Nic pewnego na teraz",
                    message: "Nie mam potwierdzenia, że pobliski sklep jest teraz otwarty. Zobacz wszystkie sklepy — także zamknięte i bez podanych godzin.",
                    actionTitle: "Pokaż wszystkie"
                ) {
                    selectAvailability(.planning)
                }
            } else {
                errorCard(
                    title: storeMode == .zabka ? "Ani jednej żaby w pobliżu" : "Sklepy się pochowały",
                    message: storeMode == .zabka
                        ? "Nie znalazłem Żabki w tej okolicy. Przesuń się kawałek albo spróbuj ponownie."
                        : "Nie znalazłem innego sklepu w tej okolicy. Przesuń się kawałek albo spróbuj ponownie."
                ) {
                    storeSearch.retry(
                        near: locationService.location,
                        mode: storeMode,
                        availability: availability
                    )
                }
            }

        default:
            VStack(spacing: 17) {
                Image("FeltFrog")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 156, height: 156)
                    .colorMultiply(palette.feltMultiply)
                    .overlay(palette.feltTint.opacity(0.09))
                    .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))

                VStack(spacing: 7) {
                    Text(
                        locationService.location == nil
                            ? "Łapię Twój trop…"
                            : (storeMode == .zabka ? "Wypatruję Żabek…" : "Wypatruję innych sklepów…")
                    )
                        .font(HopTheme.display(33, relativeTo: .title))
                        .foregroundStyle(palette.oliveDark)

                    Text("To zwykle trwa tylko chwilę.")
                        .font(HopTheme.ui(15, relativeTo: .subheadline))
                        .foregroundStyle(palette.olive)
                }

                ProgressView()
                    .controlSize(.large)
                    .tint(palette.violet)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 26)
            .feltCard()
        }
    }

    private var permissionCard: some View {
        VStack(spacing: 18) {
            Image("FeltFrog")
                .resizable()
                .scaledToFill()
                .frame(width: 156, height: 156)
                .colorMultiply(palette.feltMultiply)
                .overlay(palette.feltTint.opacity(0.09))
                .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))

            VStack(spacing: 8) {
                Text("Bez lokalizacji ani hop")
                    .font(HopTheme.display(34, relativeTo: .title))
                    .foregroundStyle(palette.oliveDark)
                    .multilineTextAlignment(.center)

                Text("Włącz dostęp „Podczas używania aplikacji”, żebym mógł znaleźć sklep i obracać strzałkę.")
                    .font(HopTheme.ui(16, relativeTo: .body))
                    .foregroundStyle(palette.olive)
                    .multilineTextAlignment(.center)
            }

            Button {
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            } label: {
                Text("Otwórz ustawienia")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(HopPrimaryButtonStyle(palette: palette))
        }
        .feltCard()
    }

    private func errorCard(
        title: String,
        message: String,
        actionTitle: String = "Spróbuj ponownie",
        retry: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 18) {
            Image("FeltFrog")
                .resizable()
                .scaledToFill()
                .frame(width: 142, height: 142)
                .colorMultiply(palette.feltMultiply)
                .overlay(palette.feltTint.opacity(0.09))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

            VStack(spacing: 8) {
                Text(title)
                    .font(HopTheme.display(33, relativeTo: .title))
                    .foregroundStyle(palette.oliveDark)
                    .multilineTextAlignment(.center)

                Text(message)
                    .font(HopTheme.ui(16, relativeTo: .body))
                    .foregroundStyle(palette.olive)
                    .multilineTextAlignment(.center)
            }

            Button(action: retry) {
                Text(actionTitle)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(HopPrimaryButtonStyle(palette: palette))
        }
        .feltCard()
    }

    private var statusPill: some View {
        let text: String
        if !hasStarted {
            text = "GOTOWY"
        } else if locationService.state == .ready && storeSearch.state == .ready {
            text = "NA ŻYWO"
        } else {
            text = "SZUKAM"
        }

        return HStack(spacing: 7) {
            Circle()
                .fill(palette.violet)
                .frame(width: 7, height: 7)

            Text(text)
                .font(HopTheme.uiBold(9, relativeTo: .caption2))
                .tracking(0.9)
        }
        .foregroundStyle(palette.olive)
        .padding(.horizontal, 12)
        .frame(height: 30)
        .background(palette.ivory.opacity(0.22), in: Capsule())
        .overlay {
            Capsule().stroke(palette.olive.opacity(0.28), lineWidth: 1)
        }
    }

    private func disclaimer(layout: ActiveScreenLayout) -> some View {
        VStack(spacing: 4) {
            Text("Nieoficjalna aplikacja • baza Żabki: Żabka Polska • trasy: Apple Maps")

            Link("Dane innych sklepów: © OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                .underline()

            HStack(spacing: 18) {
                Link("Prywatność", destination: URL(string: "https://jakiesluchawki.github.io/zabhop/privacy.html")!)
                    .underline()
                    .frame(minHeight: 44)

                Link("Pomoc", destination: URL(string: "https://jakiesluchawki.github.io/zabhop/support.html")!)
                    .underline()
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("storeScreen.help")
            }
            .foregroundStyle(palette.olive)
        }
        .font(HopTheme.ui(10, relativeTo: .caption2))
        .foregroundStyle(palette.olive.opacity(0.58))
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, hasStarted ? layout.disclaimerTopPadding : 20)
    }

    private func refresh() async {
        let now = Date()
        evaluationDate = now
        if let location = locationService.location {
            await storeSearch.search(
                near: location,
                mode: storeMode,
                availability: availability,
                force: true,
                at: now
            )
            await refreshCatalogs(force: true)
            if let selectedStore {
                walkingRoute.update(for: selectedStore, from: location, force: true, now: now)
            }
        } else {
            locationService.refreshLocation()
        }
    }

    private func refreshCatalogs(force: Bool = false) async {
        let preferredMode = storeMode
        let activeCatalogUpdated = await storeSearch.refreshCatalogIfNeeded(
            mode: preferredMode,
            force: force
        )
        let secondaryMode: StoreMode = preferredMode == .zabka ? .other : .zabka
        _ = await storeSearch.refreshCatalogIfNeeded(mode: secondaryMode, force: force)

        guard activeCatalogUpdated,
              storeMode == preferredMode,
              let location = locationService.location else {
            return
        }

        let now = Date()
        evaluationDate = now
        await storeSearch.search(
            near: location,
            mode: preferredMode,
            availability: availability,
            force: true,
            at: now
        )
    }

    private func showStoreSearchInMaps() {
        guard let query = storeMode.mapsQuery.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "http://maps.apple.com/?q=\(query)") else { return }
        UIApplication.shared.open(url)
    }

    private func selectStoreMode(_ mode: StoreMode) {
        guard storeMode != mode else { return }
        storeMode = mode
        selectedStoreID = nil
        arrivalNotifiedStoreID = nil

        guard hasStarted, let location = locationService.location else { return }
        Task {
            let now = Date()
            evaluationDate = now
            await storeSearch.search(
                near: location,
                mode: mode,
                availability: availability,
                force: true,
                at: now
            )
            if await storeSearch.refreshCatalogIfNeeded(mode: mode) {
                await storeSearch.search(
                    near: location,
                    mode: mode,
                    availability: availability,
                    force: true,
                    at: Date()
                )
            }
        }
    }

    private func selectAvailability(_ option: StoreAvailability) {
        guard availability != option else { return }
        availability = option
        selectedStoreID = nil
        arrivalNotifiedStoreID = nil

        guard hasStarted, let location = locationService.location else { return }
        Task {
            let now = Date()
            evaluationDate = now
            await storeSearch.search(
                near: location,
                mode: storeMode,
                availability: option,
                force: true,
                at: now
            )
        }
    }

    private var landingButtonTitle: String {
        switch (storeMode, availability) {
        case (.zabka, .openNow): "Znajdź otwartą Żabkę"
        case (.zabka, .planning): "Znajdź najbliższą"
        case (.other, .openNow): "Znajdź otwarty sklep"
        case (.other, .planning): "Znajdź najbliższy sklep"
        }
    }

    private func statusColor(_ status: StoreOpenStatus) -> Color {
        if status.transition?.kind == .closing { return palette.violet }
        return switch status.state {
        case .open: palette.oliveDark
        case .probablyOpen: palette.olive
        case .closed: palette.violet
        case .unknown: palette.mutedOlive
        }
    }

    private func openInMaps(_ store: Store) {
        store.mapItem.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
        ])
    }

    private func checkArrival(at location: CLLocation) {
        guard let store = selectedStore else { return }
        let distance = store.distance(from: location)
        guard distance < 35, arrivalNotifiedStoreID != store.id else { return }
        arrivalNotifiedStoreID = store.id

        let feedback = UINotificationFeedbackGenerator()
        feedback.prepare()
        feedback.notificationOccurred(.success)
    }
}

private struct ActiveScreenLayout {
    let size: CGSize

    var isCompact: Bool { size.height < 790 || size.width < 380 }
    var horizontalInset: CGFloat { size.width < 375 ? 14 : 18 }
    var landingImageWidth: CGFloat { max(0, size.width - horizontalInset * 2) }
    var headerIconSize: CGFloat { isCompact ? 38 : 42 }
    var headerVerticalPadding: CGFloat { isCompact ? 5 : 7 }
    var storeModeHeight: CGFloat { isCompact ? 30 : 33 }
    var storeModeTopPadding: CGFloat { isCompact ? 6 : 8 }
    var availabilityHeight: CGFloat { isCompact ? 26 : 28 }
    var availabilityTopPadding: CGFloat { isCompact ? 4 : 5 }
    var navigationTopPadding: CGFloat { isCompact ? 8 : 10 }
    var navigationHeaderBottomPadding: CGFloat { isCompact ? 5 : 7 }
    var dividerTopPadding: CGFloat { isCompact ? 7 : 10 }
    var storeBadgeSize: CGFloat { isCompact ? 32 : 36 }
    var storeTitleSize: CGFloat { isCompact ? 25 : 27 }
    var storeRowVerticalPadding: CGFloat { isCompact ? 5 : 7 }
    var buttonHeight: CGFloat { isCompact ? 46 : 50 }
    var buttonTopPadding: CGFloat { isCompact ? 7 : 9 }
    var disclaimerTopPadding: CGFloat { isCompact ? 7 : 10 }
    var bottomPadding: CGFloat { isCompact ? 2 : 6 }

    var compassDiameter: CGFloat {
        let heightDriven = size.height * 0.315
        let maximum = min(size.width - horizontalInset * 2, 266)
        return min(maximum, max(188, heightDriven))
    }
}
