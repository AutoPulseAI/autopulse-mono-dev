// Colours and labels for the Desk Log screen (Betsy's design).
import { UNSOLD_REASONS } from "../../../lib/deskLog/constants";

// Betsy's colour coding (her Desk Log design, SOW v6 Appendix B1; 13 Nov 2026 meeting: "the colour coding is
// functional ... they can just glance and know what's going on"). Each stage, outcome, lead type and headline card
// keeps its own colour everywhere on the Desk Log.
export const STAGE_STYLE = {
  QUALIFY: { backgroundColor: "#1d6fe0", color: "#fff" },
  "TEST DRIVE": { backgroundColor: "#2fb344", color: "#fff" },
  APPRAISAL: { backgroundColor: "#0ea5a5", color: "#fff" },
  PROPOSAL: { backgroundColor: "#f6d33c", color: "#3d3200" },
  "T.O.": { backgroundColor: "#f7931e", color: "#fff" },
  "VERBAL AGREEMENT": { backgroundColor: "#7c3aed", color: "#fff" },
};
export const NO_STAGE_STYLE = { backgroundColor: "#fff", color: "#6c757d", border: "1px dashed #ced4da" };

// One menu for the outcome, as the design shows it: SOLD PENDING, SOLD DELIVERED, UNSOLD <reason>.
const PINK = { backgroundColor: "#f8a9ad", color: "#5c1015" };
const PURPLE = { backgroundColor: "#c4a7f5", color: "#2e1065" };
const REASON_STYLE = {
  [UNSOLD_REASONS.NEGATIVE_EQUITY]: PINK, [UNSOLD_REASONS.PRICE_PAYMENT]: PINK, [UNSOLD_REASONS.CREDIT]: PINK,
  [UNSOLD_REASONS.HOT]: { backgroundColor: "#e5383b", color: "#fff" },
  [UNSOLD_REASONS.FUTURE_FOLLOW_UP]: PURPLE, [UNSOLD_REASONS.CAR_FINDER]: PURPLE,
  [UNSOLD_REASONS.DND]: { backgroundColor: "#ced4da", color: "#343a40" },
};
export const OUTCOME_CHOICES = [
  { value: "SOLD PENDING", outcome: "SOLD PENDING", reason: null, label: "SOLD PENDING",
    style: { backgroundColor: "#b7ebb0", color: "#14532d" } },
  { value: "SOLD DELIVERED", outcome: "SOLD DELIVERED", reason: null, label: "SOLD DELIVERED",
    style: { backgroundColor: "#34c759", color: "#fff" } },
  ...[UNSOLD_REASONS.NEGATIVE_EQUITY, UNSOLD_REASONS.DND, UNSOLD_REASONS.PRICE_PAYMENT, UNSOLD_REASONS.CREDIT,
    UNSOLD_REASONS.HOT, UNSOLD_REASONS.FUTURE_FOLLOW_UP, UNSOLD_REASONS.CAR_FINDER,
  ].map((reason) => ({ value: `UNSOLD|${reason}`, outcome: "UNSOLD", reason,
    label: `UNSOLD ${reason === UNSOLD_REASONS.FUTURE_FOLLOW_UP ? "FUTURE F/U" : reason.toUpperCase()}`,
    style: REASON_STYLE[reason] })),
];
export const NO_OUTCOME_STYLE = { backgroundColor: "#fff", color: "#6c757d", border: "1px dashed #ced4da" };

// Lead type badges (Internet blue, Phone Up purple, Walk-In green).
export const TYPE_STYLE = {
  Internet: { backgroundColor: "#d6e9fb", color: "#0b4f8a" }, Phone: { backgroundColor: "#e7dafc", color: "#5b21b6" },
  "Walk-in": { backgroundColor: "#d3f2da", color: "#166534" },
};
// The coloured strip on each row's left edge: the outcome's colour once there is one, else the stage's.
export const rowStripColor = (row, choice) => (choice?.style.backgroundColor || (row.stage && STAGE_STYLE[row.stage]?.backgroundColor)
  || "#dee2e6");

// Headline cards: each its own colour (icon, top bar, today's number).
export const CARD_COLOR = {
  internet: "#1d6fe0", phone: "#7c3aed", walk_in: "#2fb344", appts_set: "#f7931e", appts_showed: "#1e3a8a",
  sold_pending: "#2fb344", sold_delivered: "#e5383b", action_required: "#e0a800", closed_lost: "#6c757d",
};

