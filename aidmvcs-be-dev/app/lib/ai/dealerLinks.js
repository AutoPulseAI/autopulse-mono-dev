// The links the AI can share "at the right time" (Betsy, 22 Oct 2026), edited by the dealership on AI Settings.
// Three are Dealer Setup's existing fields (the AI already read them); the rest live in
// dealer_account_information.ai_links. The AI reads both (agentic-upsell integrations/dealer_profile.py).

export const DEALER_LINKS = [
  { key: "trade_estimate", label: "Trade Estimate", field: "trade_in_appraisal_url" },
  { key: "prequalification", label: "Prequalification" },
  { key: "credit_application", label: "Full Credit Application", field: "credit_finance_application_url" },
  { key: "hours_map", label: "Hours & Map" },
  { key: "service_scheduler", label: "Service Scheduler" },
  { key: "dealer_website", label: "Dealer Website", field: "store_website" },
  { key: "new_car_specials", label: "New Car Specials" },
  { key: "used_car_specials", label: "Used Car Specials" },
  { key: "service_specials", label: "Service Specials" },
  { key: "parts_specials", label: "Parts Specials" },
  { key: "oem_incentives", label: "OEM Incentives" },
];

export function dealerLinksView(dealer) {
  const info = dealer?.dealer_account_information || {};
  return Object.fromEntries(DEALER_LINKS.map(({ key, field }) => [key, (field ? info[field] : info.ai_links?.[key]) || ""]));
}

// {key: url} -> the $set for the dealer, or errors. An empty value clears that link.
export function dealerLinksUpdate(links) {
  const errors = [];
  const set = {};
  if (typeof links !== "object" || links === null) return { errors: ["links must be an object"], set };
  for (const { key, label, field } of DEALER_LINKS) {
    if (links[key] === undefined) continue;
    const url = String(links[key] || "").trim();
    if (url && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) {
      errors.push(`${label}: enter a full web address starting with https://`);
      continue;
    }
    set[field ? `dealer_account_information.${field}` : `dealer_account_information.ai_links.${key}`] = url;
  }
  const unknown = Object.keys(links).filter((k) => !DEALER_LINKS.some((l) => l.key === k));
  if (unknown.length) errors.push(`Unknown link: ${unknown.join(", ")}`);
  return { errors, set };
}
