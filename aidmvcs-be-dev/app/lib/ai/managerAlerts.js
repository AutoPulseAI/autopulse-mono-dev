// Manager alerts (client, 8 Oct 2026 meeting: "AI alerts - ensure managers in the account receive SMS and email
// notification"). Before the AI, the platform emailed the dealer's general manager and texted the store when a lead
// needed managerial review (app/worker/processSms.js); AI-handled leads alerted nobody. Now every alert that needs a
// person - an escalation (the lead moved to Managerial Review, by staff or by the AI), a requested call nobody made,
// a customer writing while staff own the lead, a customer no longer interested - emails and texts the manager listed
// in Dealer Setup (general_manager_email / general_manager_phone, else the store's contact number).
//
// Never throws: an alert that can't be delivered is logged, and the alert itself (AI Alerts, the lead's note) stands.
// Imports are relative so the workers can use it.

import User from '../../models/User.js';
import Lead from '../../models/Lead.js';
import EmailAccount from '../../models/EmailAccount.js';
import { sendEmail } from '../email.js';
import { sendSMS } from '../sms.js';

// The AI's lead-note kinds that need a person now (agentic-upsell agent/call_tasks.py, events/handlers.py,
// agent/turn.py). Escalations arrive as the Managerial Review status instead (alertForStatus).
export const MANAGER_ALERT_NOTE_KINDS = Object.freeze({
  call_escalation: 'A call the customer asked for has not been made',
  after_handoff: 'The customer wrote while the lead is with the team',
  not_interested: 'The customer says they are no longer interested',
  // Client, 10 Oct 2026: every alert that needs a person reaches them by email and text, not only AI Alerts.
  call_requested: 'The customer asked for a call',
  service_request: 'A customer requested a service visit',
  sold_pending_escalation: 'A Sold Pending customer has a question for a person',
});

function leadName(lead) {
  return [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || lead?.name || lead?.phone || 'a customer';
}

export function alertText({ title, lead, detail, link }) {
  const sms = `AutoPulse alert: ${title} - ${leadName(lead)}${lead?.phone ? ` (${lead.phone})` : ''}. ${link}`;
  const email = [
    `${title}.`,
    '',
    `Customer: ${leadName(lead)}`,
    lead?.phone ? `Phone: ${lead.phone}` : null,
    lead?.email ? `Email: ${lead.email}` : null,
    detail ? `\n${detail}` : null,
    '',
    `Open the lead: ${link}`,
  ].filter((line) => line !== null).join('\n');
  return { sms: sms.slice(0, 320), email, subject: `AutoPulse alert: ${title} - ${leadName(lead)}` };
}

export async function notifyManagers({ dealerId, leadId, title, detail = '' }, {
  findDealer = (id) => User.findById(id).select('name dealer_account_information').lean(),
  findLead = (id) => Lead.findById(id).select('first_name last_name name phone email').lean(),
  findSender = (id) => EmailAccount.findOne({ dealer_id: String(id) }).select('email_address').lean(),
  email = sendEmail, sms = sendSMS, logger = console, baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '',
} = {}) {
  try {
    const [dealer, lead] = await Promise.all([findDealer(dealerId), findLead(leadId)]);
    if (!dealer) return { status: 'skipped', reason: 'dealer not found' };
    const info = dealer.dealer_account_information || {};
    const to = { email: info.general_manager_email || null, phone: info.general_manager_phone || info.store_contact_number || null };
    if (!to.email && !to.phone) {
      logger.warn('[ai] manager alert: no manager email or phone in Dealer Setup', { dealer_id: String(dealerId) });
      return { status: 'skipped', reason: 'no manager contact in Dealer Setup' };
    }
    const text = alertText({ title, lead, detail, link: `${baseUrl}/dealer/leads?lead=${leadId}` });
    const sent = {};
    if (to.email) {
      try {
        const sender = await findSender(dealerId);
        await email(to.email, text.subject, text.email, sender?.email_address || null, null, dealer);
        sent.email = to.email;
      } catch (error) {
        logger.error('[ai] manager alert email failed', { dealer_id: String(dealerId), error: error?.message });
      }
    }
    if (to.phone) {
      try {
        await sms(to.phone, text.sms, dealer);
        sent.sms = to.phone;
      } catch (error) {
        logger.error('[ai] manager alert SMS failed', { dealer_id: String(dealerId), error: error?.message });
      }
    }
    return { status: sent.email || sent.sms ? 'sent' : 'failed', sent };
  } catch (error) {
    logger.error('[ai] manager alert failed', { dealer_id: String(dealerId), error: error?.message });
    return { status: 'failed', error: error?.message };
  }
}

// A lead moved to Managerial Review (staff in the status screen, or the AI's own escalation).
export function alertForStatus(status) {
  return status === 'Managerial Review' ? 'A lead needs a manager (Managerial Review)' : null;
}
