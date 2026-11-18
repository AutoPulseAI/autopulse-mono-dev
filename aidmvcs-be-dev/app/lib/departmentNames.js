// Department names and checks, safe for the browser (no models). The rest: app/lib/departments.js.
export const DEPARTMENTS = Object.freeze(['sales', 'service', 'parts']);
export const DEPARTMENT_NAMES = Object.freeze({ sales: 'Sales', service: 'Service', parts: 'Parts' });

/** A valid department key from what was sent, or null. */
export function validDepartment(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return DEPARTMENTS.includes(s) ? s : null;
}

/** A lead's department; missing = sales. */
export function leadDepartment(lead) {
  return validDepartment(lead?.department) || 'sales';
}

/** A clean list of departments for a staff member (unknown values dropped, no repeats). */
export function validDepartments(list) {
  const arr = Array.isArray(list) ? list : String(list ?? '').split(',');
  return [...new Set(arr.map(validDepartment).filter(Boolean))];
}

/** Mongo match for leads of one department, safe to spread into another query (sales also matches leads with no
 * department). null = every department. */
export function departmentMatch(dept) {
  const d = validDepartment(dept);
  if (!d) return null;
  return d === 'sales' ? { department: { $nin: ['service', 'parts'] } } : { department: d };
}

/**
 * May this person reply to a lead of this department? (13 Nov 2026 meeting, 6.2: Sales can read a Service
 * conversation on the customer's profile but answers it from the Service side.) Staff with no department set, the
 * dealership account and super admins can reply to any lead.
 */
export function canReplyInDepartment(user, lead) {
  const mine = Array.isArray(user?.departments) ? user.departments.map(validDepartment).filter(Boolean) : [];
  if (!mine.length || !user?.parent_id || user?.type === 'admin') return true;
  return mine.includes(leadDepartment(lead));
}
