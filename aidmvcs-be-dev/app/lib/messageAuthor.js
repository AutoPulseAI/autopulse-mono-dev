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
