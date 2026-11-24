"use client";
// The one icon list for the dealer portal (24 Nov 2026): a thing has one icon and one colour on every screen, so a phone
// on Leads looks like a phone on Customers, Actions and the Dashboard. Add or change an icon here, never on a page.
// Font Awesome Regular (outline), as in the side menu. An icon is neutral unless its colour says something; those
// colours come from meaningColors.js.
import { MEANING } from "./meaningColors";
const BLUE = "#0272b4", GREEN = "#2fb344", RED = "#e5383b", PURPLE = "#6f42c1", TEAL = "#0f8f83", AMBER = "#b7791f";
const N = MEANING.neutral;

export const ICONS = {
  // People
  lead: ["fa-user-plus", MEANING.lead], customer: ["fa-user", N], customers: ["fa-users", N], owner: ["fa-user-tie", N],
  noOwner: ["fa-user-slash", RED], staff: ["fa-user", N], ai: ["fa-robot", N], role: ["fa-id-badge", N],
  // Contact
  phone: ["fa-phone", N], email: ["fa-envelope", N], sms: ["fa-comment-sms", N], reply: ["fa-comments", MEANING.reply],
  sent: ["fa-paper-plane", N], contactMethods: ["fa-address-book", N],
  // Where and when
  source: ["fa-signs-post", N], sender: ["fa-at", N], department: ["fa-building", N], vehicle: ["fa-car-side", N],
  date: ["fa-calendar-day", N], time: ["fa-clock", N], age: ["fa-hourglass-half", N], history: ["fa-clock-rotate-left", N],
  // Work
  status: ["fa-circle-half-stroke", N], priority: ["fa-flag", N], task: ["fa-list-check", N], action: ["fa-triangle-exclamation", MEANING.action],
  stuck: ["fa-road-barrier", AMBER], team: ["fa-users", N], note: ["fa-note-sticky", N], done: ["fa-circle-check", GREEN],
  overdue: ["fa-clock", RED], missed: ["fa-circle-exclamation", RED], open: ["fa-circle-dot", AMBER], cancelled: ["fa-ban", N],
  outcome: ["fa-bullseye", N], type: ["fa-tag", N], info: ["fa-circle-info", N], escalated: ["fa-arrow-up", RED],
  // Sales journey (the Desk Log's colours and icons)
  appointment: ["fa-calendar-check", MEANING.appointment], appointments: ["fa-calendar-plus", MEANING.appointment],
  appointmentDay: ["fa-calendar-day", MEANING.appointment], showed: ["fa-calendar-check", MEANING.showed],
  noShow: ["fa-calendar-xmark", MEANING.appointment],
  sold: ["fa-handshake", MEANING.sold], chart: ["fa-chart-pie", N], trend: ["fa-chart-line", N], trophy: ["fa-trophy", N],
};

const STATUS_ICONS = {
  lead: "lead", contacted: "reply", "appointment booked": "appointment", "no show": "noShow", "lead not contacted": "lead",
  "contacted - no next action": "reply", "contacted - specific follow-up": "reply", visited: "showed", "managerial review": "action",
  sold: "sold", "sold pending": "sold", "sold delivered": "sold", unsold: "history", "closed - lost": "cancelled",
  "closed - no longer owns": "cancelled", dnd: "cancelled", "opted out": "cancelled",
};
// The icon for a lead status (the status's words stay exactly as they are).
export const statusIconName = (status) => STATUS_ICONS[String(status || "").trim().toLowerCase()] || "status";

export const iconColor = (name) => (ICONS[name] || ICONS.info)[1];
export const iconClass = (name) => `fa-regular ${(ICONS[name] || ICONS.info)[0]}`;

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
