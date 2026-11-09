import { requireActingFor, requireSuperAdmin, requireUser } from "@lib/apiGuard";

// Who may see a support ticket and its messages (security fix, Nov 2026): the super admin and the ticket's own
// people (its creator or assignee, or their dealership/agency). Returns { user } or { response } like apiGuard.
export async function ticketAccess(req, ticket) {
  const signedIn = await requireUser(req);
  if (signedIn.response) return signedIn;
  const admin = await requireSuperAdmin(req);
  if (admin.user) return admin;
  for (const owner of [ticket.createdBy, ticket.assignedTo]) {
    const ownerId = owner?._id || owner;
    if (!ownerId) continue;
    const guard = await requireActingFor(req, String(ownerId));
    if (guard.user) return guard;
  }
  return { response: new Response(JSON.stringify({ success: false, message: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }) };
}
