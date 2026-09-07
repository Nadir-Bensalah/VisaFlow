import SwiftUI

/// La marchandise. Le client veut une date et une position, pas un tableau.
struct ShipmentDetailView: View {
    @Environment(Session.self) private var session
    let token: String

    @State private var bundle: ShipmentBundle?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: Token.Space.lg) {
                if let bundle {
                    header(bundle)
                    timeline(bundle)
                    facts(bundle)
                    if let reason = bundle.shipment.blockedReason {
                        SectionCard("cargaison.bloquee") {
                            Text(reason).font(.subheadline).foregroundStyle(Token.Palette.red)
                        }
                    }
                    contact(bundle)
                } else if loading {
                    ProgressView().padding(.vertical, Token.Space.xxl)
                } else {
                    EmptyState(symbol: "shippingbox", title: "dossier.introuvable", hint: "dossier.introuvable_aide")
                }
                if let error {
                    Label(error, systemImage: "wifi.exclamationmark")
                        .font(.footnote).foregroundStyle(Token.Palette.orange)
                }
            }
            .padding(Token.Space.lg)
        }
        .background(Token.Palette.background)
        .navigationTitle(bundle?.shipment.reference ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func header(_ bundle: ShipmentBundle) -> some View {
        VStack(alignment: .leading, spacing: Token.Space.sm) {
            Text("\(bundle.shipment.originPort ?? "") → \(bundle.shipment.destPort ?? "")")
                .font(.title2.bold())
                .foregroundStyle(Token.Palette.text)
            HStack(spacing: Token.Space.sm) {
                Pill(text: String(localized: String.LocalizationValue(bundle.shipment.stage.titleKey)),
                     tone: bundle.shipment.status == "bloquee" ? .red
                         : bundle.shipment.stage == .livre ? .green : .violet,
                     dot: true)
                if let eta = bundle.shipment.eta {
                    Text("cargaison.eta \(eta.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(.caption).foregroundStyle(Token.Palette.tertiary)
                }
            }
            ProgressLine(value: progress(bundle), tone: Token.Palette.violet)
                .padding(.top, Token.Space.xs)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func timeline(_ bundle: ShipmentBundle) -> some View {
        SectionCard("cargaison.etapes") {
            StepTimeline(steps: ShipmentStage.allCases.map { stage in
                let event = bundle.events.first { $0.stage == stage }
                let current = ShipmentStage.allCases.firstIndex(of: bundle.shipment.stage) ?? 0
                let index = ShipmentStage.allCases.firstIndex(of: stage) ?? 0
                return StepTimeline.Step(
                    id: stage.rawValue,
                    title: String(localized: String.LocalizationValue(stage.titleKey)),
                    detail: event.map { event in
                        [event.location, event.at.formatted(.dateTime.day().month(.abbreviated))]
                            .compactMap { $0 }.joined(separator: " · ")
                    },
                    done: index < current,
                    current: index == current
                )
            })
        }
    }

    private func facts(_ bundle: ShipmentBundle) -> some View {
        SectionCard("cargaison.details") {
            VStack(spacing: Token.Space.sm) {
                line("cargaison.mode", String(localized: String.LocalizationValue("mode.\(bundle.shipment.mode)")))
                if let etd = bundle.shipment.etd {
                    line("cargaison.etd", etd.formatted(.dateTime.day().month(.abbreviated).year()))
                }
                if let packages = bundle.shipment.packages {
                    line("cargaison.colis", "\(packages)")
                }
                if let weight = bundle.shipment.weightKg {
                    line("cargaison.poids", "\(Int(weight)) kg")
                }
            }
        }
    }

    private func line(_ key: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(key).font(.subheadline).foregroundStyle(Token.Palette.secondary)
            Spacer(minLength: Token.Space.md)
            Text(value).font(.subheadline).foregroundStyle(Token.Palette.text)
        }
    }

    private func contact(_ bundle: ShipmentBundle) -> some View {
        SectionCard("dossier.contact") {
            VStack(alignment: .leading, spacing: Token.Space.sm) {
                Text(bundle.agency.name).font(.subheadline.weight(.medium))
                if let phone = bundle.agency.phone {
                    Link(destination: URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })")!) {
                        Label("dossier.appeler", systemImage: "phone")
                    }
                    .font(.subheadline)
                }
            }
        }
    }

    private func progress(_ bundle: ShipmentBundle) -> Double {
        let index = ShipmentStage.allCases.firstIndex(of: bundle.shipment.stage) ?? 0
        return Double(index + 1) / Double(ShipmentStage.allCases.count)
    }

    private func load() async {
        error = nil
        do {
            bundle = try await session.api.shipmentBundle(token: token)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}
