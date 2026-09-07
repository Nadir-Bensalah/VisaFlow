import SwiftUI

/// Déposer une demande depuis l'app, sans passer par le navigateur.
struct RequestView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var kind = "visa"
    @State private var destination = ""
    @State private var travel = Date().addingTimeInterval(30 * 86_400)
    @State private var hasTravel = false
    @State private var goods = ""
    @State private var note = ""
    @State private var sent = false

    var body: some View {
        NavigationStack {
            Form {
                Section("demande.quoi") {
                    Picker("demande.quoi", selection: $kind) {
                        Text("demande.visa").tag("visa")
                        Text("demande.fret").tag("fret")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }

                if kind == "visa" {
                    Section("demande.destination") {
                        TextField("demande.destination_exemple", text: $destination)
                        Toggle("demande.date_connue", isOn: $hasTravel)
                        if hasTravel {
                            DatePicker("demande.depart", selection: $travel, displayedComponents: .date)
                        }
                    }
                } else {
                    Section("demande.marchandise") {
                        TextField("demande.marchandise_exemple", text: $goods)
                    }
                }

                Section("demande.note") {
                    TextField("demande.note", text: $note, axis: .vertical).lineLimit(3...6)
                }

                Section {
                    Button("demande.envoyer") { sent = true }
                        .disabled(kind == "visa" ? destination.isEmpty : goods.isEmpty)
                } footer: {
                    Text("demande.aide")
                }
            }
            .navigationTitle("demande.titre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("action.annuler") { dismiss() }
                }
            }
            .alert("demande.recue", isPresented: $sent) {
                Button("action.fermer") { dismiss() }
            } message: {
                Text("demande.recue_aide")
            }
        }
    }
}
