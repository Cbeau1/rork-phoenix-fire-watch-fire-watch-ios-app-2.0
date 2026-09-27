import SwiftUI

/// Sign in / create organization / password reset — all on one crest-topped card.
struct SignInView: View {
    enum Mode: Hashable { case signIn, signUp, forgotEmail, forgotCode }

    @Environment(AuthStore.self) private var auth
    @State private var mode: Mode = .signIn
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var orgName: String = ""
    @State private var fullName: String = ""
    @State private var acceptedTerms: Bool = false
    @State private var code: String = ""
    @State private var newPassword: String = ""
    @State private var busy: Bool = false
    @State private var error: String?
    @State private var info: String?
    @State private var appeared: Bool = false

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                VStack(spacing: 18) {
                    CrestView(size: 96)
                    Wordmark()
                }
                .padding(.top, 36)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)

                VStack(spacing: 0) {
                    if mode == .signIn || mode == .signUp {
                        segmented
                            .padding(16)
                        Divider().overlay(Color.fwLine)
                    }
                    form
                        .padding(20)
                        .id(mode)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .move(edge: .trailing)), removal: .opacity))
                }
                .background(Color.fwSurface, in: .rect(cornerRadius: 18))
                .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(Color.fwLine, lineWidth: 1) }
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 20)

                LegalLinks()
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.85).delay(0.05)) { appeared = true }
        }
        .sensoryFeedback(.error, trigger: error)
    }

    private var segmented: some View {
        HStack(spacing: 4) {
            segment("Sign In", .signIn)
            segment("Create Organization", .signUp)
        }
        .padding(4)
        .background(Color.fwRaised, in: .rect(cornerRadius: 12))
    }

    private func segment(_ title: String, _ value: Mode) -> some View {
        Button {
            switchTo(value)
        } label: {
            Text(title)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(mode == value ? Color.white : Color.fwInk2)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background {
                    if mode == value {
                        RoundedRectangle(cornerRadius: 9).fill(Color.fwEmber)
                    }
                }
        }
        .buttonStyle(.plain)
    }

    private func switchTo(_ next: Mode) {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
            mode = next
            error = nil
            if next == .signIn || next == .signUp { info = nil }
        }
    }

    @ViewBuilder
    private var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch mode {
            case .signIn: signInForm
            case .signUp: signUpForm
            case .forgotEmail: forgotEmailForm
            case .forgotCode: forgotCodeForm
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(FWFont.display(.title2)).foregroundStyle(Color.fwInk)
            Text(subtitle).font(.subheadline).foregroundStyle(Color.fwInk2)
        }
    }

    private var title: String {
        switch mode {
        case .signIn: "Welcome back"
        case .signUp: "Start your organization"
        case .forgotEmail: "Reset your password"
        case .forgotCode: "Enter your code"
        }
    }

    private var subtitle: String {
        switch mode {
        case .signIn: "Sign in to log patrols and manage properties."
        case .signUp: "You'll be the admin and can add your officers."
        case .forgotEmail: "We'll email you a one-time code."
        case .forgotCode: "Check \(email.trimmed) for a 6-digit code."
        }
    }

    private var messages: some View {
        Group {
            if let error { ErrorBanner(message: error) }
            if let info {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "envelope.badge.fill").foregroundStyle(Color.fwClear)
                    Text(info).font(.subheadline).foregroundStyle(Color.fwInk)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.fwClear.opacity(0.1), in: .rect(cornerRadius: 11))
            }
        }
    }

    private var signInForm: some View {
        Group {
            header
            messages
            FWField(label: "Email", text: $email, placeholder: "you@company.com", keyboard: .emailAddress, contentType: .username, autocapitalization: .never)
            FWField(label: "Password", text: $password, placeholder: "Your password", contentType: .password, secure: true)
            HStack {
                Spacer()
                Button("Forgot password?") { switchTo(.forgotEmail) }
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.fwEmber)
            }
            submitButton("Sign In") { try await submitSignIn() }
        }
    }

    private var signUpForm: some View {
        Group {
            header
            messages
            FWField(label: "Organization name", text: $orgName, placeholder: "e.g. Phoenix Fire Watch", required: true, contentType: .organizationName, autocapitalization: .words)
            FWField(label: "Your full name", text: $fullName, placeholder: "Full name", required: true, contentType: .name, autocapitalization: .words)
            FWField(label: "Email", text: $email, placeholder: "you@company.com", required: true, keyboard: .emailAddress, contentType: .username, autocapitalization: .never)
            FWField(label: "Password", text: $password, placeholder: "At least 8 characters", required: true, contentType: .newPassword, secure: true)
            Toggle(isOn: $acceptedTerms) {
                HStack(spacing: 4) {
                    Text("I agree to the").foregroundStyle(Color.fwInk2)
                    Link("Terms", destination: Legal.termsURL)
                    Text("&").foregroundStyle(Color.fwInk2)
                    Link("Privacy Policy", destination: Legal.privacyURL)
                }
                .font(.footnote)
            }
            .toggleStyle(CheckboxToggleStyle())
            submitButton("Create Organization") { try await submitSignUp() }
        }
    }

    private var forgotEmailForm: some View {
        Group {
            backButton
            header
            messages
            FWField(label: "Email", text: $email, placeholder: "you@company.com", keyboard: .emailAddress, contentType: .username, autocapitalization: .never)
            submitButton("Email Me a Code") { try await submitForgot() }
        }
    }

    private var forgotCodeForm: some View {
        Group {
            backButton
            header
            messages
            FWField(label: "Code", text: $code, placeholder: "123456", keyboard: .numberPad, contentType: .oneTimeCode)
            FWField(label: "New password", text: $newPassword, placeholder: "At least 8 characters", contentType: .newPassword, secure: true)
            submitButton("Reset Password & Sign In") { try await submitReset() }
            Button("Send a new code") {
                Task { await run { try await submitForgot() } }
            }
            .font(.system(.footnote, weight: .semibold))
            .foregroundStyle(Color.fwInk2)
            .frame(maxWidth: .infinity)
        }
    }

    private var backButton: some View {
        Button {
            switchTo(.signIn)
        } label: {
            Label("Back to sign in", systemImage: "chevron.left")
                .font(.system(.footnote, weight: .semibold))
                .foregroundStyle(Color.fwInk2)
        }
    }

    private func submitButton(_ title: String, action: @escaping () async throws -> Void) -> some View {
        Button {
            Task { await run(action) }
        } label: {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(.white) }
            }
        }
        .buttonStyle(EmberButtonStyle())
        .disabled(busy)
        .padding(.top, 4)
    }

    private func run(_ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        withAnimation { error = nil }
        do {
            try await action()
        } catch {
            withAnimation { self.error = ErrorText.from(error) }
        }
        busy = false
    }

    private func submitSignIn() async throws {
        guard email.isValidEmail else { throw AppError("Enter a valid email address.") }
        guard !password.isEmpty else { throw AppError("Enter your password.") }
        try await auth.signIn(email: email, password: password)
    }

    private func submitSignUp() async throws {
        guard !orgName.trimmed.isEmpty else { throw AppError("Organization name is required.") }
        guard !fullName.trimmed.isEmpty else { throw AppError("Your name is required.") }
        guard email.isValidEmail else { throw AppError("Enter a valid email address.") }
        guard password.count >= 8 else { throw AppError("Password must be at least 8 characters.") }
        guard acceptedTerms else { throw AppError("Please accept the Terms and Privacy Policy.") }
        try await auth.signUp(orgName: orgName, fullName: fullName, email: email, password: password)
    }

    private func submitForgot() async throws {
        guard email.isValidEmail else { throw AppError("Enter the email you sign in with.") }
        let sent = try await auth.requestPasswordReset(email: email)
        guard sent else { throw AppError("Password reset email isn't available right now. Ask your organization admin to reset it for you.") }
        withAnimation {
            info = "If an account exists for \(email.trimmed), a code is on its way."
            mode = .forgotCode
        }
    }

    private func submitReset() async throws {
        guard code.filter(\.isNumber).count >= 6 else { throw AppError("Enter the 6-digit code from the email.") }
        guard newPassword.count >= 8 else { throw AppError("Password must be at least 8 characters.") }
        try await auth.completePasswordReset(email: email, code: code, password: newPassword)
    }
}

struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Button {
                configuration.isOn.toggle()
            } label: {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(configuration.isOn ? Color.fwEmber : Color.fwInk3)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: configuration.isOn)
            .accessibilityLabel("Accept terms")
            .accessibilityValue(configuration.isOn ? "Checked" : "Unchecked")
            configuration.label
            Spacer(minLength: 0)
        }
    }
}
