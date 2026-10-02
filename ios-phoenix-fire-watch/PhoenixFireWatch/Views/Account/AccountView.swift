import SwiftUI

struct AccountView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(FireWatchStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(NetworkMonitor.self) private var network
    @State private var name: String = ""
    @State private var editingName: Bool = false
    @State private var newPassword: String = ""
    @State private var showDelete: Bool = false
    @State private var confirmSignOut: Bool = false
    @State private var showTeam: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    profileCard
                    if auth.isAdmin { teamCard }
                    passwordCard
                    if auth.isAdmin { dataCard }
                    linksCard
                    Button {
                        if store.pendingCount > 0 { confirmSignOut = true } else { Task { await auth.signOut() } }
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(OutlineButtonStyle())
                    deleteCard
                    Text("Phoenix Fire Watch · Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                        .font(.caption)
                        .foregroundStyle(Color.fwInk3)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(CanvasBackground())
            .navigationTitle("Account")
            .fwNavigationChrome()
            .sheet(isPresented: $showDelete) { DeleteAccountSheet() }
            .navigationDestination(isPresented: $showTeam) { TeamView() }
            .confirmationDialog("Sign out with unsent changes?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out Anyway", role: .destructive) { Task { await auth.signOut() } }
            } message: {
                Text("\(store.pendingCount) change\(store.pendingCount == 1 ? " hasn't" : "s haven't") uploaded yet and will be lost.")
            }
        }
    }

    private var profileCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(Color.fwEmber.opacity(0.15)).frame(width: 58, height: 58)
                    Text(auth.user?.initials ?? "FW").font(.system(.title3, weight: .heavy)).foregroundStyle(Color.fwEmber)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(auth.user?.name ?? "").font(.system(.title3, weight: .bold)).foregroundStyle(Color.fwInk)
                    Text(auth.user?.email ?? "").font(.subheadline).foregroundStyle(Color.fwInk2)
                    Text("\(auth.user?.role.label ?? "") · \(auth.user?.orgName ?? "")").font(.caption).foregroundStyle(Color.fwInk3)
                }
            }
            if editingName {
                FWField(label: "Full name", text: $name, contentType: .name, autocapitalization: .words)
                HStack {
                    Button("Cancel") { editingName = false }.buttonStyle(OutlineButtonStyle(compact: true))
                    Button("Save") {
                        Task {
                            do {
                                try await auth.updateName(name)
                                editingName = false
                                router.show("Name updated")
                            } catch {
                                router.show(ErrorText.from(error), style: .error)
                            }
                        }
                    }
                    .buttonStyle(EmberButtonStyle(compact: true))
                    .disabled(name.trimmed.isEmpty || !network.isOnline)
                }
            } else {
                Button("Edit name") {
                    name = auth.user?.name ?? ""
                    editingName = true
                }
                .font(.system(.subheadline, weight: .semibold))
            }
        }
        .fwCard()
    }

    private var teamCard: some View {
        Button {
            showTeam = true
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11).fill(Color.fwEmber.opacity(0.14)).frame(width: 44, height: 44)
                    Image(systemName: "person.2.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(Color.fwEmber)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Team & Logins").font(.system(.headline, weight: .bold)).foregroundStyle(Color.fwInk)
                    Text("Add officers, reset passwords, manage roles").font(.caption).foregroundStyle(Color.fwInk2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Color.fwInk3)
            }
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .fwCard(padding: 14)
    }

    private var passwordCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Change password", color: .fwEmber)
            FWField(label: "New password", text: $newPassword, placeholder: "At least 8 characters", contentType: .newPassword, secure: true)
            Button("Update Password") {
                Task {
                    guard newPassword.count >= 8 else {
                        router.show("Password must be at least 8 characters.", style: .error)
                        return
                    }
                    do {
                        try await auth.changePassword(newPassword)
                        newPassword = ""
                        router.show("Password updated")
                    } catch {
                        router.show(ErrorText.from(error), style: .error)
                    }
                }
            }
            .buttonStyle(OutlineButtonStyle())
            .disabled(newPassword.isEmpty || !network.isOnline)
        }
        .fwCard()
    }

    private var dataCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Data & privacy", color: .fwEmber)
            Text("Automatically delete patrols, photos and resolved notes older than the retention period.")
                .font(.footnote)
                .foregroundStyle(Color.fwInk2)
            Menu {
                ForEach(RetentionOption.all, id: \.label) { option in
                    Button(option.label) {
                        Task {
                            do {
                                try await auth.setRetention(option.days)
                                router.show("Retention updated", detail: option.label)
                            } catch {
                                router.show(ErrorText.from(error), style: .error)
                            }
                        }
                    }
                }
            } label: {
                HStack {
                    Text("Retention").foregroundStyle(Color.fwInk)
                    Spacer()
                    Text(RetentionOption.label(for: auth.user?.retentionDays)).foregroundStyle(Color.fwInk2)
                    Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(Color.fwEmber)
                }
                .padding(14)
                .background(Color.fwRaised, in: .rect(cornerRadius: 11))
            }
            .disabled(!network.isOnline)
        }
        .fwCard()
    }

    private var linksCard: some View {
        VStack(spacing: 0) {
            linkRow("Privacy Policy", "hand.raised.fill", Legal.privacyURL)
            Divider().overlay(Color.fwLine)
            linkRow("Terms of Service", "doc.text.fill", Legal.termsURL)
            Divider().overlay(Color.fwLine)
            linkRow("Help & Support", "questionmark.circle.fill", Legal.supportURL)
        }
        .fwCard(padding: 4)
    }

    private func linkRow(_ title: String, _ symbol: String, _ url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Image(systemName: symbol).foregroundStyle(Color.fwEmber).frame(width: 24)
                Text(title).foregroundStyle(Color.fwInk)
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(Color.fwInk3)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
        }
    }

    private var deleteCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Delete account", color: .fwIncident)
            Text(auth.isAdmin
                 ? "Delete your login, or permanently delete your whole organization and all of its data."
                 : "Permanently delete your login. Patrols you logged stay with your organization's records.")
                .font(.footnote)
                .foregroundStyle(Color.fwInk2)
            Button("Delete Account…") { showDelete = true }
                .buttonStyle(OutlineButtonStyle(tint: .fwIncident))
                .disabled(!network.isOnline)
        }
        .fwCard(border: Color.fwIncident.opacity(0.4))
    }
}

