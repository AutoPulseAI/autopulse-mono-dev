// Shared bits for the staff AI screens (app/dealer/ai/**) and the AI panel on a lead.
// Every call goes to our own /api/dealer-ai/* routes with the dealer's token, the
// same way the rest of the dealer portal calls its APIs.

export async function aiFetch(url, options = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("dealertoken") : null;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || data.message || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "in 3 hours", "2 days ago"
export function fromNow(iso) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  const abs = Math.abs(diff);
  const units = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
      return diff > 0 ? `in ${text}` : `${text} ago`;
    }
  }
  return diff > 0 ? "in a moment" : "just now";
}

// Badge colour per lifecycle stage (labels come from the AI service, in the client's words).
const STAGE_VARIANTS = {
  new_lead: "info",
  no_contact_made: "secondary",
  contact_made_no_next_action: "primary",
  contact_made_specific_followup: "primary",
  appointment_set: "success",
  appointment_no_show: "warning",
  sales_visit: "success",
  sold_pending: "success",
  sold_delivered: "success",
  opted_out: "danger",
  closed_lost: "dark",
};
export const stageVariant = (stage) => STAGE_VARIANTS[stage] || "secondary";

// The client's stage names (agentic-upsell agent/lifecycle.py STAGE_LABELS), for
// history entries, which carry only the stage id. The current stage's label always
// comes from the AI service itself.
const STAGE_LABELS = {
  new_lead: "New Lead",
  no_contact_made: "No Contact Made",
  contact_made_no_next_action: "Contact Made - No Next Action",
  contact_made_specific_followup: "Contact Made - Specific Follow-Up",
  appointment_set: "Appointment Set",
  appointment_no_show: "Appointment No Show",
  sales_visit: "Sales Visit",
  sold_pending: "Sold Pending",
  sold_delivered: "Sold - Delivered",
  opted_out: "Opted Out / Suppressed",
  closed_lost: "Closed - Lost",
};
export const stageLabel = (stage) => STAGE_LABELS[stage] || (stage ? stage.replace(/_/g, " ") : "");

export const AI_MODE_LABELS = {
  live: { label: "On", variant: "success", help: "The AI replies to customers and runs follow-ups." },
  shadow: {
    label: "Shadow",
    variant: "warning",
    help: "The AI drafts replies for review but never sends them. Your existing auto-replies still go out.",
  },
  off: { label: "Off", variant: "secondary", help: "The AI does nothing. Your existing auto-replies still go out." },
};

// What each kind of alert is called on the Alerts page. Unknown kinds still show,
// with their text, under "Other".
export const ALERT_KINDS = {
  handoff: { label: "Handed to staff", icon: "fa-hand", variant: "danger" },
  no_staff_response: { label: "No staff response", icon: "fa-triangle-exclamation", variant: "danger" },
  call_requested: { label: "Call requested", icon: "fa-phone", variant: "primary" },
  // PLAN_4 stream H: the customer asked for a person and chose a text over a call.
  text_requested: { label: "Wants a text from a person", icon: "fa-comment-sms", variant: "primary" },
  call_task: { label: "Call task open", icon: "fa-phone-arrow-up-right", variant: "primary" },
  do_not_call: { label: "Do not call", icon: "fa-phone-slash", variant: "danger" },
  service_request: { label: "Service request", icon: "fa-screwdriver-wrench", variant: "info" },
  bad_contact: { label: "Wrong number / bad contact", icon: "fa-address-card", variant: "warning" },
  wrong_number: { label: "Wrong number", icon: "fa-address-card", variant: "warning" },
  possible_opt_out: { label: "Possible opt-out", icon: "fa-ban", variant: "warning" },
  not_interested: { label: "Not interested", icon: "fa-thumbs-down", variant: "secondary" },
  visit_booked: { label: "Visit booked", icon: "fa-calendar-check", variant: "success" },
  visit_moved: { label: "Visit moved", icon: "fa-calendar-pen", variant: "info" },
  visit_cancelled: { label: "Visit cancelled", icon: "fa-calendar-xmark", variant: "warning" },
  after_hours_resume: { label: "After-hours lead picked up", icon: "fa-moon", variant: "info" },
  duplicate_lead: { label: "Duplicate lead", icon: "fa-clone", variant: "secondary" },
  reply_on_closed_lead: { label: "Reply on a closed lead", icon: "fa-envelope-open", variant: "warning" },
};
export const alertKind = (kind) =>
  ALERT_KINDS[kind] || { label: kind ? kind.replace(/_/g, " ") : "Other", icon: "fa-bell", variant: "secondary" };

export const CALL_OUTCOMES = [
  { value: "connected", label: "Spoke with the customer" },
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left a voicemail" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "other", label: "Other" },
];
export const callOutcomeLabel = (value) => CALL_OUTCOMES.find((o) => o.value === value)?.label || value || "";

export const CHANNEL_LABELS = { sms: "Text", email: "Email", voice: "Phone calls" };

// The lead in the Leads screen (opens its conversation when it's on the list's current page).
export const leadHref = (leadId) => `/dealer/leads?selectedLead=true&leadId=${leadId}`;
export const customerHref = (customerId) => `/dealer/customers/${customerId}`;

// tel: link for click-to-call ("+1 (555) 000-0001" -> "tel:+15550000001").
export function telHref(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}

// Fired after an alert is marked handled, so the sidebar count refreshes.
export const ALERTS_CHANGED_EVENT = "dealer-ai-alerts-changed";
