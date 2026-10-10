import SwiftUI

/// Shown once to employees created by an admin, before they can use the app.
struct AcceptTermsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var agreed: Bool = false
    @State private var busy: Bool = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                CrestView(size: 84).padding(.top, 40)
                VStack(alignment: .leading, spacing: 16) {
                    Text("Before you start")
                        .font(FWFont.display(.title2))
                        .foregroundStyle(Color.fwInk)
                    Text("Welcome\(auth.user.map { ", \($0.name)" } ?? ""). \(auth.user?.orgName ?? "Your organization") uses Phoenix Fire Watch to record fire watch patrols. Please review and accept the terms to continue.")
                        .font(.subheadline)
                        .foregroundStyle(Color.fwInk2)
                    VStack(spacing: 10) {
                        linkRow("Terms of Service", url: Legal.termsURL)
                        linkRow("Privacy Policy", url: Legal.privacyURL)
                    }
                    if let error { ErrorBanner(message: error) }
                    Toggle(isOn: $agreed) {
                        Text("I have read and agree to the Terms of Service and Privacy Policy.")
                            .font(.footnote)
                            .foregroundStyle(Color.fwInk2)
                    }
                    .toggleStyle(CheckboxToggleStyle())
                    Button {
                        Task { await accept() }
                    } label: {
                        if busy { ProgressView().tint(.white) } else { Text("Accept & Continue") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!agreed || busy)
                    Button("Sign Out") { Task { await auth.signOut() } }
                        .buttonStyle(OutlineButtonStyle())
                }
                .fwCard(padding: 20)
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
    }

    private func linkRow(_ title: String, url: URL) -> some View {
        Link(destination: url) {
            HStack {
                Image(systemName: "doc.text").foregroundStyle(Color.fwLink)
                Text(title).foregroundStyle(Color.fwInk)
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(Color.fwInk3)
            }
            .padding(14)
            .background(Color.fwRaised, in: .rect(cornerRadius: 11))
        }
    }

    private func accept() async {
        busy = true
        error = nil
        do {
            try await auth.acceptTerms()
        } catch {
            self.error = ErrorText.from(error)
        }
        busy = false
    }
}
