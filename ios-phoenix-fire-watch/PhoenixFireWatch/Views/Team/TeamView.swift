import Supabase
import SwiftUI

/// Admin-only: organization name and employee logins. Pushed from the Account tab.
struct TeamView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(NetworkMonitor.self) private var network
    @State private var members: [Member] = []
    @State private var loading: Bool = true
    @State private var error: String?
    @State private var showAdd: Bool = false
    @State private var editingOrg: Bool = false
    @State private var orgName: String = ""
    @State private var resetFor: Member?
    @State private var removeFor: Member?
    @State private var created: CreatedLogin?

    struct CreatedLogin: Identifiable {
        let id = UUID()
        let name: String
        let email: String
        let password: String
    }

    var body: some View {
        Group {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    orgCard
                    if !network.isOnline {
                        ErrorBanner(message: "Team management needs a connection.")
                    }
                    if let error { ErrorBanner(message: error) }
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Employee Logins").font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                            Spacer()
                            Text("\(members.count)").font(FWFont.mono(.caption)).foregroundStyle(Color.fwInk3)
                        }
                        .padding(.bottom, 6)
                        if loading && members.isEmpty {
                            ProgressView().tint(Color.fwEmber).frame(maxWidth: .infinity).padding(30)
                        }
                        ForEach(members) { member in
                            memberRow(member)
                            if member.id != members.last?.id { Divider().overlay(Color.fwLine) }
                        }
                    }
                    .fwCard()
                }
                .padding(16)
                .fwReadable()
            }
            .refreshable { await load() }
            .background(CanvasBackground())
            .navigationTitle("Team")
            .navigationBarTitleDisplayMode(.inline)
            .fwNavigationChrome()
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showAdd = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                    .disabled(!network.isOnline)
                    .accessibilityLabel("Add employee")
                }
            }
            .task { await load() }
            .sheet(isPresented: $showAdd) {
                AddEmployeeSheet { login in
                    created = login
                    Task { await load() }
                }
            }
            .sheet(item: $resetFor) { member in
                ResetPasswordSheet(member: member) { login in created = login }
                    .presentationDetents([.medium])
            }
            .sheet(item: $created) { login in
                CreatedLoginSheet(login: login).presentationDetents([.medium])
            }
            .confirmationDialog("Remove \(removeFor?.fullName ?? "")?", isPresented: Binding(get: { removeFor != nil }, set: { if !$0 { removeFor = nil } }), titleVisibility: .visible) {
                Button("Remove Employee", role: .destructive) {
                    guard let m = removeFor else { return }
                    Task { await manage(["action": .string("remove"), "memberId": .string(m.id)], success: "Employee removed") }
                }
            } message: {
                Text("Their login is deleted. Patrols they logged stay with your organization.")
            }
        }
    }

    private var orgCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Organization", color: .fwEmber)
            if editingOrg {
                FWField(label: "Name", text: $orgName, autocapitalization: .words)
                HStack {
                    Button("Cancel") { editingOrg = false }.buttonStyle(OutlineButtonStyle(compact: true))
                    Button("Save") {
                        Task {
                            do {
                                try await auth.renameOrg(orgName)
                                editingOrg = false
                                router.show("Organization renamed")
                            } catch {
                                router.show(ErrorText.from(error), style: .error)
                            }
                        }
                    }
                    .buttonStyle(EmberButtonStyle(compact: true))
                    .disabled(orgName.trimmed.isEmpty)
                }
            } else {
                HStack {
                    Text(auth.user?.orgName ?? "").font(FWFont.display(.title2)).foregroundStyle(Color.fwInk)
                    Spacer()
                    Button("Rename") {
                        orgName = auth.user?.orgName ?? ""
                        editingOrg = true
                    }
                    .font(.system(.subheadline, weight: .semibold))
                }
                Text("Add officers here — they sign in on the app or website with the login you create.")
                    .font(.footnote)
                    .foregroundStyle(Color.fwInk2)
            }
        }
        .fwCard()
    }

    private func memberRow(_ member: Member) -> some View {
        let isMe = member.id == auth.user?.id
        return HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.fwRaised).frame(width: 42, height: 42)
                Text(String(member.fullName.prefix(1)).uppercased())
                    .font(.system(.headline, weight: .bold))
                    .foregroundStyle(member.active ? Color.fwInk : Color.fwInk3)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(member.fullName + (isMe ? " (you)" : ""))
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(member.active ? Color.fwInk : Color.fwInk3)
                        .lineLimit(1)
                }
                Text(member.email).font(.caption).foregroundStyle(Color.fwInk2).lineLimit(1)
                HStack(spacing: 6) {
                    Text(member.roleValue.label)
                        .font(.system(.caption2, weight: .semibold))
                        .foregroundStyle(member.roleValue == .admin ? Color.fwEmber : Color.fwInk2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background((member.roleValue == .admin ? Color.fwEmber : Color.fwInk3).opacity(0.14), in: Capsule())
                    if !member.active {
                        Text("Deactivated").font(.system(.caption2, weight: .semibold)).foregroundStyle(Color.fwIncident)
                    }
                }
            }
            Spacer()
            if !isMe {
                Menu {
                    Button { resetFor = member } label: { Label("Reset Password", systemImage: "key.fill") }
                    Button {
                        Task { await manage(["action": .string("update"), "memberId": .string(member.id), "role": .string(member.roleValue == .admin ? "officer" : "admin")], success: "Role updated") }
                    } label: {
                        Label(member.roleValue == .admin ? "Make Officer" : "Make Admin", systemImage: "person.badge.shield.checkmark")
                    }
                    Button {
                        Task { await manage(["action": .string("update"), "memberId": .string(member.id), "active": .bool(!member.active)], success: member.active ? "Login deactivated" : "Login reactivated") }
                    } label: {
                        Label(member.active ? "Deactivate" : "Reactivate", systemImage: member.active ? "pause.circle" : "play.circle")
                    }
                    Button(role: .destructive) { removeFor = member } label: { Label("Remove", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.fwInk2)
                        .frame(width: 44, height: 44)
                }
                .disabled(!network.isOnline)
                .accessibilityLabel("Manage \(member.fullName)")
            }
        }
        .padding(.vertical, 8)
    }

    private func load() async {
        guard let orgId = auth.user?.orgId else { return }
        loading = true
        do {
            members = try await Backend.client
                .from("profiles")
                .select("id, full_name, email, role, active, created_at")
                .eq("org_id", value: orgId)
                .order("created_at", ascending: true)
                .execute()
                .value
            error = nil
        } catch {
            if members.isEmpty { self.error = ErrorText.from(error, fallback: "Couldn't load your team.") }
        }
        loading = false
    }

    private func manage(_ body: [String: AnyJSON], success: String) async {
        do {
            try await Backend.invoke("manage-members", body: body)
            router.show(success)
            await load()
        } catch {
            router.show(ErrorText.from(error), style: .error)
        }
    }
}

