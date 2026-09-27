import { Link } from "react-router-dom";

import { LegalLayout } from "@/components/fw/LegalLayout";
import { LEGAL } from "@/lib/legal";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do I get started?",
    a: (
      <>
        Open the app and choose <strong>Create Organization</strong>. You become the Org Admin and can add officer logins
        from the <strong>Team</strong> page.
      </>
    ),
  },
  {
    q: "I forgot my password.",
    a: (
      <>
        Ask your Org Admin to reset it from Team → member menu → Reset password. Admins who are locked out can email{" "}
        <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a> from the account email.
      </>
    ),
  },
  {
    q: "Does the app work without internet?",
    a: (
      <>
        Yes. Once you've signed in on a device, you can log patrols with photos and write notes offline. They're saved on
        the device and upload automatically when a connection returns. The sync indicator in the menu shows anything
        still waiting. Don't sign out while items are waiting to upload.
      </>
    ),
  },
  {
    q: "How are shift reports signed?",
    a: (
      <>
        Each PDF report automatically includes an electronic signature for every officer who recorded patrols in that
        period, with the date and time it was generated.
      </>
    ),
  },
  {
    q: "How long is data kept?",
    a: (
      <>
        Until you delete it, unless your Org Admin sets an automatic retention period in Account → Data &amp; Privacy.
        See the <Link to="/privacy">Privacy Policy</Link>.
      </>
    ),
  },
  {
    q: "How do I delete my account?",
    a: (
      <>
        Go to <strong>Account → Delete Account</strong>. Officers can delete their own login; Org Admins can also
        delete the whole organization and all its data. If you can't sign in, email{" "}
        <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
      </>
    ),
  },
];

const Support = () => (
  <LegalLayout
    title="Help & Support"
    description="Get help with Phoenix Fire Watch: sign-in, offline patrol logging, signed PDF shift reports, data retention and account deletion."
    updated={false}
  >
    <h2>Contact us</h2>
    <p>
      Email <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>. We usually reply within one business day.
      Include your organization name and the device you're using.
    </p>
    <p>
      <strong>This app is not an emergency service.</strong> For a fire or emergency, call 911 or your local emergency
      number.
    </p>

    <h2>Frequently asked questions</h2>
    {FAQ.map((item) => (
      <div key={item.q}>
        <h3>{item.q}</h3>
        <p>{item.a}</p>
      </div>
    ))}

    <h2>Legal</h2>
    <p>
      <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
    </p>
  </LegalLayout>
);

export default Support;
