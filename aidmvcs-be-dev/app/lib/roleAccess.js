// Who may change a role (security fix, Nov 2026; same rule as app/api/roles/[id] PUT): an admin role (or one with no
// owner) only the super admin; a dealer/agency role only its own account (its owner or staff, its agency, or a super
// admin). Permissions given to a role must be of the role's own kind (no admin permission on a dealer role).
// Returns { user } or { response } like apiGuard.
import Permission from "@models/Permission";
import { denied, requireActingFor, requireSuperAdmin } from "@lib/apiGuard";

export async function roleEditGuard(req, role) {
  if (role.entity === "admin" || !role.entity_id) return requireSuperAdmin(req);
  return requireActingFor(req, String(role.entity_id));
}

// null when every permission is of `entity`, else a 403 response.
export async function foreignPermissions(permissions, entity) {
  if (!Array.isArray(permissions) || !permissions.length) return null;
  const ids = [...new Set(permissions.map((p) => String(p?._id ?? p)))];
  const own = await Permission.countDocuments({ _id: { $in: ids }, entity });
  return own === ids.length ? null : denied(403, "Those permissions are not for this kind of role.");
}
