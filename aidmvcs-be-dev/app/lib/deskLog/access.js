// Who may use the Desk Log while it is rolled out: the dealer's own access rule (app/lib/apiGuard.js) and the
// 'desk_log' feature level (app/lib/reporting/featureFlags.js - 'admin' = super admin, also through "login as").
import dbConnect from '../mongodb.js';
import { requireDealerAccess } from '../apiGuard.js';
import { isFeatureVisible } from '../reporting/featureFlags.js';
import { isSuperAdmin } from '../reporting/reportAccess.js';

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** { response } to return as is, or { user } when this caller may use this dealer's Desk Log. */
export async function deskLogAccess(req, dealerId) {
  await dbConnect();
  const guard = await requireDealerAccess(req, dealerId);
  if (guard.response) return { response: guard.response };
  const caller = { user: guard.user, superAdmin: await isSuperAdmin(req, guard.user), dealerId: String(dealerId) };
  if (!isFeatureVisible('desk_log', caller)) return { response: json({ message: 'Not found' }, 404) };
  return { user: guard.user };
}
