// Who is responsible for a lead's alert or task (SOW Deliverables B + D; the rule the user approved on 24 Nov 2026):
//   the lead has an owner        -> that owner
//   no owner                     -> the managers of the lead's department, and the account admin
//   overdue or escalated         -> the owner stays responsible; their manager and the account admin are alerted
// Roles: admin (super admin, the dealer account, agency, Rooftop Admin, read-all monitors), manager (Manage Leads),
// staff (only their assigned leads, the existing assignedOnlyScope). A manager with no department set covers all.
import User from '../models/User.js';
import { assignedOnlyScope } from './ai/assignedScope.js';
import { departmentMatch, leadDepartment } from './departmentNames.js';

const ESCALATED = new Set(['handoff', 'no_staff_response', 'person_requested']);
export const isEscalated = (row) => ESCALATED.has(row?.kind) || row?.still_no_reply === true;
export const isOverdue = (row, now = new Date()) => {
  const due = row?.due_at || row?.due_by;
  return Boolean(due) && new Date(due) < now;
};

/** Why this row is in this person's bell: 'mine' | 'unowned' | 'team', or null when it isn't theirs. Pure. */
export function responsibilityFor(scope, row, lead, now = new Date()) {
  if (!lead) return scope.role === 'admin' ? 'unowned' : null;
  const owner = lead.assigned_to ? String(lead.assigned_to) : null;
  if (owner && owner === scope.userId) return 'mine';
  if (scope.role === 'staff') return null;
  if (!owner) {
    if (scope.role === 'admin') return 'unowned';
    return !scope.departments.length || scope.departments.includes(leadDepartment(lead)) ? 'unowned' : null;
  }
  if (!isOverdue(row, now) && !isEscalated(row)) return null;
  return scope.role === 'admin' || scope.team.has(owner) ? 'team' : null;
}

/** The signed-in user's role, departments and (managers) team. */
export async function loadResponsibilityScope(user, dealerId) {
  const full = await User.findById(user._id).select('type parent_id departments role')
    .populate({ path: 'role', populate: { path: 'permissions' } }).lean();
  const userId = String(user._id);
  const base = { userId, departments: full?.departments || [], team: new Set() };
  if (!full?.parent_id || full.type !== 'dealer' || full.role?.name === 'Rooftop Admin') return { ...base, role: 'admin' };
  if (assignedOnlyScope(full)) return { ...base, role: 'staff' };
  const permissions = (full.role?.permissions || []).map((p) => p?.permission_name);
  if (!permissions.includes('Manage Leads')) return { ...base, role: 'admin' }; // read-all monitor
  const staff = await User.find({ parent_id: dealerId, type: 'dealer' }).select('departments').lean();
  const covers = (s) => !base.departments.length || !s.departments?.length
    || s.departments.some((d) => base.departments.includes(d));
  return { ...base, role: 'manager', team: new Set(staff.filter(covers).map((s) => String(s._id))) };
}

/** Mongo filter: leads this person should hear about when they arrive. */
export function newLeadFilter(scope) {
  const mine = { assigned_to: scope.userId };
  if (scope.role === 'staff') return mine;
  const unowned = { assigned_to: null };
  if (scope.role === 'admin' || !scope.departments.length) return { $or: [mine, unowned] };
  return { $or: [mine, ...scope.departments.map((d) => ({ ...unowned, ...departmentMatch(d) }))] };
}
