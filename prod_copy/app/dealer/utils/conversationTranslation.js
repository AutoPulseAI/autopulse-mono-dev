import { AGENT_VIEW_LANGUAGES } from "./agentViewLanguages.js";

/** Languages the agent/BDC can choose to view the thread in. */
export const AGENT_VIEW_LANGUAGE_OPTIONS = AGENT_VIEW_LANGUAGES;

/** Loads languages via our API (REST Countries v5 server-side; static fallback). */
export async function fetchAgentLanguageOptions() {
  try {
    const res = await fetch("/api/conversations/languages");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.languages) && data.languages.length > 0) {
      return data.languages;
    }
  } catch {
    // Same-origin API unavailable — use bundled list (no browser CORS to restcountries).
  }
  return AGENT_VIEW_LANGUAGES;
}

/** Pretty label for API and UI (e.g. "english" → "English"). */
export function formatDisplayLanguageName(raw) {
  const s = (raw || "").toString().trim();
  if (!s) return "English";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Resolves stored user_language (lowercase in DB) with English fallback.
 * @param {string|undefined} raw - from email or lead
 */
export function normalizeUserLanguageRaw(raw) {
  const v = raw;
  if (v == null || String(v).trim() === "") return "english";
  return String(v).trim().toLowerCase();
}

/**
 * Per-message user language: email.user_language, else lead.user_language, else english.
 */
export function messageUserLanguageRaw(email, lead) {
  const fromEmail = email?.user_language;
  if (fromEmail != null && String(fromEmail).trim() !== "") {
    return normalizeUserLanguageRaw(fromEmail);
  }
  return normalizeUserLanguageRaw(lead?.user_language);
}

export function messageUserLanguageDisplay(email, lead) {
  return formatDisplayLanguageName(messageUserLanguageRaw(email, lead));
}

/** Lead-level user language for toolbar / batch source hint. */
export function leadUserLanguageRaw(lead) {
  return normalizeUserLanguageRaw(lead?.user_language);
}

export function leadUserLanguageDisplay(lead) {
  return formatDisplayLanguageName(leadUserLanguageRaw(lead));
}
