// Sales / Service on every message (13 Nov 2026 meeting, 6.1 and 6.3; one shared phone number and email for both).
//   - a message saved for a lead carries the lead's department at that moment (Email.department; a message without
//     one - older, or written outside the CRM - is its lead's department);
//   - a customer's message on a Service or Parts lead emails that department's staff (not Sales).
// Called from the Email model's save hooks; never throws. Imports are relative so the workers can use it.
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import EmailAccount from '../models/EmailAccount.js';
import { sendEmail } from './email.js';
import { DEPARTMENT_NAMES, leadDepartment } from './departmentNames.js';

const INBOUND = ['received', 'incoming'];

export async function departmentForLead(leadId, { LeadModel = Lead } = {}) {
  if (!leadId) return null;
  try {
    const lead = await LeadModel.findById(leadId).select('department').lean();
    return lead ? leadDepartment(lead) : null;
  } catch { return null; }
}

/** A customer wrote on a Service / Parts lead: tell that department's staff. */
export async function alertDepartmentOfReply(message, {
  LeadModel = Lead, findStaff = (dealerId, dept) => User.find({ parent_id: dealerId, type: 'dealer', departments: dept }).select('email').lean(),
  email = sendEmail, logger = console, baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '',
} = {}) {
  try {
    if (!INBOUND.includes(message?.status) || !message?.lead_id || message.is_note) return { status: 'skipped' };
    const lead = await LeadModel.findById(message.lead_id).select('department dealer_id name phone email').lean();
    const dept = lead ? leadDepartment(lead) : null;
    if (!dept || dept === 'sales') return { status: 'skipped', reason: 'sales lead' };
    const to = [...new Set((await findStaff(String(lead.dealer_id), dept)).map((u) => u.email).filter(Boolean))];
    if (!to.length) return { status: 'skipped', reason: `nobody is in ${DEPARTMENT_NAMES[dept]}` };
    const [dealer, sender] = await Promise.all([
      User.findById(lead.dealer_id).select('name dealer_account_information branding_information').lean(),
      EmailAccount.findOne({ dealer_id: String(lead.dealer_id) }).select('email_address').lean(),
    ]);
    const name = lead.name || lead.phone || lead.email || 'A customer';
    const text = String(message.mail_content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    const body = [`${name} wrote on a ${DEPARTMENT_NAMES[dept]} lead (${message.communication_type === 'email' ? 'email' : 'text'}):`,
      '', text || '(no text)', '', `Open the lead: ${baseUrl}/dealer/leads?lead=${lead._id}`].join('\n');
    for (const addr of to) {
      try { await email(addr, `${DEPARTMENT_NAMES[dept]} lead replied: ${name}`, body, sender?.email_address || null, null, dealer); }
      catch (error) { logger.error('[departments] reply alert failed', { error: error?.message }); }
    }
    return { status: 'sent', to };
  } catch (error) {
    logger.error('[departments] reply alert failed', { error: error?.message });
    return { status: 'failed' };
  }
}
