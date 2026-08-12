import CoreLocation
import Foundation
import SwiftUI

struct StoreListSheet: View {
    @Environment(\.hopPalette) private var palette

    let stores: [Store]
    let currentLocation: CLLocation
    let mode: StoreMode
    let availability: StoreAvailability
    let evaluationDate: Date
    @Binding var selectedStoreID: Store.ID?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(palette.olive.opacity(0.22))
                .frame(width: 38, height: 4)
                .padding(.top, 8)

            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(availability == .openNow ? "PIĘĆ NAJBLIŻSZYCH NA TERAZ" : "PIĘĆ NAJBLIŻSZYCH")
                        .font(HopTheme.uiBold(10, relativeTo: .caption2))
                        .tracking(1.6)
                        .foregroundStyle(palette.olive)

                    Text(mode.pickerTitle)
                        .font(HopTheme.display(35, relativeTo: .title))
                        .foregroundStyle(palette.oliveDark)
                }

                Spacer(minLength: 0)

                Button("Zamknij") { dismiss() }
                    .font(HopTheme.ui(13, relativeTo: .footnote))
                    .foregroundStyle(palette.olive)
                    .padding(.horizontal, 13)
                    .frame(height: 44)
                    .background(palette.ivory, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(palette.olive.opacity(0.25), lineWidth: 1)
                    }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)

            Rectangle()
                .fill(palette.hairline)
                .frame(height: 1)
                .padding(.horizontal, 18)

            List {
                ForEach(Array(stores.enumerated()), id: \.element.id) { index, store in
                    Button {
                        selectedStoreID = store.id
                        dismiss()
                    } label: {
                        storeRow(store, index: index)
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 0, leading: 18, bottom: 0, trailing: 18))
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(palette.hairline)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .background(palette.ivory.ignoresSafeArea())
        .presentationDetents([.fraction(0.50), .large])
        .presentationDragIndicator(.hidden)
        .presentationBackground(palette.ivory)
    }

    private func storeRow(_ store: Store, index: Int) -> some View {
        let isSelected = selectedStoreID == store.id
        let openingStatus = store.assessedOpeningStatus(
            at: evaluationDate,
            mode: mode,
            availability: availability
        )

        return HStack(spacing: 14) {
            Text("\(index + 1)")
                .font(HopTheme.uiBold(11, relativeTo: .caption))
                .foregroundStyle(isSelected ? palette.violet : palette.olive)
                .frame(width: 34, height: 34)
                .background(palette.ivory, in: Circle())
                .overlay {
                    Circle()
                        .stroke(isSelected ? palette.violet : palette.olive, lineWidth: 1)
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(store.name)
                    .font(HopTheme.uiBold(15, relativeTo: .subheadline))
                    .foregroundStyle(isSelected ? palette.violet : palette.oliveDark)
                    .lineLimit(1)

                Text(store.address)
                    .font(HopTheme.ui(11, relativeTo: .caption2))
                    .foregroundStyle(isSelected ? palette.violet.opacity(0.72) : palette.mutedOlive)
                    .lineLimit(2)

                Text(openingStatus.label)
                    .font(HopTheme.uiBold(10, relativeTo: .caption2))
                    .foregroundStyle(statusColor(openingStatus.state, isSelected: isSelected))
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(GeoMath.formattedDistance(store.distance(from: currentLocation)))
                .font(HopTheme.uiBold(13, relativeTo: .footnote))
                .foregroundStyle(isSelected ? palette.violet : palette.olive)
                .monospacedDigit()
        }
        .frame(minHeight: 61)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Ustawia ten sklep jako cel")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func statusColor(_ state: StoreOpenState, isSelected: Bool) -> Color {
        if isSelected { return palette.violet }
        return switch state {
        case .open: palette.oliveDark
        case .probablyOpen: palette.olive
        case .closed: palette.violet
        case .unknown: palette.mutedOlive
        }
    }
}
