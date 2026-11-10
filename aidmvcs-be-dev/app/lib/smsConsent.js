// SMS opt-in wording for the public contact form (Twilio A2P web-form requirements:
// unticked box, what the texts are, frequency, rates, HELP/STOP, not a condition of purchase,
// links to Terms and Privacy). Used by the CMS page renderer and the Puck ContactForm.
export const SMS_CONSENT_TEXT =
  "Yes, I agree to receive text messages from AutoPulse and the dealership I contact about my inquiry, " +
  "test drives and appointments. Message frequency varies. Message and data rates may apply. " +
  "Reply HELP for help or STOP to cancel at any time. Consent is not a condition of purchase.";

export const TERMS_URL = "/terms-and-conditions";
export const PRIVACY_URL = "/privacy-policy";

const CONSENT_BLOCK =
  '<div class="form-check mb-3 text-start" data-autopulse-sms-consent>' +
  '<input class="form-check-input" type="checkbox" name="smsConsent" id="smsConsent" />' +
  `<label class="form-check-label" for="smsConsent"><small>${SMS_CONSENT_TEXT} ` +
  `<a href="${TERMS_URL}" target="_blank">Terms and Conditions</a> | ` +
  `<a href="${PRIVACY_URL}" target="_blank">Privacy Policy</a></small></label></div>`;

// Adds the unticked SMS opt-in checkbox to each contact form in page-editor HTML, above its
// "By submitting" note (or its submit button), unless the form already has one. Done on the
// server so the checkbox is in the page source that carrier reviewers and their checkers read.
export function withSmsConsentHtml(html) {
  if (typeof html !== "string" || !html.includes("data-autopulse-contact")) return html;
  return html.replace(/<form\b[^>]*data-autopulse-contact[^>]*>[\s\S]*?<\/form>/g, (form) => {
    if (form.includes('name="smsConsent"')) return form;
    const at = form.search(/<p>\s*<small>\s*By submitting/i);
    const index = at >= 0 ? at : form.search(/<button\b[^>]*type="submit"/i);
    return index < 0 ? form : form.slice(0, index) + CONSENT_BLOCK + form.slice(index);
  });
}
