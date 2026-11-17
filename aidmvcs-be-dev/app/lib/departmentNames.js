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

/** Mongo match for leads of one department (sales also matches leads with no department). */
export function departmentMatch(dept) {
  const d = validDepartment(dept);
  if (!d) return null;
  return d === 'sales'
    ? { $or: [{ department: 'sales' }, { department: null }, { department: { $exists: false } }, { department: '' }] }
    : { department: d };
}

