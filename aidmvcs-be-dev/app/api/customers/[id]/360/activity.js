// The customer timeline's "who did what" entries (client, 10 Oct 2026: "if a user manually does something it needs
// to be logged on the timeline; all AI actions need to be logged in the timeline"). Each action is read from the
// one place it is already recorded, so nothing is stored twice:
//   staff        status changes, AI on/off for a lead       ActivityLog (app/lib/activityLog.js)
//   messages     texts and emails, in and out, and notes    the lead conversation (Email)
//   AI           the lead's stage as the AI moves it        ai_lead_state.stage_history (agentic-upsell)
//   customer     opt-outs and opt-ins (STOP / START)        ai_consent (agentic-upsell)
// Lead creation, sales, service, appointments and assignments stay in the existing overview feed (assemble.js).
import mongoose from "mongoose";

const MAX = 200;
const INBOUND = ["received", "incoming"];
// Stage changes staff made are already in ActivityLog (status_changed); the AI's own record of them isn't repeated.
const STAFF_SOURCES = new Set(["staff_status", "manager_outcome"]);
const STAGE_LABELS = {
  new_lead: "New Lead", no_contact_made: "No Contact Made", contact_made_no_next_action: "Contact Made - No Next Action",
  contact_made_specific_followup: "Contact Made - Follow Up Assigned", appointment_set: "Appointment Set",
  appointment_no_show: "Appointment No Show", sales_visit: "Sales Visit", opted_out: "Opted Out",
  closed_lost: "Closed Lost", sold_pending: "Sold Pending", sold_delivered: "Sold - Delivered",
  closed_no_longer_owns: "Closed - No Longer Owns",
};
const short = (text, n = 140) => {
  const clean = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};
const isRawLeadFile = (text) => typeof text === "string" && /<\?adf|<adf[\s>]/i.test(text);

export function messageEntry(m) {
  const inbound = INBOUND.includes(m.status);
  const channel = m.communication_type === "email" ? "Email" : "Text";
  if (m.is_note) {
    return { type: "activity", kind: "note", actor: m.ai_generated ? "ai" : "staff", at: m.timestamp || m.date,
      lead_id: m.lead_id, text: `Note: ${short(m.mail_content)}` };
  }
  const actor = inbound ? "customer" : m.ai_generated ? "ai" : m.message_by ? "staff" : "system";
  const verb = inbound ? `${channel} from the customer` : `${channel} sent${m.status && !["sent", "delivered"].includes(m.status) ? ` (${m.status})` : ""}`;
  const subject = m.communication_type === "email" && m.subject ? `${m.subject} — ` : "";
  const text = `${verb}: ${subject}${short(m.mail_content)}`;
  const full = `${verb}: ${subject}${short(m.mail_content, 4000)}`;
  // G-026: the whole message is one click away ("more") when the line is cut short.
  return { type: "activity", kind: inbound ? "message_in" : "message_out", actor, at: m.timestamp || m.date,
    lead_id: m.lead_id, text, ...(full !== text ? { full } : {}) };
}

export function stageEntries(state) {
  return (state?.stage_history || [])
    .filter((h) => h?.to && !STAFF_SOURCES.has(h.source))
    .map((h) => ({ type: "activity", kind: "ai_stage", actor: "ai", at: h.at, lead_id: state.lead_id,
      text: `AI moved the lead to ${STAGE_LABELS[h.to] || h.to}${h.reason ? ` — ${short(h.reason, 100)}` : ""}` }));
}

export function consentEntry(c) {
  const on = c.consent_status === "opted_in";
  return { type: "activity", kind: on ? "opt_in" : "opt_out", actor: String(c.consent_source || "").startsWith("customer") ? "customer" : "staff",
    at: c.recorded_at || c.consent_timestamp, lead_id: c.lead_id || null,
    text: `${on ? "Opted back in to" : "Opted out of"} ${c.channel === "sms" ? "texts" : c.channel === "email" ? "emails" : c.channel}` };
}

