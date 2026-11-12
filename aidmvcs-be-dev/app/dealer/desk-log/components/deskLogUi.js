// Colours and labels for the Desk Log screen (Betsy's design).
import { UNSOLD_REASONS } from "../../../lib/deskLog/constants";

export const STAGE_STYLE = {
  QUALIFY: { background: "#2563eb", color: "#fff" },
  "TEST DRIVE": { background: "#22c55e", color: "#fff" },
  APPRAISAL: { background: "#0d9488", color: "#fff" },
  PROPOSAL: { background: "#facc15", color: "#1f2937" },
  "T.O.": { background: "#f97316", color: "#fff" },
  "VERBAL AGREEMENT": { background: "#7c3aed", color: "#fff" },
};
export const NO_STAGE_STYLE = { background: "#f3f4f6", color: "#6b7280" };

// One menu for the outcome, as the design shows it: SOLD PENDING, SOLD DELIVERED, UNSOLD <reason>.
export const OUTCOME_CHOICES = [
  { value: "SOLD PENDING", outcome: "SOLD PENDING", reason: null, label: "SOLD PENDING",
    style: { background: "#bbf7d0", color: "#14532d" } },
  { value: "SOLD DELIVERED", outcome: "SOLD DELIVERED", reason: null, label: "SOLD DELIVERED",
    style: { background: "#22c55e", color: "#fff" } },
  ...[
    [UNSOLD_REASONS.NEGATIVE_EQUITY, { background: "#fca5a5", color: "#7f1d1d" }],
    [UNSOLD_REASONS.DND, { background: "#d1d5db", color: "#111827" }],
    [UNSOLD_REASONS.PRICE_PAYMENT, { background: "#fca5a5", color: "#7f1d1d" }],
    [UNSOLD_REASONS.CREDIT, { background: "#fca5a5", color: "#7f1d1d" }],
    [UNSOLD_REASONS.HOT, { background: "#dc2626", color: "#fff" }],
    [UNSOLD_REASONS.FUTURE_FOLLOW_UP, { background: "#c4b5fd", color: "#3b0764" }],
    [UNSOLD_REASONS.CAR_FINDER, { background: "#c4b5fd", color: "#3b0764" }],
  ].map(([reason, style]) => ({ value: `UNSOLD|${reason}`, outcome: "UNSOLD", reason,
    label: `UNSOLD ${reason === UNSOLD_REASONS.FUTURE_FOLLOW_UP ? "FUTURE F/U" : reason.toUpperCase()}`, style })),
];
export const NO_OUTCOME_STYLE = { background: "#fff", color: "#374151", border: "1px dashed #9ca3af" };

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
export const ROW_COLOR = { Internet: "#facc15", Phone: "#a855f7", "Walk-in": "#22c55e" };

export const vehicleText = (v) => [v?.year, v?.make, v?.model, v?.trim].filter(Boolean).join(" ");

export function ageText(minutes) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} min in stage`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min in stage`;
  return `${Math.floor(minutes / 1440)} days in stage`;
}
