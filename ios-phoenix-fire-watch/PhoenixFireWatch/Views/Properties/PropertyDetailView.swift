import SwiftUI

struct PropertyDetailView: View {
    let propertyId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @State private var showEdit: Bool = false
    @State private var confirmDelete: Bool = false
    @State private var patrolToDelete: Patrol?
    @State private var report: ReportRequest?

    private var property: Property? { store.property(id: propertyId) }

    var body: some View {
        Group {
            if let property {
                content(property)
            } else {
                EmptyStateView(symbol: "building.2", title: "Property not found", message: "It may have been deleted.")
                    .frame(maxHeight: .infinity)
            }
        }
        .background(CanvasBackground())
        .navigationBarTitleDisplayMode(.inline)
        .fwNavigationChrome()
    }

    private func content(_ property: Property) -> some View {
        let patrols = store.patrols(for: property.id)
        let sessions = FireWatchSession.group(patrols)
        let stats = PatrolStats(patrols)
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(property.name)
                        .font(FWFont.display(.title))
                        .foregroundStyle(Color.fwInk)
                    if !property.address.isEmpty {
                        Label(property.address, systemImage: "mappin.and.ellipse")
                            .font(.subheadline)
                            .foregroundStyle(Color.fwInk2)
                    }
                    if store.isPending(propertyId: property.id) {
                        SyncBadge(state: .pending)
                    }
                }

                Button {
                    router.openLogPatrol(propertyId: property.id)
                } label: {
                    Label("Log Patrol", systemImage: "plus.circle.fill")
                }
                .buttonStyle(EmberButtonStyle())

                PatrolTimerCard(property: property)

                GeofenceSection(property: property, isAdmin: auth.isAdmin)

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    StatTile(label: "Total", value: stats.total, color: .fwEmber, symbol: "figure.walk")
                    StatTile(label: "Clear", value: stats.clear, color: .fwClear, symbol: "checkmark.shield.fill")
                    StatTile(label: "Follow-up", value: stats.followUp, color: .fwFollow, symbol: "exclamationmark.bubble.fill")
                    StatTile(label: "Incidents", value: stats.incidents, color: .fwIncident, symbol: "exclamationmark.triangle.fill")
                }

                contactCard(property)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Fire Watch Sessions")
                        .font(.system(.headline, weight: .bold))
                        .foregroundStyle(Color.fwInk)
                    if sessions.isEmpty {
                        EmptyStateView(symbol: "clock.badge.checkmark", title: "No patrols yet", message: "Logged patrols are grouped into 24-hour fire watch sessions with a shareable PDF report.")
                            .fwCard()
                    }
                    ForEach(sessions) { session in
                        sessionCard(session, property: property)
                    }
                }
            }
            .padding(16)
            .padding(.bottom, 24)
            .fwReadable(900)
        }
        .refreshable { await store.refresh() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { showEdit = true } label: { Label("Edit Property", systemImage: "pencil") }
                    if auth.isAdmin {
                        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete Property", systemImage: "trash") }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More")
            }
        }
        .sheet(isPresented: $showEdit) {
            NavigationStack { PropertyFormView(propertyId: property.id) }
        }
        .sheet(item: $report) { request in
            ReportPreviewView(request: request)
        }
        .confirmationDialog("Delete \(property.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Property & Patrols", role: .destructive) {
                Task {
                    do {
                        try await store.deleteProperty(id: property.id)
                        router.show("Property deleted")
                        dismiss()
                    } catch {
                        router.show(ErrorText.from(error), style: .error)
                    }
                }
            }
        } message: {
            Text("This permanently deletes the property, all of its patrols and photos.")
        }
        .confirmationDialog("Delete this patrol?", isPresented: Binding(get: { patrolToDelete != nil }, set: { if !$0 { patrolToDelete = nil } }), titleVisibility: .visible) {
            Button("Delete Patrol", role: .destructive) {
                guard let patrol = patrolToDelete else { return }
                Task {
                    do {
                        try await store.deletePatrol(patrol)
                        router.show("Patrol deleted")
                    } catch {
                        router.show(ErrorText.from(error), style: .error)
                    }
                }
            }
        } message: {
            Text("The patrol and its photos will be removed for everyone in your organization.")
        }
    }

    private func contactCard(_ property: Property) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel(text: "Property Contact", color: .fwEmber)
            if property.contactName.isEmpty && property.contactPhone.isEmpty && property.contactEmail.isEmpty {
                Text("No contact on file.").font(.subheadline).foregroundStyle(Color.fwInk3)
            }
            if !property.contactName.isEmpty {
                contactRow("person.fill", property.contactName, url: nil)
            }
            if !property.contactPhone.isEmpty {
                contactRow("phone.fill", property.contactPhone, url: URL(string: "tel:\(property.contactPhone.filter { $0.isNumber || $0 == "+" })"), mono: true)
            }
            if !property.contactEmail.isEmpty {
                contactRow("envelope.fill", property.contactEmail, url: URL(string: "mailto:\(property.contactEmail)"))
            }
            if !property.notes.isEmpty {
                Divider().overlay(Color.fwLine)
                Text(property.notes).font(.subheadline).foregroundStyle(Color.fwInk2)
            }
        }
        .fwCard()
    }

    @ViewBuilder
    private func contactRow(_ symbol: String, _ text: String, url: URL?, mono: Bool = false) -> some View {
        let row = HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(Color.fwInk3).frame(width: 20)
            Text(text)
                .font(mono ? FWFont.mono(.subheadline) : .subheadline)
                .foregroundStyle(url == nil ? Color.fwInk : Color.fwEmberHover)
            Spacer()
        }
        if let url {
            Link(destination: url) { row }
        } else {
            row
        }
    }

    private func sessionCard(_ session: FireWatchSession, property: Property) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.title).font(.system(.subheadline, weight: .bold)).foregroundStyle(Color.fwInk)
                    Text("\(session.range) · \(session.patrols.count) patrol\(session.patrols.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(Color.fwInk2)
                }
                Spacer()
                Button {
                    report = ReportRequest(property: property, session: session, preparedBy: auth.user?.name ?? "", orgName: auth.user?.orgName ?? "")
                } label: {
                    Label("Report", systemImage: "doc.richtext.fill")
                        .font(.system(.footnote, weight: .semibold))
                        .foregroundStyle(Color.fwEmberHover)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 34)
                        .background(Color.fwEmber.opacity(0.12), in: Capsule())
                        .overlay { Capsule().strokeBorder(Color.fwEmber.opacity(0.35), lineWidth: 1) }
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.bottom, 4)
            ForEach(session.patrols) { patrol in
                Divider().overlay(Color.fwLine)
                PatrolRow(
                    patrol: patrol,
                    canDelete: auth.isAdmin || patrol.loggedBy == auth.user?.id,
                    onDelete: { patrolToDelete = $0 }
                )
            }
        }
        .fwCard(padding: 16)
    }
}
