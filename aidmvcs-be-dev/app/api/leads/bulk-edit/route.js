// POST /api/leads/bulk-edit  the other bulk actions on the Leads list (SOW Deliverable B b5; the user, 24 Nov 2026):
//   body { dealer_id, lead_ids (at most 100), action, batch_id?, confirm: true, ...action fields }
//     action 'department'  { value: 'sales' | 'service' | 'parts' }
//     action 'lead_source' { value }            one of the dealer's lead sources (empty = none)
//     action 'campaign'    { value }            one of the dealer's campaigns (empty = none)
//     action 'note'        { note, internal }   a note on each lead's conversation (internal = staff only, as the note box)
//     action 'task'        { note, due_at, assigned_to? | assign: 'owner' }   a reminder for staff on each lead (Open tasks
//                          on the profile); 'owner' = each lead's owner, or the person doing it when the lead has none
// Each lead goes through the route one lead uses - PATCH /api/leads/[id]/details, POST /api/conversations/notes,
// POST /api/leads/[id]/opportunity - so it gets the same checks, history and timeline. One lead failing never stops
// the others. A department move sends one summary email to that department per call (not one per lead).
// Every call is one part of the batch's Bulk history row (app/models/BulkChange.js).
// Errors: 401 · 403 not this dealership's staff, or no "Manage Leads" permission · 400 bad request.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Lead from '@models/Lead';
import LeadReminder from '@models/LeadReminder';
import { requireDealerAccess } from '@lib/apiGuard';
import { hasPermission } from '@lib/staffPermission';
import { recordBulkCall, validBatchId } from '@lib/bulkChanges';
import { validDepartment, DEPARTMENT_NAMES, notifyDepartmentBulk } from '@lib/departments';
import { PATCH as editDetails } from '../[id]/details/route.js';
import { POST as addNote } from '../../conversations/notes/route.js';
import { POST as opportunityAction } from '../[id]/opportunity/route.js';

export const runtime = 'nodejs';
const MAX = 100;
const ACTIONS = Object.freeze(['department', 'lead_source', 'campaign', 'note', 'task']);
const FIELDS = Object.freeze({ department: 'department', lead_source: 'lead_source', campaign: 'campaign' });
const fail = (error, status) => Response.json({ error }, { status });
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function POST(req) {
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return fail('The request body must be JSON', 400); }
  const dealerId = String(body?.dealer_id || '');
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return access.response;
  if (!(await hasPermission(access.user, 'Manage Leads'))) return fail('You do not have permission to change leads', 403);

  const action = String(body.action || '');
  if (!ACTIONS.includes(action)) return fail(`Unknown bulk action: ${action}`, 400);
  const ids = [...new Set((Array.isArray(body.lead_ids) ? body.lead_ids : []).map(String))];
  if (!ids.length) return fail('Pick at least one lead', 400);
  if (ids.length > MAX) return fail(`At most ${MAX} leads a call`, 400);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) return fail('Some lead ids are not valid', 400);

  const value = action === 'department' ? validDepartment(body.value) : clean(body.value, 80);
  if (action === 'department' && !value) return fail('Pick Sales, Service or Parts', 400);
  const note = clean(body.note, 2000);
  if ((action === 'note' || action === 'task') && !note) return fail(action === 'task' ? 'Say what the task is for' : 'Write the note', 400);
  const due = action === 'task' ? new Date(body.due_at) : null;
  if (action === 'task' && Number.isNaN(due.getTime())) return fail('Pick when the task is due', 400);

  const leads = await Lead.find({ _id: { $in: ids } }).select('_id name dealer_id department lead_source campaign assigned_to').lean();
  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const h of ['authorization', 'cookie']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  const call = async (handler, url, method, payload, params) => {
    const res = await handler(new Request(new URL(url, req.url), { method, headers, body: JSON.stringify(payload) }),
      params ? { params: Promise.resolve(params) } : undefined);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data, status: res.status };
  };

  const results = { updated: [], unchanged: [], failed: [] };
  const history = [];
  const moved = [];
  for (const id of ids) {
    const l = byId.get(id);
    const name = l?.name || null;
    const before = FIELDS[action] ? (l?.[FIELDS[action]] ?? null) : null;
    let ref = null; // note / task: what was added
    const done = (result, reason = null) => {
      history.push({ lead_id: id, name, result, reason, from_label: before == null ? null : String(before), ref_id: ref });
      if (result === 'updated') results.updated.push(id);
      else if (result === 'unchanged') results.unchanged.push(id);
      else results.failed.push({ lead_id: id, name, reason });
    };
    if (!l || String(l.dealer_id) !== dealerId) { done('failed', 'Not a lead of this dealership'); continue; }
    try {
      let r;
      if (FIELDS[action]) {
        r = await call(editDetails, `/api/leads/${id}/details`, 'PATCH',
          { changes: { [FIELDS[action]]: { from: before, to: value || '' } }, skip_notify: true }, { id });
        if (r.ok && !(r.data.changed || []).length) { done('unchanged'); continue; }
        if (r.ok && action === 'department') moved.push({ _id: id, name });
      } else if (action === 'note') {
        r = await call(addNote, '/api/conversations/notes', 'POST', { lead_id: id, dealer_id: dealerId, content: note,
          internal_use: body.internal !== false });
        if (r.ok && r.data?.note?._id && mongoose.isValidObjectId(String(r.data.note._id))) ref = r.data.note._id;
      } else {
        const who = body.assign === 'owner' ? (l.assigned_to || access.user._id) : (body.assigned_to || undefined);
        r = await call(opportunityAction, `/api/leads/${id}/opportunity`, 'POST', { action: 'reminder', due_at: due.toISOString(),
          note, assigned_to: who ? String(who) : undefined }, { id });
        if (r.ok) {
          const made = await LeadReminder.findOne({ lead_id: id, note, created_by: access.user._id, done_at: null })
            .sort({ createdAt: -1 }).select('_id').lean();
          ref = made?._id || null;
        }
      }
      if (r.ok) done('updated');
      else done('failed', r.data.error || r.data.message || `Refused (${r.status})`);
    } catch (error) {
      done('failed', 'Could not be saved');
      console.error('[bulk-edit] lead failed', { action, lead_id: id, error: error?.message });
    }
  }
  if (moved.length) await notifyDepartmentBulk({ dealerId, department: value, leads: moved, byName: access.user.name });
  const label = action === 'department' ? DEPARTMENT_NAMES[value] : action === 'note' || action === 'task' ? note.slice(0, 80) : (value || 'None');
  await recordBulkCall({ dealerId, batchId: validBatchId(body.batch_id), action, toLabel: label,
    toValue: FIELDS[action] ? (value || null) : null, user: access.user, items: history });
  return Response.json({ preview: false, updated: results.updated.length, unchanged: results.unchanged.length,
    failed: results.failed });
}