enum PasswordGenerator {
    static func make() -> String {
        let chars = Array("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789")
        return String((0..<10).compactMap { _ in chars.randomElement() })
    }
}

struct AddEmployeeSheet: View {
    let onCreated: (TeamView.CreatedLogin) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var email: String = ""
    @State private var password: String = PasswordGenerator.make()
    @State private var role: Role = .officer
    @State private var busy: Bool = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error { ErrorBanner(message: error) }
                    FWField(label: "Full name", text: $name, placeholder: "Officer name", required: true, contentType: .name, autocapitalization: .words)
                    FWField(label: "Email", text: $email, placeholder: "officer@company.com", required: true, keyboard: .emailAddress, contentType: .emailAddress, autocapitalization: .never)
                    VStack(alignment: .leading, spacing: 6) {
                        FWField(label: "Temporary password", text: $password, required: true, autocapitalization: .never)
                        Button("Generate new password") { password = PasswordGenerator.make() }
                            .font(.system(.footnote, weight: .semibold))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Role").font(.system(.subheadline, weight: .medium)).foregroundStyle(Color.fwInk)
                        Picker("Role", selection: $role) {
                            Text("Officer").tag(Role.officer)
                            Text("Admin").tag(Role.admin)
                        }
                        .pickerStyle(.segmented)
                        Text(role == .admin ? "Admins manage the team, delete properties and set patrol intervals." : "Officers log patrols, manage properties and use patrol timers.")
                            .font(.caption)
                            .foregroundStyle(Color.fwInk3)
                    }
                    Button {
                        Task { await create() }
                    } label: {
                        if busy { ProgressView().tint(.white) } else { Text("Create Login") }
                    }
                    .buttonStyle(EmberButtonStyle())
                    .disabled(busy)
                }
                .padding(16)
            }
            .background(Color.fwCanvas)
            .navigationTitle("Add Employee")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func create() async {
        guard !name.trimmed.isEmpty else { error = "Name is required."; return }
        guard email.isValidEmail else { error = "Enter a valid email."; return }
        guard password.count >= 8 else { error = "Password must be at least 8 characters."; return }
        busy = true
        error = nil
        do {
            try await Backend.invoke("manage-members", body: [
                "action": .string("create"),
                "fullName": .string(name.trimmed),
                "email": .string(email.trimmed.lowercased()),
                "password": .string(password),
                "role": .string(role.rawValue),
            ])
            let login = TeamView.CreatedLogin(name: name.trimmed, email: email.trimmed.lowercased(), password: password)
            dismiss()
            onCreated(login)
        } catch {
            self.error = ErrorText.from(error)
        }
        busy = false
    }
}

