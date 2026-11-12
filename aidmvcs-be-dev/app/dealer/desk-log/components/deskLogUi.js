// Colours and labels for the Desk Log screen (Betsy's design).
import { UNSOLD_REASONS } from "../../../lib/deskLog/constants";

// Platform colours (user, 13 Nov 2026: the Desk Log didn't follow the platform). Stages are one blue, lighter to darker
// as the deal moves on; outcomes use the platform's green (sold) and red (unsold) only.
export const STAGE_STYLE = {
  QUALIFY: { background: "#e8f2f9", color: "#015688" },
  "TEST DRIVE": { background: "#d0e5f3", color: "#015688" },
  APPRAISAL: { background: "#a8cfe9", color: "#013f63" },
  PROPOSAL: { background: "#6db0dd", color: "#012b44" },
  "T.O.": { background: "#0272b4", color: "#fff" },
  "VERBAL AGREEMENT": { background: "#015688", color: "#fff" },
};
export const NO_STAGE_STYLE = { background: "#fff", color: "#6c757d", border: "1px dashed #ced4da" };

// One menu for the outcome, as the design shows it: SOLD PENDING, SOLD DELIVERED, UNSOLD <reason>.
const SOLD = { background: "#198754", color: "#fff" };
const UNSOLD = { background: "#fff", color: "#b02a37", border: "1px solid #f1aeb5" };
export const OUTCOME_CHOICES = [
  { value: "SOLD PENDING", outcome: "SOLD PENDING", reason: null, label: "SOLD PENDING",
    style: { background: "#e8f5ee", color: "#146c43", border: "1px solid #a3cfbb" } },
  { value: "SOLD DELIVERED", outcome: "SOLD DELIVERED", reason: null, label: "SOLD DELIVERED", style: SOLD },
  ...[UNSOLD_REASONS.NEGATIVE_EQUITY, UNSOLD_REASONS.DND, UNSOLD_REASONS.PRICE_PAYMENT, UNSOLD_REASONS.CREDIT,
    UNSOLD_REASONS.HOT, UNSOLD_REASONS.FUTURE_FOLLOW_UP, UNSOLD_REASONS.CAR_FINDER,
  ].map((reason) => ({ value: `UNSOLD|${reason}`, outcome: "UNSOLD", reason,
    label: `UNSOLD ${reason === UNSOLD_REASONS.FUTURE_FOLLOW_UP ? "FUTURE F/U" : reason.toUpperCase()}`,
    style: reason === UNSOLD_REASONS.DND ? { background: "#f1f3f5", color: "#495057", border: "1px solid #dee2e6" } : UNSOLD })),
];
export const NO_OUTCOME_STYLE = { background: "#fff", color: "#6c757d", border: "1px dashed #ced4da" };

export const choiceOf = (row) => OUTCOME_CHOICES.find((c) => c.outcome === row.outcome
  && (c.reason || null) === (row.unsold_reason || null)) || null;

// What an outcome does to the lead, said before it is saved (it runs the lead's existing follow-ups).
export function outcomeEffect(choice) {
  if (!choice) return "";
  if (choice.reason === UNSOLD_REASONS.DND) {
    return 'The lead becomes "Opt-Out": the AI and the automatic follow-ups stop messaging this customer.';
  }
  const status = { "SOLD PENDING": "Sold Pending", "SOLD DELIVERED": "Sold - Delivered", UNSOLD: "Unsold" }[choice.outcome];
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
