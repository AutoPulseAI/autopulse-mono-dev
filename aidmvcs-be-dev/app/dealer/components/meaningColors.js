// What a colour means in the dealer portal. The Desk Log (Betsy's design) is the source of truth: CARD_COLOR and
// OUTCOME_STYLE are its values, and every other page takes its colours from here - never a hex code on a page.
// A meaning the Desk Log has no colour for is under "Not on the Desk Log".
export const CARD_COLOR = {
  internet: "#1d6fe0", phone: "#7c3aed", walk_in: "#2fb344", appts_set: "#f7931e", appts_showed: "#1e3a8a",
  sold_pending: "#2fb344", sold_delivered: "#e5383b", action_required: "#e0a800", closed_lost: "#6c757d",
};

export const OUTCOME_STYLE = {
  sold_pending: { backgroundColor: "#b7ebb0", color: "#14532d" },
  sold_delivered: { backgroundColor: "#34c759", color: "#fff" },
  unsold: { backgroundColor: "#f8a9ad", color: "#5c1015" },
  dnd: { backgroundColor: "#ced4da", color: "#343a40" },
};

export const MEANING = {
  appointment: CARD_COLOR.appts_set,
  showed: CARD_COLOR.appts_showed,
  sold: CARD_COLOR.sold_pending,
  action: CARD_COLOR.action_required,
  closed: CARD_COLOR.closed_lost,
  // Not on the Desk Log
  lead: "#0272b4", // the brand blue
  reply: "#f7931e", // the colour the client already had for Customer Replied; it is also the Desk Log's appointment orange
  neutral: "#5f7890",
};

// Dark text on the light colours, so a badge stays readable.
const APPT = { backgroundColor: MEANING.appointment, color: "#3a2000" };
const SHOWED = { backgroundColor: MEANING.showed, color: "#fff" };
const CLOSED = { backgroundColor: MEANING.closed, color: "#fff" };
// Lighter than the solid appointment orange, so the two stay apart in a list.
const REPLY = { backgroundColor: "#ffe0b8", color: "#7a3f00" };
const STATUS_STYLE = {
  lead: { backgroundColor: MEANING.lead, color: "#fff" },
  contacted: REPLY,
  "contacted - no next action": REPLY,
  "contacted - specific follow-up": REPLY,
  "appointment booked": APPT,
  "no show": { backgroundColor: "#fff", color: "#8a4b00", boxShadow: `inset 0 0 0 1px ${MEANING.appointment}` },
  visited: SHOWED,
  "managerial review": { backgroundColor: MEANING.action, color: "#3d3200" },
  sold: OUTCOME_STYLE.sold_delivered,
  "sold pending": OUTCOME_STYLE.sold_pending,
  "sold delivered": OUTCOME_STYLE.sold_delivered,
  unsold: OUTCOME_STYLE.unsold,
  "closed - lost": CLOSED,
  "closed - no longer owns": CLOSED,
  dnd: OUTCOME_STYLE.dnd,
  "opted out": OUTCOME_STYLE.dnd,
};
const NO_STATUS = { backgroundColor: "#eef1f4", color: "#495057" };

// A lead status badge. label: what the lead shows ("Appointment Showed" is display only, lib/statusLabels.js).
export function statusStyle(status, label) {
  if (label === "Appointment Showed") return SHOWED;
  return STATUS_STYLE[String(status || "").trim().toLowerCase()] || NO_STATUS;
}

// One solid colour per status, for a chart bar.
const CHART = { contacted: "#ffc98a", "contacted - no next action": "#ffc98a", "contacted - specific follow-up": "#ffc98a",
  "no show": "#fbc98e", "sold pending": "#7fd08a" };
export function statusChartColor(status) {
  const key = String(status || "").trim().toLowerCase();
  return CHART[key] || STATUS_STYLE[key]?.backgroundColor || "#9aa8b5";
}
