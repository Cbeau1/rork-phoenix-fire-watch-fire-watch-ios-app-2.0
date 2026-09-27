import SwiftUI

/// Add / edit property. The patrol interval is set separately by admins on the timer card.
struct PropertyFormView: View {
    let propertyId: String?
    var onCreated: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @State private var input: PropertyInput = PropertyInput()
    @State private var errors: [String: String] = [:]
    @State private var saving: Bool = false
    @State private var loaded: Bool = false

    private var isEditing: Bool { propertyId != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 16) {
                    SectionLabel(text: "Property", color: .fwEmber)
                    FWField(label: "Property name", text: $input.name, placeholder: "e.g. Hilton Carillon Park", required: true, contentType: .organizationName, autocapitalization: .words, error: errors["name"])
                    FWField(label: "Address", text: $input.address, placeholder: "Street, city, state, ZIP", required: true, contentType: .fullStreetAddress, autocapitalization: .words, error: errors["address"])
                }
                .fwCard()

                VStack(alignment: .leading, spacing: 16) {
                    SectionLabel(text: "Property contact", color: .fwEmber)
                    FWField(label: "Contact name", text: $input.contactName, placeholder: "Full name", contentType: .name, autocapitalization: .words)
                    FWField(label: "Phone", text: $input.contactPhone, placeholder: "727-555-0100", keyboard: .phonePad, contentType: .telephoneNumber)
                    FWField(label: "Email", text: $input.contactEmail, placeholder: "contact@property.com", keyboard: .emailAddress, contentType: .emailAddress, autocapitalization: .never, error: errors["email"])
                }
                .fwCard()

                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel(text: "Notes", color: .fwEmber)
                    TextField("", text: $input.notes, prompt: Text("Access codes, hazards, fire panel location…").foregroundStyle(Color.fwInk3), axis: .vertical)
                        .lineLimit(3...8)
                        .foregroundStyle(Color.fwInk)
                        .padding(14)
                        .background(Color.fwRaised, in: .rect(cornerRadius: 11))
                        .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
                }
                .fwCard()

                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView().tint(.white) } else { Text(isEditing ? "Save Changes" : "Add Property") }
                }
                .buttonStyle(EmberButtonStyle())
                .disabled(saving)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(CanvasBackground())
        .navigationTitle(isEditing ? "Edit Property" : "Add Property")
        .navigationBarTitleDisplayMode(.inline)
        .fwNavigationChrome()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let propertyId, let property = store.property(id: propertyId) {
                input = PropertyInput(property: property)
            }
        }
    }

    private func save() async {
        var next: [String: String] = [:]
        if input.name.trimmed.isEmpty { next["name"] = "Property name is required" }
        if input.address.trimmed.isEmpty { next["address"] = "Address is required" }
        if !input.contactEmail.trimmed.isEmpty && !input.contactEmail.isValidEmail { next["email"] = "Enter a valid email" }
        withAnimation { errors = next }
        guard next.isEmpty, !saving else { return }
        saving = true
        do {
            if let propertyId {
                let result = try await store.updateProperty(id: propertyId, input: input)
                router.show(result == .queued ? "Saved on this device" : "Property updated", detail: result == .queued ? "Uploads when you're back online." : nil, style: result == .queued ? .info : .success)
                dismiss()
            } else {
                let (id, result) = try await store.addProperty(input)
                router.show(result == .queued ? "Property saved on this device" : "Property added", detail: input.name.trimmed, style: result == .queued ? .info : .success)
                dismiss()
                onCreated?(id)
            }
        } catch {
            router.show(ErrorText.from(error), style: .error)
            saving = false
        }
    }
}