struct ResetPasswordSheet: View {
    let member: Member
    let onDone: (TeamView.CreatedLogin) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var password: String = PasswordGenerator.make()
    @State private var busy: Bool = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Set a new temporary password for \(member.fullName).").font(.subheadline).foregroundStyle(Color.fwInk2)
                if let error { ErrorBanner(message: error) }
                FWField(label: "New password", text: $password, autocapitalization: .never)
                Button {
                    Task {
                        guard password.count >= 8 else { error = "Password must be at least 8 characters."; return }
                        busy = true
                        do {
                            try await Backend.invoke("manage-members", body: ["action": .string("reset-password"), "memberId": .string(member.id), "password": .string(password)])
                            let login = TeamView.CreatedLogin(name: member.fullName, email: member.email, password: password)
                            dismiss()
                            onDone(login)
                        } catch {
                            self.error = ErrorText.from(error)
                        }
                        busy = false
                    }
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text("Reset Password") }
                }
                .buttonStyle(EmberButtonStyle())
                Spacer()
            }
            .padding(16)
            .background(Color.fwCanvas)
            .navigationTitle("Reset Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct CreatedLoginSheet: View {
    let login: TeamView.CreatedLogin
    @Environment(\.dismiss) private var dismiss
    @State private var copied: Bool = false

    private var shareText: String {
        "Your Phoenix Fire Watch login\nEmail: \(login.email)\nTemporary password: \(login.password)\nSign in in the Phoenix Fire Watch app or at \(Legal.siteURL)"
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Label("Login ready for \(login.name)", systemImage: "checkmark.seal.fill")
                    .font(.system(.headline, weight: .bold))
                    .foregroundStyle(Color.fwClear)
                VStack(alignment: .leading, spacing: 10) {
                    row("Email", login.email)
                    row("Password", login.password)
                }
                .fwCard()
                Text("Share these details privately. They'll be asked to accept the terms on first sign-in.")
                    .font(.footnote)
                    .foregroundStyle(Color.fwInk2)
                HStack {
                    Button(copied ? "Copied" : "Copy") {
                        UIPasteboard.general.string = shareText
                        copied = true
                    }
                    .buttonStyle(OutlineButtonStyle())
                    ShareLink(item: shareText) { Text("Share") }
                        .buttonStyle(EmberButtonStyle())
                }
                .sensoryFeedback(.success, trigger: copied)
                Spacer()
            }
            .padding(16)
            .background(Color.fwCanvas)
            .navigationTitle("Employee Login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(Color.fwInk3)
            Spacer()
            Text(value).font(FWFont.mono(.subheadline, weight: .semibold)).foregroundStyle(Color.fwInk).textSelection(.enabled)
        }
    }
}
