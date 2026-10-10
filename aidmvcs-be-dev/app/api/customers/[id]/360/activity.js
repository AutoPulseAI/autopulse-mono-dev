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
  contact_made_specific_followup: "Contact Made - Specific Follow-Up", appointment_set: "Appointment Set",
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
  return { type: "activity", kind: inbound ? "message_in" : "message_out", actor, at: m.timestamp || m.date,
    lead_id: m.lead_id, text: `${verb}: ${subject}${short(m.mail_content)}` };
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
    : a.action === "ai_turned_off" ? "turned the AI off for this lead" : a.action === "ai_turned_on" ? "turned the AI back on for this lead"
    : a.action.replace(/_/g, " ");
  return { type: "activity", kind: a.action, actor: a.actor_type, at: a.at, lead_id: a.lead_id,
    text: `${who} ${what}${a.detail ? ` (${short(a.detail, 100)})` : ""}` };
}

export async function buildActivity({ dealerId, customerId, leadIds }, { db = mongoose.connection.db, ActivityLog } = {}) {
  const ids = leadIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const strIds = leadIds.map(String);
  const [staff, messages, states, consents] = await Promise.all([
    ActivityLog.find({ dealer_id: String(dealerId), $or: [{ customer_id: customerId }, { lead_id: { $in: ids } }] })
      .sort({ at: -1 }).limit(MAX).lean(),
    ids.length ? db.collection("emails").find({ lead_id: { $in: ids } })
      .project({ mail_content: 1, subject: 1, status: 1, communication_type: 1, ai_generated: 1, message_by: 1,
        is_note: 1, timestamp: 1, date: 1, lead_id: 1 })
      .sort({ timestamp: -1, _id: -1 }).limit(MAX).toArray() : [],
    strIds.length ? db.collection("ai_lead_state").find({ lead_id: { $in: strIds } }).project({ lead_id: 1, stage_history: 1 }).toArray() : [],
    db.collection("ai_consent").find({ customer_id: String(customerId), consent_type: "opt_out" }).sort({ recorded_at: -1 }).limit(50).toArray(),
  ]);
  const entries = [
    ...staff.map(staffEntry),
    ...messages.filter((m) => !isRawLeadFile(m.mail_content)).map(messageEntry),
    ...states.flatMap(stageEntries),
    ...consents.map(consentEntry),
  ].filter((e) => e.at);
  return entries.map((e) => ({ ...e, at: new Date(e.at) })).sort((a, b) => b.at - a.at).slice(0, MAX);
}
