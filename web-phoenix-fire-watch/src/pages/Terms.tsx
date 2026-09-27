import { Link } from "react-router-dom";

import { LegalLayout } from "@/components/fw/LegalLayout";
import { LEGAL } from "@/lib/legal";

const Terms = () => (
  <LegalLayout
    title="Terms of Service"
    description="The terms that apply to organizations and officers using the Phoenix Fire Watch patrol logging app."
  >
    <p>
      These Terms of Service ("Terms") are an agreement between you and {LEGAL.companyName} ("we", "us") covering your
      use of the {LEGAL.appName} app and website (the "Service"). By creating an organization or signing in, you agree
      to these Terms and our <Link to="/privacy">Privacy Policy</Link>. If you use the Service on behalf of a company,
      you confirm you are authorized to accept these Terms for it.
    </p>

    <h2>1. The Service</h2>
    <p>
      {LEGAL.appName} helps fire watch and security teams record patrols, attach photos, share watch notes and produce
      PDF shift reports. The Service is a record-keeping tool.{" "}
      <strong>
        It is not a fire alarm, monitoring or emergency service and does not contact emergency responders.
      </strong>{" "}
      In an emergency, call 911 or your local emergency number.
    </p>

    <h2>2. Accounts</h2>
    <ul>
      <li>An Org Admin creates the organization and is responsible for the employee logins they create.</li>
      <li>Keep your password confidential. You're responsible for activity under your login.</li>
      <li>You must provide accurate information and be at least 16 years old.</li>
      <li>You can delete your account at any time in Account → Delete Account.</li>
    </ul>

    <h2>3. Your content and responsibilities</h2>
    <ul>
      <li>
        Your organization owns the records it creates. You grant us a limited license to host, process and display that
        content only to provide the Service.
      </li>
      <li>
        You are responsible for the accuracy of patrol logs and reports, and for meeting any fire code, insurance,
        authority-having-jurisdiction (AHJ) or contractual requirements that apply to your fire watch work.
      </li>
      <li>
        Only upload photos and information you have the right to share, and avoid capturing people's personal
        information unnecessarily.
      </li>
    </ul>

    <h2>4. Electronic signatures</h2>
    <p>
      Shift reports include electronic signatures generated from the officer names recorded on each patrol. By logging
      a patrol under your name, you confirm the entry is accurate and consent to your name being applied as your
      electronic signature on reports that include that patrol. Organizations are responsible for confirming that
      electronic signatures meet the requirements of their clients and local authorities.
    </p>

    <h2>5. Offline use</h2>
    <p>
      Changes made without a connection are stored on your device until they upload. Uninstalling the app, clearing
      browser data or signing out before changes upload may cause them to be lost. Check the sync indicator before
      signing out.
    </p>

    <h2>6. Acceptable use</h2>
    <ul>
      <li>Don't falsify patrol records or misuse the Service for unlawful purposes.</li>
      <li>Don't attempt to access other organizations' data, disrupt the Service, or reverse engineer it.</li>
      <li>Don't upload malware, or content that is illegal, harassing or infringing.</li>
    </ul>

    <h2>7. Fees</h2>
    <p>
      The Service is currently provided without charge. If we introduce paid plans, we will tell you in advance and any
      in-app purchases will be handled through the applicable app store's payment system.
    </p>

    <h2>8. Suspension and termination</h2>
    <p>
      You may stop using the Service at any time. We may suspend or end access for violations of these Terms or to
      protect the Service or others. Org Admins may deactivate or remove employee logins.
    </p>

    <h2>9. Disclaimers</h2>
    <p>
      The Service is provided "as is" and "as available". To the fullest extent permitted by law, we disclaim all
      warranties, express or implied, including merchantability, fitness for a particular purpose and
      non-infringement. We don't guarantee the Service will be uninterrupted or error-free.
    </p>

    <h2>10. Limitation of liability</h2>
    <p>
      To the fullest extent permitted by law, we won't be liable for indirect, incidental, special, consequential or
      punitive damages, or for loss of data, profits or business, arising from your use of the Service. Our total
      liability for any claim is limited to the greater of the amount you paid us in the 12 months before the claim or
      US $100.
    </p>

    <h2>11. Indemnity</h2>
    <p>
      You agree to indemnify us against claims arising from your content, your fire watch operations, or your breach of
      these Terms.
    </p>

    <h2>12. Apple App Store terms</h2>
    <p>
      If you downloaded the app from the Apple App Store: these Terms are between you and us, not Apple. Apple is not
      responsible for the app or its content, has no obligation to provide maintenance or support, and is not
      responsible for any product claims, legal compliance or intellectual property claims relating to the app. If the
      app fails to conform to any applicable warranty, you may notify Apple for a refund of any purchase price (if
      any); to the maximum extent permitted by law, Apple has no other warranty obligation. You confirm you are not
      located in a country subject to a U.S. Government embargo and are not on any U.S. Government restricted-party
      list. Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you.
      Your use of the app must also comply with Apple's Standard Licensed Application End User License Agreement.
    </p>

    <h2>13. Governing law</h2>
    <p>
      These Terms are governed by the laws of {LEGAL.governingLaw}, without regard to conflict-of-law rules, except
      where local consumer law requires otherwise.
    </p>

    <h2>14. Changes</h2>
    <p>
      We may update these Terms. We'll update the effective date and, for material changes, ask you to review them in
      the app. Continued use after changes means you accept them.
    </p>

    <h2>15. Contact</h2>
    <p>
      <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>
    </p>
  </LegalLayout>
);

export default Terms;
