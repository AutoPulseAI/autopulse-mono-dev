// Who sent each message, shown on every message in the conversation (Betsy, 27 Oct 2026: "the AI lying about results"
// - the staff's bookings and Sold looked like the AI's work). A message with no staff user used to fall back to the
// AI's name: the old system's automatic check-ins and follow-ups (188 in four days) showed as the AI. Now each message
// says plainly: the customer, the AI, a named staff member, staff on the dealer account, or an automatic message.

const idOf = (v) => String((v && typeof v === "object" ? v._id : v) || "");

export function messageAuthor(email, lead, botName) {
  const ai = botName || "AI";
  if (["incoming", "received"].includes(email?.status)) {
    return { kind: "customer", label: `Customer: ${lead?.name || lead?.email || lead?.phone || "Unknown"}` };
  }
  if (email?.ai_generated) return { kind: "ai", label: `Sent by AI (${ai})` };
  const by = email?.message_by;
  const name = by && typeof by === "object" ? by.name : null;
  if (idOf(by) && idOf(by) === idOf(lead?.dealer_id)) {
    return { kind: "staff", label: `Sent by staff (dealer account${name ? `: ${name}` : ""})` };
  }
  if (name) return { kind: "staff", label: `Sent by staff: ${name}` };
  if (idOf(by)) return { kind: "staff", label: "Sent by staff" };
  return { kind: "system", label: "Automatic message (not the AI)" };
}

export function noteAuthor(email, isAi) {
  if (email?.ai_generated || isAi) return "Note by the AI";
  const name = email?.message_by && typeof email.message_by === "object" ? email.message_by.name : null;
  return `Note by staff${name || email?.sender && email.sender !== "Staff" ? `: ${name || email.sender}` : ""}`;
}

export const AUTHOR_BADGE = { customer: "bg-success", ai: "bg-primary", staff: "bg-warning text-dark", system: "bg-secondary" };

// Betsy, 27 Oct 2026: "a dealer can put in appt set and we send the confirmation, but it does not show that in the
// conversation". The status change was a grey "Note for Internal Use Only" and the text it caused read "Sent by AI".
// A status change / appointment move now has its own heading, and the AI's appointment texts that follow a staff
// booking say who set it.
const STATUS_NOTE = /^(?:Status changed from|Set to .+ by |Appointment moved by )/;
const STAFF_BOOKED = /^Status changed from .+ to Appointment (?:Set|Booked) by (.+?)\s*$/;
const APPOINTMENT_TEXT = /we are all set to meet|confirming our meeting|looking forward to meeting with you/i;
const LINK_WINDOW_MS = 6 * 3600e3;

export function isStatusNote(email) {
  return Boolean((email?.is_note || email?.status === "note") && STATUS_NOTE.test(String(email?.mail_content || "").trim()));
}

// {message id: staff name} for each AI appointment text sent within 6 hours after staff set the appointment.
export function staffBookedTexts(emails) {
  const out = {};
  let last = null;
  const sorted = [...(emails || [])].sort((a, b) => new Date(a.timestamp || a.date) - new Date(b.timestamp || b.date));
  for (const e of sorted) {
    const at = new Date(e.timestamp || e.date).getTime();
    const m = (e.is_note || e.status === "note") && String(e.mail_content || "").trim().match(STAFF_BOOKED);
    if (m) { last = { name: m[1], at }; continue; }
    if (last && e.ai_generated && !e.is_note && at - last.at <= LINK_WINDOW_MS && APPOINTMENT_TEXT.test(String(e.mail_content || ""))) {
      out[String(e._id)] = last.name;
    }
  }
  return out;
}
