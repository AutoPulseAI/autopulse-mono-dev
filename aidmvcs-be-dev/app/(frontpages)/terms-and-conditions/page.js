import { Container } from "react-bootstrap";

export const metadata = {
  title: "Terms and Conditions | Autopulse AI",
  description: "Autopulse AI's terms and conditions, including the terms of our SMS/text messaging program.",
};

const LAST_UPDATED = "September 2, 2026";

export default function TermsAndConditionsPage() {
  return (
    <div className="page_content_wrap">
      <Container className="section_padding">
        <div className="section_heading">
          <h1>Terms and Conditions</h1>
          <p className="section_sub_heading">Last updated: {LAST_UPDATED}</p>
        </div>

        <p>
          These Terms and Conditions (&quot;Terms&quot;) govern your access to and use of the services
          provided by Autopulse AI (&quot;Autopulse AI&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), including our website,
          application, and communications platform. By using our services, you agree to these
          Terms. If you do not agree, please do not use our services.
        </p>

        <h2>1. Description of Service</h2>
        <p>
          Autopulse AI provides a platform that helps dealerships manage and respond to customer
          leads and inquiries, including via email and SMS text messaging.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old to use our services or to opt in to our SMS program.
        </p>

        <h2>3. SMS / Text Messaging Program</h2>
        <p>
          If you provide your mobile phone number and consent to receive text messages from us or
          a participating dealership, the following terms apply:
        </p>
        <ul>
          <li>
            <strong>Program description.</strong> The SMS program is used to send messages
            related to your inquiries, such as appointment reminders, follow-ups, and responses
            from a dealership representative or automated assistant.
          </li>
          <li>
            <strong>Consent.</strong> By opting in (for example, by submitting your phone number
            through a form, or by texting a dealership), you consent to receive recurring
            automated and/or manually sent text messages from us, sent via our messaging platform
            (including through Twilio, our SMS service provider).
          </li>
          <li>
            <strong>Message frequency</strong> varies and depends on your interaction with us and
            the dealership.
          </li>
          <li>
            <strong>Message and data rates may apply.</strong> Standard messaging rates charged
            by your mobile carrier may apply.
          </li>
          <li>
            <strong>Opt-out.</strong> You may cancel the SMS program at any time by texting
            <strong> STOP</strong>. After you send the message &quot;STOP&quot;, we will send you a message
            to confirm that you have been unsubscribed. After this, you will no longer receive
            SMS messages from us. If you want to join again, sign up as you did the first time,
            or text <strong>START</strong> and we will start sending SMS messages to you again.
          </li>
          <li>
            <strong>Help.</strong> If at any time you have questions about the messages, reply
            <strong> HELP</strong>, or contact us using the information in the &quot;Contact Us&quot;
            section below.
          </li>
          <li>
            <strong>Carriers are not liable</strong> for delayed or undelivered messages.
          </li>
          <li>
            No mobile information collected through this SMS program will be shared with third
            parties or affiliates for their own marketing or promotional purposes.
          </li>
        </ul>

        <h2>4. User Responsibilities</h2>
        <p>
          You agree to provide accurate information, to use our services only for lawful
          purposes, and not to misuse our services, including by sending unlawful, abusive, or
          fraudulent communications through our platform.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          All content, trademarks, and other intellectual property made available through our
          services are owned by Autopulse AI or our licensors. You may not copy, modify,
          distribute, or create derivative works from our services without our prior written
          consent.
        </p>

        <h2>6. Third-Party Services</h2>
        <p>
          Our services rely on third-party providers, including Twilio, to deliver SMS
          communications. We are not responsible for outages, delays, or failures caused by
          third-party providers or mobile carriers.
        </p>

        <h2>7. Disclaimers</h2>
        <p>
          Our services are provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
          whether express or implied, including warranties of merchantability, fitness for a
          particular purpose, or non-infringement.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, Autopulse AI shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages arising out of or
          related to your use of our services.
        </p>

        <h2>9. Termination</h2>
        <p>
          We may suspend or terminate your access to our services at any time, with or without
          notice, for conduct that we believe violates these Terms or is otherwise harmful to
          other users, us, or third parties.
        </p>

        <h2>10. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of New Jersey, without regard to its
          conflict of law principles.
        </p>

        <h2>11. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Changes will be posted on this page with
          an updated &quot;Last updated&quot; date. Continued use of our services after changes become
          effective constitutes acceptance of the revised Terms.
        </p>

        <h2>12. Contact Us</h2>
        <p>If you have questions about these Terms or our SMS program, contact us at:</p>
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
