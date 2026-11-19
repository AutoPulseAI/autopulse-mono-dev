// Who gives a dealer's customers a trade-in value (Betsy, 19 Nov 2026: "the dealer will be able to decide if autopulse
// will be able to provide values or if we will provide the dealer's link. So in each account, the super admin (us)
// will need to be able to select or flip a switch. Not every dealer will have the same process").
//   dealer_link  the dealer's own Trade Estimate link (AI Settings > Links) - the default, as before
//   autopulse    AutoPulse values from Vehicle Databases (agentic-upsell agent/trade_values.py)
// Stored as dealer_account_information.trade_value_source. Pure; the settings route and the value route use it.
export const TRADE_VALUE_SOURCES = Object.freeze(["dealer_link", "autopulse"]);

export const tradeValueSource = (dealer) =>
  (dealer?.dealer_account_information?.trade_value_source === "autopulse" ? "autopulse" : "dealer_link");

const STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));

/** "New York" / "ny" / "NY " -> "NY"; null when it isn't a US state. */
export function stateCode(value) {
  const s = String(value ?? "").trim();
  if (CODES.has(s.toUpperCase())) return s.toUpperCase();
  return STATES[s.toLowerCase().replace(/\s+/g, " ")] || null;
}