export function staffEntry(a) {
  const who = a.actor_name || (a.actor_type === "staff" ? "Staff" : a.actor_type);
  const what = a.action === "status_changed" ? `changed the status${a.from ? ` from ${a.from}` : ""} to ${a.to}`
    : a.action === "ai_turned_off" ? "turned the AI off for this lead" : a.action === "ai_turned_on" ? "turned the AI back on for this lead" : a.action === "ai_turn_on_blocked" ? "tried to turn the AI back on (blocked: the customer opted out)"
    : a.action === "email_added_by_ai" || a.action === "phone_added_by_ai"
      ? `added the ${a.action.split("_")[0]} ${a.to}${a.detail ? ` (${a.detail})` : ""}`
    : a.action === "customer_merged" ? `merged the customer ${a.from || ""} into this one${a.detail ? ` (${a.detail})` : ""}`
    : a.action === "customer_merge_undone" ? `undid the merge of ${a.to || "a customer"} into this one`
    : a.action === "customer_merged_away" ? `merged this customer into ${a.to || "another customer"}`
    : a.action === "not_duplicate" ? "marked this customer as a different person from a possible duplicate"
    : a.action === "lead_reassigned"
      ? (a.to ? `reassigned the lead${a.from ? ` from ${a.from}` : ""} to ${a.to}` : `unassigned the lead${a.from ? ` from ${a.from}` : ""}`)
    : a.action === "name_updated_by_ai" ? `updated the name${a.from ? ` from ${a.from}` : ""} to ${a.to}${a.detail ? ` (${a.detail})` : ""}`
    : a.action.replace(/_/g, " ");
  return { type: "activity", kind: a.action, actor: a.actor_type, at: a.at, lead_id: a.lead_id,
    text: `${who} ${what}${a.detail ? ` (${short(a.detail, 100)})` : ""}` };
}

// Sales appointments on the timeline (SOW D, G-026): each booking's own history (booked, moved, status changes,
// cancelled, showed / no-show; bookingService.js), or "booked" alone for a booking from before the history existed.
const APPT_WHO = { ai: "ai", staff: "staff", customer: "customer", system: "system" };
const slotText = (v) => (v && (v.date || v.time) ? `${v.date || ""} ${v.time || ""}`.trim() : "");
export function bookingEntries(b) {
  const kind = b.appointment_type === "service" ? "service" : "sales";
  const base = { type: "activity", lead_id: b.lead_id };
  const history = Array.isArray(b.history) ? b.history : [];
  if (!history.length) {
    return [{ ...base, kind: "appointment_created", actor: APPT_WHO[b.created_by] || "system", at: b.createdAt,
      text: `Appointment booked (${kind})${b.bookingTime ? ` for ${b.bookingTime}` : ""}` }];
  }
  return history.filter((h) => h?.at).map((h) => {
    const who = h.actor_name ? `${h.actor_name}: ` : "";
    const text = h.action === "created" ? `Appointment booked (${kind})${slotText(h.to) ? ` for ${slotText(h.to)}` : ""}`
      : h.action === "rescheduled" ? `Appointment moved${slotText(h.from) ? ` from ${slotText(h.from)}` : ""}${slotText(h.to) ? ` to ${slotText(h.to)}` : ""}`
      : h.action === "cancelled" ? "Appointment cancelled"
      : h.action === "showed" ? "Customer showed for the appointment"
      : h.action === "no_show" ? "Customer didn't show for the appointment"
      : h.action === "status_changed" ? `Appointment ${h.to?.booking_status || "updated"}`
      : `Appointment ${String(h.action || "updated").replace(/_/g, " ")}`;
    return { ...base, kind: `appointment_${h.action}`, actor: APPT_WHO[h.actor_type] || "system", at: h.at, text: `${who}${text}` };
  });
}

export async function buildActivity({ dealerId, customerId, customerIds = null, leadIds }, { db = mongoose.connection.db, ActivityLog } = {}) {
  const ids = leadIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const strIds = leadIds.map(String);
  const [staff, messages, states, consents, bookings] = await Promise.all([
    ActivityLog.find({ dealer_id: String(dealerId), $or: [{ customer_id: { $in: customerIds || [customerId] } }, { lead_id: { $in: ids } }] })
      .sort({ at: -1 }).limit(MAX).lean(),
    ids.length ? db.collection("emails").find({ lead_id: { $in: ids } })
      .project({ mail_content: 1, subject: 1, status: 1, communication_type: 1, ai_generated: 1, message_by: 1,
        is_note: 1, timestamp: 1, date: 1, lead_id: 1 })
      .sort({ timestamp: -1, _id: -1 }).limit(MAX).toArray() : [],
    strIds.length ? db.collection("ai_lead_state").find({ lead_id: { $in: strIds } }).project({ lead_id: 1, stage_history: 1 }).toArray() : [],
    db.collection("ai_consent").find({ customer_id: { $in: (customerIds || [customerId]).map(String) }, consent_type: "opt_out" }).sort({ recorded_at: -1 }).limit(50).toArray(),
    strIds.length ? db.collection("bookings").find({ lead_id: { $in: strIds } })
      .project({ lead_id: 1, history: 1, createdAt: 1, created_by: 1, bookingTime: 1, appointment_type: 1 }).limit(MAX).toArray() : [],
  ]);
  const entries = [
    ...staff.map(staffEntry),
    ...messages.filter((m) => !isRawLeadFile(m.mail_content)).map(messageEntry),
    ...states.flatMap(stageEntries),
    ...consents.map(consentEntry),
    ...bookings.flatMap(bookingEntries),
  ].filter((e) => e.at);
  return entries.map((e) => ({ ...e, at: new Date(e.at) })).sort((a, b) => b.at - a.at).slice(0, MAX);
}
