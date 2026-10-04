// Assigned-only staff in the AI screens (agentic-upsell MASTER_PLAN_4 stream R).
//
// The same rule as the leads list (app/api/leads/route.js): a staff user (parent_id set) with
// "View Assigned Leads" but not "Manage Leads" sees only the leads assigned to them. The Call Tasks and
// AI Alerts routes (app/api/dealer-ai/call-tasks, /alerts) filter the AI service's rows with this, server
// side, so such a user never receives another salesperson's task or alert.
// No framework imports: the CRM's node tests import it directly.

const MANAGE = "Manage Leads";
const VIEW_ASSIGNED = "View Assigned Leads";

// The user id to filter to, or null when the user sees everything. `user` has role.permissions populated.
export function assignedOnlyScope(user) {
  if (!user || !user.parent_id) return null;
  const permissions = (user.role?.permissions || []).map((p) => p?.permission_name).filter(Boolean);
  if (permissions.includes(MANAGE) || !permissions.includes(VIEW_ASSIGNED)) return null;
  return String(user._id);
}

// The rows ({lead_id, ...}) whose lead (from `leads`: [{_id, assigned_to}]) is assigned to `userId`.
export function filterRowsToAssigned(rows, leads, userId) {
  if (!userId) return rows;
  const mine = new Set(leads.filter((l) => l.assigned_to && String(l.assigned_to) === String(userId))
    .map((l) => String(l._id)));
  return rows.filter((row) => row && mine.has(String(row.lead_id)));
}
