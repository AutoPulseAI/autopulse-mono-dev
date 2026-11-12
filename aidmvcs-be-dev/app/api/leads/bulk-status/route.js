// POST /api/leads/bulk-status  change many leads' status at once (SOW Deliverable B b5, gap G-010: "permission-limited
// preview, confirmation, partial-failure results and audit").
//   body { dealer_id, lead_ids: [...], status, confirm: false | true, expected: { <lead id>: <status at preview> } }
//   confirm false (default) = PREVIEW: nothing is written; each lead with its current and new status.
//   confirm true            = each lead goes through the one status change every screen uses
//                             (PUT /api/conversations/lead/status): the same checks, AI notice, cancelled follow-ups,
//                             timeline entry and "Status changed ... by" note. One lead failing never stops the others;
//                             a lead whose status changed since the preview is left alone.
// Only statuses that need nothing more and send the customer nothing can be set in bulk (BULK_STATUSES). Appointment
// Booked (date and time), Visited (the outcome), No Show and the Sold statuses (customer messages) stay one at a time.
// Errors: 401 not signed in · 403 not this dealership's staff, or no "Manage Leads" permission · 400 bad request.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { statusChangeError } from '@lib/ai/aiDnd';
import { PUT as changeStatus } from '../../conversations/lead/status/route.js';

export const runtime = 'nodejs';
const MAX = 200;
const BULK_STATUSES = Object.freeze(['Lead Not Contacted', 'Contacted - No Next Action', 'DND', 'Closed - Lost']);
const fail = (error, status) => Response.json({ error }, { status });

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await hasPermission(access.user, 'Manage Leads'))) return fail('You do not have permission to change lead statuses', 403);

  const status = String(body.status || '');
  if (!BULK_STATUSES.includes(status)) {
    return fail(`In bulk, the status can only be: ${BULK_STATUSES.join(', ')}. Others are set one lead at a time.`, 400);
  }
  const ids = [...new Set((Array.isArray(body.lead_ids) ? body.lead_ids : []).map(String))];
  if (!ids.length) return fail('Pick at least one lead', 400);
  if (ids.length > MAX) return fail(`At most ${MAX} leads at a time`, 400);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) return fail('Some lead ids are not valid', 400);

  const leads = await Lead.find({ _id: { $in: ids } }).select('_id name dealer_id fe_lead_status').lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const rows = ids.map((id) => {
    const l = byId.get(id);
    if (!l || String(l.dealer_id) !== dealerId) return { lead_id: id, name: null, error: 'Not a lead of this dealership' };
    const current = l.fe_lead_status || null;
    const refused = statusChangeError(current, status);
    if (refused) return { lead_id: id, name: l.name || null, current, error: refused };
    return { lead_id: id, name: l.name || null, current, will_be: status, change: current !== status };
  });
  const summary = { leads: rows.length, will_change: rows.filter((r) => r.change).length,
    already: rows.filter((r) => r.change === false).length, errors: rows.filter((r) => r.error).length };
  if (body.confirm !== true) return Response.json({ preview: true, summary, rows });

  const expected = body.expected && typeof body.expected === 'object' ? body.expected : {};
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const h of ['authorization', 'cookie']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  const results = { updated: [], unchanged: [], failed: [] };
  for (const r of rows) {
    if (r.error) { results.failed.push({ lead_id: r.lead_id, name: r.name, reason: r.error }); continue; }
    if (!r.change) { results.unchanged.push(r.lead_id); continue; }
    if (r.lead_id in expected && (expected[r.lead_id] ?? null) !== r.current) {
      results.failed.push({ lead_id: r.lead_id, name: r.name, reason: 'Changed by someone else meanwhile - not touched' });
      continue;
    }
    try {
      const res = await changeStatus(new Request(req.url, { method: 'PUT', headers,
        body: JSON.stringify({ id: r.lead_id, status }) }));
      if (res.ok) results.updated.push(r.lead_id);
      else {
        const data = await res.json().catch(() => ({}));
        results.failed.push({ lead_id: r.lead_id, name: r.name, reason: data.error || data.message || `Refused (${res.status})` });
      }
    } catch (error) {
      results.failed.push({ lead_id: r.lead_id, name: r.name, reason: 'Could not be saved' });
      console.error('[bulk-status] lead failed', { lead_id: r.lead_id, error: error?.message });
    }
  }
  return Response.json({ preview: false, updated: results.updated.length, unchanged: results.unchanged.length,
    failed: results.failed });
}
