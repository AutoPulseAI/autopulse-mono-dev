/**
 * Server-side helpers to call /api/conversations/translate (cron, workers, lib code).
 * Uses NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL / APP_URL for the origin.
 */

export function normalizeUserLanguage(raw) {
  const v = raw == null ? "" : String(raw).trim();
  return v ? v.toLowerCase() : "english";
}

export function toDisplayLanguageName(raw) {
  const s = normalizeUserLanguage(raw);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getTranslateApiUrl() {
  const base = (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return new URL("/api/conversations/translate", base).toString();
}

/**
 * @param {object} opts
 * @param {string} opts.targetLanguage - Display name, e.g. "French"
 * @param {string} [opts.sourceHint] - Empty string avoids biasing the model away from targetLanguage
 * @param {string} opts.subject
 * @param {string} opts.emailHtml
 * @param {string} opts.smsText
 * @returns {Promise<{ subject: string, emailHtml: string, smsText: string }>}
 */
export async function translateReminderBundle({
  targetLanguage,
  sourceHint = "",
  subject,
  emailHtml,
  smsText,
}) {
  const translateUrl = getTranslateApiUrl();
  const messages = [
    { id: "subject", text: subject || "" },
    { id: "email_html", text: emailHtml || "" },
    { id: "sms", text: smsText || "" },
  ].filter((m) => m.text.trim());

  if (!messages.length) {
    return { subject, emailHtml, smsText };
  }

  const res = await fetch(translateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetLanguage,
      sourceHint,
      messages,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "Failed to translate reminder content.");
  }
  const t = data?.translations || {};
  return {
    subject: typeof t.subject === "string" && t.subject.trim() ? t.subject : subject,
    emailHtml:
      typeof t.email_html === "string" && t.email_html.trim()
        ? t.email_html
        : emailHtml,
    smsText: typeof t.sms === "string" && t.sms.trim() ? t.sms : smsText,
  };
}
