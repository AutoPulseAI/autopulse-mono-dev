// Who may do what in the Forms Library (SOW v6 Deliverable K): the dealership's own staff only (rooftop isolation);
// the library itself (upload, versions, mapping, who can use a form) by the dealer account and staff with "Manage
// Account Information"; filling a form by the roles the form allows (none picked = every role).
import mongoose from 'mongoose';
import { requireDealerAccess } from '../apiGuard.js';
import { hasPermission } from '../staffPermission.js';
import Role from '../../models/Role.js';

export const json = (body, status = 200) => Response.json(body, { status });
export const fail = (error, status) => json({ error }, status);

export async function formsAccess(req, dealerId) {
  if (!dealerId || !mongoose.isValidObjectId(String(dealerId))) return { response: fail('dealer_id is required', 400) };
  const access = await requireDealerAccess(req, String(dealerId));
  if (access.response) return access;
  return { user: access.user, dealerId: String(dealerId) };
}

export const canManageForms = (user) => hasPermission(user, 'Manage Account Information');
// Payoff and lienholder on a form: managers only, as on the Trade In tab.
export const canSeeFinance = (user) => hasPermission(user, 'Manage Leads');

const isOwnerOrAdmin = (user) => user?.type === 'admin' || (user?.type === 'dealer' && !user?.parent_id);

export function canUseTemplate(user, template) {
  if (isOwnerOrAdmin(user) || !template.role_ids?.length) return true;
  return template.role_ids.some((r) => String(r) === String(user?.role || ''));
}

export async function dealerRoles(dealerId) {
  return (await Role.find({ entity: 'dealer', entity_id: dealerId }).select('name').lean())
    .map((r) => ({ id: String(r._id), name: r.name }));
}

export const actorOf = (user) => ({ by: user?._id || null, by_name: user?.name || user?.email || null });

// One form as the library lists it.
export function templateSummary(t) {
  const v = (t.versions || []).find((x) => x.version === t.current_version) || {};
  return { id: String(t._id), name: t.name, category: t.category, active: t.active, departments: t.departments || [],
    role_ids: (t.role_ids || []).map(String), statuses: t.statuses || [], retention_days: t.retention_days ?? null,
    current_version: t.current_version, versions: (t.versions || []).length, fillable: Boolean(v.fillable),
    mapped: (v.mapping || []).length, required: (v.mapping || []).filter((m) => m.required).length,
    updated_at: t.updatedAt };
}
