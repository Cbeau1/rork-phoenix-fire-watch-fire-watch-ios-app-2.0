import { Link } from "react-router-dom";

import { LegalLayout } from "@/components/fw/LegalLayout";
import { LEGAL } from "@/lib/legal";

const Privacy = () => (
  <LegalLayout
    title="Privacy Policy"
    description="How Phoenix Fire Watch collects, uses, stores, retains and deletes information for fire watch organizations and their officers."
  >
    <p>
      This Privacy Policy explains how {LEGAL.companyName} ("we", "us") handles information when organizations and
      their employees use the {LEGAL.appName} app and website (the "Service"). The Service is a business tool: an
      organization (such as a fire watch or security company) creates an account and gives logins to its officers.
    </p>

    <h2>1. Information we collect</h2>
    <h3>Account information</h3>
    <ul>
      <li>Name, work email address and a password (stored only as a secure hash by our authentication provider).</li>
      <li>Your organization's name, your role (Org Admin or Fire Watch Officer) and whether your login is active.</li>
      <li>The date you accepted these terms.</li>
    </ul>
    <h3>Content you create</h3>
    <ul>
      <li>Properties: names, addresses and property contact details (name, phone, email) entered by your team.</li>
      <li>Patrol logs: date and time, officer name, areas patrolled, status, notes and any photos you attach.</li>
      <li>Watch notes shared with your team.</li>
      <li>
        Location for geofenced properties: when an Org Admin turns on a geofence for a property, your device's location
        (latitude, longitude and GPS accuracy) is checked when you log a patrol there and saved with that patrol log as
        proof you were on site. Location is only read while the Log Patrol screen is open for a geofenced property — never
        in the background, and never for tracking.
      </li>
    </ul>
    <h3>Information stored on your device</h3>
    <ul>
      <li>
        A sign-in session and a copy of your organization's data so the app keeps working offline, plus any patrols,
        photos or notes that are waiting to upload. This is cleared when you sign out or delete your account.
      </li>
    </ul>
    <p>
      <strong>We do not collect</strong> your location outside of logging a patrol at a geofenced property, contacts, health data, browsing history or advertising
      identifiers. We do not use third-party advertising or cross-app tracking, and we do not sell or share personal
      information for advertising.
    </p>

    <h2>2. How we use information</h2>
    <ul>
      <li>To provide the Service: sign-in, syncing patrol logs between team members, and generating PDF shift reports.</li>
      <li>To place the officer names recorded on patrols as electronic signatures on shift reports you generate.</li>
      <li>To keep the Service secure, prevent abuse and troubleshoot problems.</li>
      <li>To respond to support requests.</li>
    </ul>

    <h2>3. Who can see your information</h2>
    <ul>
      <li>
        <strong>Your organization.</strong> Records are visible only to active members of the organization that
        created them. Org Admins can manage employee logins.
      </li>
      <li>
        <strong>People you send reports to.</strong> When you download or share a PDF report, you choose who receives
        it.
      </li>
      <li>
        <strong>Service providers.</strong> We use Supabase (database, authentication and file storage) to host the
        Service. They process data on our behalf under contractual confidentiality and security obligations.
      </li>
      <li>
        <strong>Legal reasons.</strong> We may disclose information if required by law or to protect the rights and
        safety of users and the public.
      </li>
    </ul>

    <h2>4. Data retention</h2>
    <ul>
      <li>
        Records are kept for as long as your organization's account is active, unless an Org Admin sets an{" "}
        <strong>automatic retention period</strong> (6 months to 7 years) in Account → Data &amp; Privacy. Patrol logs,
        their photos and resolved notes older than that period are permanently deleted daily.
      </li>
      <li>Records can also be deleted at any time by authorized team members.</li>
      <li>When an account or organization is deleted, its data is removed immediately from our live systems.</li>
      <li>Residual copies in encrypted infrastructure backups are overwritten within 30 days.</li>
    </ul>

    <h2>5. Deleting your account</h2>
    <p>
      You can delete your account at any time inside the app: <strong>Account → Delete Account</strong>.
    </p>
    <ul>
      <li>
        <strong>Delete my account</strong> removes your login and profile immediately. Patrol logs you recorded remain
        with your organization as its business records, without a link to your account.
      </li>
      <li>
        <strong>Delete organization</strong> (Org Admins) permanently removes the organization, every employee login,
        and all properties, patrol logs, photos and notes.
      </li>
    </ul>
    <p>
      If you can't access the app, email <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> from the
      email on your account and we'll complete the deletion within 30 days.
    </p>

    <h2>6. Security</h2>
    <p>
      Data is encrypted in transit (HTTPS) and at rest. Access is restricted per organization by database security
      rules, and photos are stored privately and shown only through short-lived links. No method of storage is 100%
      secure, but we work to protect your information.
    </p>

    <h2>7. Your rights</h2>
    <p>
      Depending on where you live (for example under the GDPR or CCPA/CPRA), you may have the right to access,
      correct, export or delete your personal information, or to object to certain processing. Because the Service is
      provided to your employer, we may direct some requests to your organization. Contact us at{" "}
      <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. We will not discriminate against you for
      exercising your rights.
    </p>

    <h2>8. Children</h2>
    <p>
      The Service is intended for businesses and their employees and is not directed to children under 16. We do not
      knowingly collect information from children.
    </p>

    <h2>9. International transfers</h2>
    <p>
      Information may be processed in the United States or other countries where our providers operate, with
      appropriate safeguards.
    </p>

    <h2>10. Changes</h2>
    <p>
      We may update this policy. We'll change the effective date above and, for material changes, notify users in the
      app.
    </p>

    <h2>11. Contact</h2>
    <p>
      Questions about privacy: <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. See also our{" "}
      <Link to="/terms">Terms of Service</Link>.
    </p>
  </LegalLayout>
);

export default Privacy;
