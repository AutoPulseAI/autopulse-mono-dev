import { AGENT_VIEW_LANGUAGES } from "../dealer/utils/agentViewLanguages.js";

const RESTCOUNTRIES_V5_BASE = "https://api.restcountries.com/countries/v5";
const PAGE_LIMIT = 100;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let cachedLanguages = null;
let cachedAt = 0;

function extractLanguageNames(countries) {
  const unique = new Set(["English"]);
  if (!Array.isArray(countries)) return unique;

  for (const country of countries) {
    const langs = country?.languages;
    if (!Array.isArray(langs)) continue;
    for (const lang of langs) {
      const name = typeof lang?.name === "string" ? lang.name.trim() : "";
      if (name) unique.add(name);
    }
  }

  return unique;
}

async function fetchCountriesPage(apiKey, offset) {
  const url = new URL(RESTCOUNTRIES_V5_BASE);
  url.searchParams.set("response_fields", "languages");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 604800 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`REST Countries v5 failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Loads language names from REST Countries v5 (server-side only).
 * Falls back to bundled static list when the key is missing or the API fails.
 */
export async function getAgentViewLanguages() {
  if (cachedLanguages && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { languages: cachedLanguages, source: "restcountries-v5-cache" };
  }

  const apiKey = process.env.RESTCOUNTRIES_API_KEY?.trim();
  if (!apiKey) {
    return { languages: AGENT_VIEW_LANGUAGES, source: "static" };
  }

  try {
    const unique = new Set(["English"]);
    let offset = 0;
    let more = true;

    while (more) {
      const payload = await fetchCountriesPage(apiKey, offset);
      const objects = payload?.data?.objects;
      if (!Array.isArray(objects) || objects.length === 0) break;

      extractLanguageNames(objects).forEach((name) => unique.add(name));

      const meta = payload?.meta || payload?.data?.meta;
      more = Boolean(meta?.more);
      offset += objects.length;

      if (!more && objects.length === PAGE_LIMIT) {
        // Some responses omit meta.more; keep paging until a short page.
        more = objects.length >= PAGE_LIMIT;
      }

      if (offset > 500) break;
    }

    const languages = Array.from(unique).sort((a, b) => a.localeCompare(b));
    // Use v5 whenever we got a real multi-country payload (demo/single-page = too few).
    if (languages.length < 30 || offset < 50) {
      return { languages: AGENT_VIEW_LANGUAGES, source: "static-fallback" };
    }

    cachedLanguages = languages;
    cachedAt = Date.now();
    return { languages, source: "restcountries-v5" };
  } catch (err) {
    console.error("REST Countries language fetch failed:", err.message);
    return { languages: AGENT_VIEW_LANGUAGES, source: "static-fallback" };
  }
}
