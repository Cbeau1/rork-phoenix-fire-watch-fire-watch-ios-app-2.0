import SwiftUI

/// Admin roster of schedulable names. Names can optionally be linked to a team login.
struct StaffRosterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(ScheduleStore.self) private var schedule
    @State private var editing: StaffEditTarget?

    struct StaffEditTarget: Identifiable {
        let id = UUID()
        let member: StaffMember?
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Add everyone you schedule — logins aren't required. Link a name to a team login so that officer sees their own shifts highlighted.")
                        .font(.footnote)
                        .foregroundStyle(Color.fwInk2)
                    Button {
                        editing = StaffEditTarget(member: nil)
                    } label: {
                        Label("Add Person", systemImage: "person.badge.plus")
                    }
                    .buttonStyle(EmberButtonStyle())
                    if schedule.staff.isEmpty {
                        EmptyStateView(symbol: "person.2", title: "No staff yet", message: "Names you add here can be scheduled on any property.")
                            .fwCard()
                    } else {
                        VStack(spacing: 0) {
                            ForEach(schedule.staff) { member in
                                Button {
                                    editing = StaffEditTarget(member: member)
                                } label: {
                                    row(member)
                                }
                                .buttonStyle(PressableStyle())
                                if member.id != schedule.staff.last?.id { Divider().overlay(Color.fwLine) }
                            }
                        }
                        .fwCard(padding: 6)
                    }
                }
                .padding(16)
            }
            .background(Color.fwCanvas)
            .navigationTitle("Staff · \(schedule.staff.count)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $editing) { target in
                StaffEditSheet(member: target.member)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private func row(_ member: StaffMember) -> some View {
        let login = schedule.members.first { $0.id == member.profileId }
        return HStack(spacing: 12) {
            ZStack {
                Circle().fill(login == nil ? Color.fwRaised : Color.fwEmber.opacity(0.14)).frame(width: 40, height: 40)
                Text(member.initials)
                    .font(.system(.subheadline, weight: .bold))
                    .foregroundStyle(login == nil ? Color.fwSilver : Color.fwEmber)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk).lineLimit(1)
                if let login {
                    Label(login.email, systemImage: "link").font(.caption).foregroundStyle(Color.fwInk2).lineLimit(1).labelStyle(TightLabelStyle())
                } else {
                    Text("No login linked").font(.caption).foregroundStyle(Color.fwInk3)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Color.fwInk3)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .contentShape(.rect)
    }
}

/// Add or edit one staff name, link it to a login, or remove it (with its shifts).
struct StaffEditSheet: View {
    let member: StaffMember?

    @Environment(\.dismiss) private var dismiss
    @Environment(ScheduleStore.self) private var schedule
    @Environment(AppRouter.self) private var router
    @State private var name: String = ""
    @State private var profileId: String?
    @State private var busy: Bool = false
    @State private var error: String?
    @State private var confirmRemove: Bool = false
    @State private var didLoad: Bool = false

    /// Logins not already linked to a different name.
    private var linkable: [Member] {
        let taken = Set(schedule.staff.filter { $0.id != member?.id }.compactMap(\.profileId))
        return schedule.members.filter { !taken.contains($0.id) && $0.active }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let error { ErrorBanner(message: error) }
                    FWField(label: "Name", text: $name, placeholder: "Full name", required: true, contentType: .name, autocapitalization: .words)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Team login").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                        Menu {
                            Button {
                                profileId = nil
                            } label: {
                                if profileId == nil { Label("Not linked", systemImage: "checkmark") } else { Text("Not linked") }
                            }
                            ForEach(linkable) { m in
                                Button {
                                    profileId = m.id
                                    if name.trimmed.isEmpty { name = m.fullName }
                                } label: {
                                    if profileId == m.id { Label(m.fullName, systemImage: "checkmark") } else { Text("\(m.fullName) · \(m.email)") }
                                }
                            }
                        } label: {
                            HStack {
                                Image(systemName: profileId == nil ? "link.badge.plus" : "link").foregroundStyle(Color.fwEmber)
                                Text(schedule.members.first { $0.id == profileId }?.fullName ?? "Not linked")
                                    .foregroundStyle(profileId == nil ? Color.fwInk2 : Color.fwInk)
                                Spacer()
                                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(Color.fwInk3)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 50)
                            .background(Color.fwRaised, in: .rect(cornerRadius: 11))
                            .overlay { RoundedRectangle(cornerRadius: 11).strokeBorder(Color.fwLineStrong, lineWidth: 1) }
                        }
                        Text("Optional. Linked officers can filter to “My shifts”.")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk3)
                    }
                    Button {
                        Task { await save() }
                    } label: {
                        if busy { ProgressView().tint(.white) } else { Text(member == nil ? "Add Person" : "Save Changes") }
                    }
                    .buttonStyle(EmberButtonStyle())
                    .disabled(name.trimmed.isEmpty || busy)
                    if member != nil {
                        Button("Remove from Roster", role: .destructive) { confirmRemove = true }
                            .buttonStyle(OutlineButtonStyle(tint: .fwIncident))
                            .disabled(busy)
                    }
                }
                .padding(16)
            }
            .background(Color.fwCanvas)
            .navigationTitle(member == nil ? "Add Person" : "Edit Person")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .confirmationDialog("Remove \(member?.name ?? "")?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove + Delete Their Shifts", role: .destructive) { Task { await remove() } }
            } message: {
                Text("Every shift they're scheduled on is deleted too. Their team login isn't affected.")
            }
            .onAppear {
                guard !didLoad else { return }
                didLoad = true
                name = member?.name ?? ""
                profileId = member?.profileId
            }
        }
    }

    private func save() async {
        let trimmed = name.trimmed
        guard !trimmed.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            if let member {
                try await schedule.updateStaff(id: member.id, name: trimmed, profileId: profileId)
                router.show("Saved")
            } else {
                try await schedule.addStaff(name: trimmed, profileId: profileId)
                router.show("\(trimmed) added")
            }
            dismiss()
        } catch {
            self.error = ErrorText.from(error)
        }
    }

    private func remove() async {
        guard let member else { return }
        busy = true
        defer { busy = false }
        do {
            try await schedule.deleteStaff(id: member.id)
            router.show("\(member.name) removed")
            dismiss()
        } catch {
            self.error = ErrorText.from(error)
        }
    }
}
