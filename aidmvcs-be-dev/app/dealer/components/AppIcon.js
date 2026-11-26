"use client";
// The one icon list for the dealer portal (24 Nov 2026): a thing has one icon and one colour on every screen, so a phone
// on Leads looks like a phone on Customers, Actions and the Dashboard. Add or change an icon here, never on a page.
const BLUE = "#0272b4", GREEN = "#2fb344", ORANGE = "#f7931e", RED = "#e5383b", PURPLE = "#6f42c1", TEAL = "#0f8f83",
  AMBER = "#d97706", SLATE = "#5f7890", INDIGO = "#4f46e5";

export const ICONS = {
  // People
  lead: ["fa-user-plus", BLUE], customer: ["fa-user", BLUE], customers: ["fa-users", BLUE], owner: ["fa-user-tie", SLATE],
  noOwner: ["fa-user-slash", RED], staff: ["fa-user", SLATE], ai: ["fa-robot", INDIGO], role: ["fa-id-badge", SLATE],
  // Contact
  phone: ["fa-phone", BLUE], email: ["fa-envelope", PURPLE], sms: ["fa-comment-sms", TEAL], reply: ["fa-comments", ORANGE],
  sent: ["fa-paper-plane", INDIGO], contactMethods: ["fa-address-book", SLATE],
  // Where and when
  source: ["fa-signs-post", SLATE], sender: ["fa-at", SLATE], department: ["fa-building", SLATE], vehicle: ["fa-car-side", SLATE],
  date: ["fa-calendar-day", SLATE], time: ["fa-clock", SLATE], age: ["fa-hourglass-half", ORANGE], history: ["fa-clock-rotate-left", SLATE],
  // Work
  status: ["fa-circle-half-stroke", SLATE], priority: ["fa-flag", SLATE], task: ["fa-list-check", BLUE], action: ["fa-bell", RED],
  stuck: ["fa-road-barrier", AMBER], team: ["fa-users", PURPLE], note: ["fa-note-sticky", AMBER], done: ["fa-circle-check", GREEN],
  overdue: ["fa-clock", RED], missed: ["fa-circle-exclamation", RED], open: ["fa-circle-dot", AMBER], cancelled: ["fa-ban", SLATE],
  outcome: ["fa-bullseye", SLATE], type: ["fa-tag", SLATE], info: ["fa-circle-info", SLATE], escalated: ["fa-arrow-up", RED],
  // Sales journey
  appointment: ["fa-calendar-check", GREEN], appointments: ["fa-calendar-days", GREEN], showed: ["fa-person-walking", GREEN],
  sold: ["fa-handshake", GREEN], chart: ["fa-chart-pie", BLUE], trend: ["fa-chart-line", BLUE], trophy: ["fa-trophy", AMBER],
};

const STATUS_ICONS = {
  lead: "lead", contacted: "reply", "appointment booked": "appointment", visited: "showed", "managerial review": "action",
  sold: "sold", "sold pending": "sold", "sold delivered": "sold", unsold: "history", "closed - lost": "cancelled",
  "closed - no longer owns": "cancelled", dnd: "cancelled", "opted out": "cancelled",
};
// The icon for a lead status (the status's words stay exactly as they are).
export const statusIconName = (status) => STATUS_ICONS[String(status || "").trim().toLowerCase()] || "status";

export const iconColor = (name) => (ICONS[name] || ICONS.info)[1];
export const iconClass = (name) => `fa-solid ${(ICONS[name] || ICONS.info)[0]}`;

// plain: takes the colour of the text around it (on a coloured badge or button).
export default function AppIcon({ name, plain = false, className = "" }) {
  return <i className={`ap_ic ${iconClass(name)} ${className}`.trim()} style={plain ? undefined : { color: iconColor(name) }} aria-hidden="true" />;
}

// A column heading or field label with its icon.
export const IconLabel = ({ name, children }) => <span className="ap_label"><AppIcon name={name} />{children}</span>;

const AVATAR_COLORS = [BLUE, GREEN, PURPLE, "#d9480f", TEAL, "#b02a6b"];
// The same person always gets the same colour.
export function Avatar({ name, small = false }) {
  const text = String(name || "").trim();
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  const initials = text.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return <span className={`ap_avatar${small ? " sm" : ""}`} style={{ background: AVATAR_COLORS[hash] }} aria-hidden="true">{initials}</span>;
}
