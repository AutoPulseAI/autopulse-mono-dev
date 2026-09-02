import { Container } from "react-bootstrap";

export const metadata = {
  title: "Privacy Policy | Autopulse AI",
  description: "Autopulse AI's privacy policy, including how we collect, use, and protect information, and details of our SMS/text messaging program.",
};

const LAST_UPDATED = "September 2, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="page_content_wrap">
      <Container className="section_padding">
        <div className="section_heading">
          <h1>Privacy Policy</h1>
          <p className="section_sub_heading">Last updated: {LAST_UPDATED}</p>
        </div>

        <p>
          Autopulse AI (&quot;Autopulse AI&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) respects your privacy and is
          committed to protecting it through this Privacy Policy. This policy explains what
          information we collect, how we use it, and the choices you have, including in
          connection with our SMS/text messaging communications.
        </p>

        <h2>1. Information We Collect</h2>
        <p>We may collect the following types of information:</p>
        <ul>
          <li>
            <strong>Contact information</strong> you or a dealership provide to us, such as your
            name, email address, mailing address, and phone number.
          </li>
          <li>
            <strong>Communications data</strong>, including the content of emails, text messages,
            and other messages you exchange with us or a participating dealership through our
            platform.
          </li>
          <li>
            <strong>Vehicle and inquiry information</strong> related to your interest in a
            vehicle or dealership service.
          </li>
          <li>
            <strong>Usage data</strong>, such as how you interact with our website, application,
            and communications (e.g., pages viewed, links clicked).
          </li>
          <li>
            <strong>Technical data</strong>, such as IP address, browser type, and device
            information, collected automatically when you use our services.
          </li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, operate, and improve our products and services;</li>
          <li>Respond to inquiries and facilitate communication between you and a dealership;</li>
          <li>Send you the SMS, email, or other communications you have requested or consented to receive;</li>
          <li>Maintain the security and integrity of our services;</li>
          <li>Comply with legal obligations and enforce our agreements.</li>
        </ul>

        <h2>3. SMS / Text Messaging Program</h2>
        <p>
          If you provide your mobile phone number to us or to a participating dealership and opt
          in to receive text messages, the following terms apply to that SMS program:
        </p>
        <ul>
          <li>
            <strong>Consent.</strong> By opting in, you consent to receive recurring
            automated and/or manually sent text messages (e.g., appointment reminders, follow-ups,
            and responses to your inquiries) from us or the dealership you contacted, sent via
            our messaging platform (including through Twilio, our SMS service provider).
          </li>
          <li>
            <strong>Message frequency</strong> varies depending on your interaction with us
            and the dealership, and may include multiple messages per conversation.
          </li>
          <li>
            <strong>Message and data rates may apply.</strong> Standard messaging rates charged
            by your mobile carrier may apply to messages we send.
          </li>
          <li>
            <strong>Opt-out.</strong> You may opt out of receiving SMS messages at any time by
            replying <strong>STOP</strong> to any message. You will receive a one-time confirmation
            message, and no further messages will be sent unless you opt back in.
          </li>
          <li>
            <strong>Help.</strong> For help, reply <strong>HELP</strong> to any message, or contact
            us using the information in the &quot;Contact Us&quot; section below.
          </li>
          <li>
            <strong>Carrier liability.</strong> Carriers are not liable for delayed or
            undelivered messages.
          </li>
          <li>
            <strong>No sharing of SMS opt-in data.</strong> We do not share mobile phone numbers
            or SMS opt-in consent collected through this program with third parties or affiliates
            for their own marketing or promotional purposes. Your mobile information is used
            solely to facilitate the SMS communications described in this policy.
          </li>
        </ul>

        <h2>4. How We Share Information</h2>
        <p>We may share information with:</p>
        <ul>
          <li>
            Participating dealerships, so they can respond to your inquiries and manage the
            relationship with you;
          </li>
          <li>
            Service providers who perform services on our behalf, such as messaging delivery
            (including Twilio), hosting, and analytics, under confidentiality obligations;
          </li>
          <li>
            Authorities where required to comply with applicable law, regulation, legal process,
            or governmental request.
          </li>
        </ul>
        <p>We do not sell your personal information.</p>

        <h2>5. Data Security</h2>
        <p>
          We use reasonable administrative, technical, and physical safeguards designed to
          protect the information we collect. However, no method of transmission or storage is
          completely secure, and we cannot guarantee absolute security.
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We retain personal information for as long as necessary to fulfill the purposes
          described in this policy, unless a longer retention period is required or permitted by
          law.
        </p>

        <h2>7. Your Choices</h2>
        <p>
          In addition to SMS opt-out instructions above, you may contact us at any time to ask
          questions about the information we hold about you, request corrections, or request
          deletion, subject to applicable law.
        </p>

        <h2>8. Children&apos;s Privacy</h2>
        <p>
          Our services are not directed to individuals under the age of 18, and we do not
          knowingly collect personal information from children.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be posted on this
          page with an updated &quot;Last updated&quot; date.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or our SMS program, contact us at:
        </p>
        <p>
          Autopulse AI
          <br />
          651 DeRose Ln, Freehold, NJ 07728
          <br />
          Email: <a href="mailto:contact@autopulse.ai">contact@autopulse.ai</a>
          <br />
          Phone: <a href="tel:7186075434">(718) 607-5434</a>
        </p>
      </Container>
    </div>
  );
}
