// Departments: Sales / Service / Parts on staff and on leads (Betsy, 14 Nov 2026 email: "please add departments to our
// users and our leads/opportunities"; BB: a lead sent in as sales can be converted to service by changing its
// department, not by closing it, and sales is not held accountable for it).
//   - a staff member can be in more than one department (User.departments); none set = not in any department list;
//   - a lead has one department (Lead.department); a lead without one is a sales lead (every lead before 17 Nov 2026);
//   - changing a lead's department emails that department's staff (one email each; nobody else is messaged).
// Imports are relative so the workers can use it.
import User from '../models/User.js';
import EmailAccount from '../models/EmailAccount.js';
import { sendEmail } from './email.js';

export { DEPARTMENTS, DEPARTMENT_NAMES, validDepartment, leadDepartment, validDepartments, departmentMatch } from './departmentNames.js';
import { DEPARTMENT_NAMES, validDepartment } from './departmentNames.js';

/**
 * Email the staff of a department that a lead is now theirs. Never throws; returns { status, sent: [emails] }.
 */
export async function notifyDepartment({ dealerId, lead, department, fromDepartment, byName }, {
  findStaff = (id, dept) => User.find({ parent_id: id, type: 'dealer', departments: dept }).select('name email').lean(),
  findDealer = (id) => User.findById(id).select('name dealer_account_information branding_information').lean(),
  findSender = (id) => EmailAccount.findOne({ dealer_id: String(id) }).select('email_address').lean(),
  email = sendEmail, logger = console, baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '',
} = {}) {
  try {
    const dept = validDepartment(department);
    if (!dept) return { status: 'skipped', reason: 'no department' };
    const [staff, dealer, sender] = await Promise.all([findStaff(String(dealerId), dept), findDealer(dealerId), findSender(dealerId)]);
    const to = [...new Set((staff || []).map((s) => s.email).filter(Boolean))];
    if (!to.length) return { status: 'skipped', reason: `nobody is in ${DEPARTMENT_NAMES[dept]}` };
    const name = lead?.name || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || lead?.phone || 'A customer';
    const subject = `New ${DEPARTMENT_NAMES[dept]} lead: ${name}`;
    const body = [
      `${byName || 'Someone'} moved this lead${fromDepartment ? ` from ${DEPARTMENT_NAMES[fromDepartment] || fromDepartment}` : ''} to ${DEPARTMENT_NAMES[dept]}.`,
      '',
      `Customer: ${name}`,
      lead?.phone ? `Phone: ${lead.phone}` : null,
      lead?.email ? `Email: ${lead.email}` : null,
      '',
      `Open the lead: ${baseUrl}/dealer/leads?lead=${lead?._id}`,
    ].filter((l) => l !== null).join('\n');
    const sent = [];
    for (const addr of to) {
      try { await email(addr, subject, body, sender?.email_address || null, null, dealer); sent.push(addr); }
      catch (error) { logger.error('[departments] email failed', { dealer_id: String(dealerId), error: error?.message }); }
    }
    return { status: sent.length ? 'sent' : 'failed', sent };
  } catch (error) {
    logger.error('[departments] notify failed', { dealer_id: String(dealerId), error: error?.message });
    return { status: 'failed', error: error?.message };
  }
}