// Initials for the people avatars.
export const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const AVATAR_COLORS = ["#1d6fe0", "#7c3aed", "#2fb344", "#f7931e", "#0ea5a5", "#e5383b", "#1e3a8a", "#b45309"];
export const avatarColor = (id) => AVATAR_COLORS[[...String(id || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

export const choiceOf = (row) => OUTCOME_CHOICES.find((c) => c.outcome === row.outcome
  && (c.reason || null) === (row.unsold_reason || null)) || null;

// What an outcome does to the lead, said before it is saved (it runs the lead's existing follow-ups).
export function outcomeEffect(choice) {
  if (!choice) return "";
  if (choice.reason === UNSOLD_REASONS.DND) {
    return 'The lead becomes "Opt-Out": the AI and the automatic follow-ups stop messaging this customer.';
  }
  const status = { "SOLD PENDING": "Sold Pending", "SOLD DELIVERED": "Sold - Delivered", UNSOLD: "Unsold" }[choice.outcome];
  if (choice.outcome === "UNSOLD" && choice.reason) {
    // G-017-023: the reason's own first follow-up (AI Studio > Cadences > Unsold), then the usual follow-ups.
    const when = choice.reason === UNSOLD_REASONS.FUTURE_FOLLOW_UP ? "on the next step date" : "today";
    return `The lead becomes "Unsold". The AI follows up ${when} about ${choice.reason}, then keeps following up`
      + (choice.reason === UNSOLD_REASONS.HOT ? "; a call task opens for the salesperson now." : ".");
  }
  return `The lead becomes "${status}" and what is set up for ${status} runs, the same as changing the status on the `
    + "Leads page.";
}

export const TYPE_CLASS = { Internet: "internet", Phone: "phone", "Walk-in": "walk_in" };
export const TYPE_LABEL = { Internet: "Internet", Phone: "Phone Up", "Walk-in": "Walk-In", Campaign: "Campaign",
  Other: "Other" };

export const vehicleText = (v) => [v?.year, v?.make, v?.model, v?.trim].filter(Boolean).join(" ");

export function ageText(minutes) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} min in stage`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min in stage`;
  return `${Math.floor(minutes / 1440)} days in stage`;
}

// Lead source logos (Betsy's design shows each source's logo). Known sources get their mark / colour; any other source
// a letter in a colour of its own.
const SOURCE_LOGOS = [
  [/facebook|\bfb\b|meta/i, { icon: "fa-brands fa-facebook-f", bg: "#1877f2" }],
  [/google/i, { icon: "fa-brands fa-google", bg: "#4285f4" }],
  [/instagram/i, { icon: "fa-brands fa-instagram", bg: "#c13584" }],
  [/autotrader|auto trader/i, { letter: "A", bg: "#e8412c" }],
  [/cars\.?com/i, { letter: "C", bg: "#6c2bd9" }],
  [/cargurus/i, { letter: "CG", bg: "#00a0dd" }],
  [/kbb|kelley/i, { icon: "fa-solid fa-book", bg: "#1d3f72" }],
  [/truecar/i, { letter: "T", bg: "#00a0dd" }],
  [/capital ?one/i, { letter: "C1", bg: "#d03027" }],
  [/edmunds/i, { letter: "E", bg: "#0062b1" }],
  [/carfax/i, { letter: "CF", bg: "#000" }],
  [/website|dealer site|web/i, { icon: "fa-solid fa-globe", bg: "#212529" }],
  [/phone|call/i, { icon: "fa-solid fa-phone", bg: "#7c3aed" }],
  [/walk/i, { icon: "fa-solid fa-person-walking", bg: "#2fb344" }],
];
export function sourceLogo(source) {
  const hit = SOURCE_LOGOS.find(([re]) => re.test(String(source || "")));
  return hit ? hit[1] : { letter: String(source || "?").trim().charAt(0).toUpperCase() || "?", bg: avatarColor(source) };
}

// "Jessica Smith" -> "Jessica S." (the design's people columns); the full name shows on hover.
export const shortName = (name) => {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0].toUpperCase()}.` : w[0] || "";
};
// White text on the pill -> a white arrow on its menu.
export const darkPill = (style) => style?.color === "#fff";