struct DeleteAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var scope: AuthStore.DeleteScope = .account
    @State private var confirmText: String = ""
    @State private var busy: Bool = false
    @State private var error: String?

    private var canDelete: Bool {
        scope == .account ? confirmText.trimmed.uppercased() == "DELETE" : confirmText.trimmed.lowercased() == (auth.user?.orgName ?? "").trimmed.lowercased()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if auth.isAdmin {
                        Picker("What to delete", selection: $scope) {
                            Text("My account").tag(AuthStore.DeleteScope.account)
                            Text("Whole organization").tag(AuthStore.DeleteScope.organization)
                        }
                        .pickerStyle(.segmented)
                    }
                    Text(scope == .account
                         ? "Your login and profile are deleted permanently. This can't be undone."
                         : "Every login, property, patrol, photo and note in \(auth.user?.orgName ?? "your organization") is deleted permanently. This can't be undone.")
                        .font(.subheadline)
                        .foregroundStyle(Color.fwInk2)
                    if let error { ErrorBanner(message: error) }
                    FWField(
                        label: scope == .account ? "Type DELETE to confirm" : "Type the organization name to confirm",
                        text: $confirmText,
                        placeholder: scope == .account ? "DELETE" : (auth.user?.orgName ?? ""),
                        autocapitalization: .never
                    )
                    Button {
                        Task {
                            busy = true
                            do {
                                try await auth.deleteAccount(scope: scope, confirmName: scope == .organization ? confirmText.trimmed : "")
                            } catch {
                                self.error = ErrorText.from(error)
                            }
                            busy = false
                        }
                    } label: {
                        if busy { ProgressView().tint(.white) } else { Text("Delete Permanently") }
                    }
                    .buttonStyle(EmberButtonStyle())
                    .disabled(!canDelete || busy)
                }
                .padding(16)
            }
            .background(Color.fwCanvas)
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onChange(of: scope) { _, _ in confirmText = "" }
        }
    }
}
