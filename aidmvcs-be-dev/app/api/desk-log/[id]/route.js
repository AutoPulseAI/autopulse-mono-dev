// One Desk Log visit.
//   GET   -> { entry, history, notes }
//   PATCH { stage?, outcome?, unsold_reason?, next_step_at?, salesperson_id?, sales_manager_id?, bdc_agent_id?,
//          stock_number?, department?, vehicle?, trade?, note?, checklist_item?: { index, done }, if_updated_at? }
//   if_updated_at: the visit as the screen last read it - a change made on an out-of-date copy is refused (409) so
//   two people never overwrite each other (SOW Global UX 4B).
// An outcome change also applies the dealer's follow-up rules (lib/deskLog/rules.js, Deliverable J): who follows up
// (staff only / nobody turn the AI off for the lead), the owner's next step, managers alerted, the report group, and
// the Sold Pending delivery checklist.
// An outcome change first changes the lead's status through the existing status route (PUT
// /api/conversations/lead/status, with the caller's own sign-in), so the same follow-ups, booking updates and AI
// notice run as from the Leads page (Betsy: "no new workflow engine"). If that is refused, nothing is saved.
import mongoose from 'mongoose';
import DeskLogEntry from '@models/DeskLogEntry';
import { deskLogAccess, json } from '@lib/deskLog/access';
import { leadStatusForOutcome, planChanges } from '@lib/deskLog/deskLog';
import { deskLogDetail } from '@lib/deskLog/list';
import { outcomeKey, rulesFor } from '@lib/deskLog/rules';
import { pauseAiForLead } from '@lib/ai/aiStaff';
import { notifyManagers } from '@lib/ai/managerAlerts';
import dbConnect from '@lib/mongodb';
import { PUT as changeLeadStatus } from '../../conversations/lead/status/route.js';

async function load(req, params) {
  const { id } = await params;
  if (!mongoose.isValidObjectId(String(id))) return { response: json({ message: 'Not found' }, 404) };
  await dbConnect();
  const entry = await DeskLogEntry.findById(id).lean();
  if (!entry) return { response: json({ message: 'Not found' }, 404) };
  const access = await deskLogAccess(req, entry.dealer_id);
  if (access.response) return { response: access.response.status === 403 ? json({ message: 'Not found' }, 404)
    : access.response };
  return { entry, user: access.user };
}

export async function GET(req, { params }) {
  const found = await load(req, params);
  if (found.response) return found.response;
  return json({ entry: { ...found.entry, id: String(found.entry._id) }, ...(await deskLogDetail(found.entry)) });
}

/** The lead status change, through the existing route with this request's sign-in. */
async function setLeadStatus(req, leadId, change) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const h of ['authorization', 'cookie']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  const res = await changeLeadStatus(new Request(new URL('/api/conversations/lead/status', req.url), {
    method: 'PUT', headers, body: JSON.stringify({ id: String(leadId), ...change }) }));
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, message: data.error || data.message || 'The lead status could not be changed' };
}

export async function PATCH(req, { params }) {
  const found = await load(req, params);
  if (found.response) return found.response;
  let body;
  try { body = await req.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
  const { entry, user } = found;
  const now = new Date();
  if (body?.if_updated_at && entry.updatedAt
    && new Date(body.if_updated_at).getTime() !== new Date(entry.updatedAt).getTime()) {
    return json({ message: 'Someone else changed this visit just now. It has been reloaded - make your change again.',
      conflict: true }, 409);
  }
  const by = user?._id || null;
  const byName = user?.name || user?.email || null;
  // A delivery checklist item ticked / unticked.
  if (body?.checklist_item && Number.isInteger(body.checklist_item.index)) {
    const i = body.checklist_item.index;
    if (!entry.checklist?.[i]) return json({ message: 'No such checklist item' }, 400);
    const done = Boolean(body.checklist_item.done);
    await DeskLogEntry.updateOne({ _id: entry._id }, { $set: { [`checklist.${i}.done`]: done,
      [`checklist.${i}.at`]: now, [`checklist.${i}.by_name`]: byName },
    $push: { history: { field: `checklist: ${entry.checklist[i].item}`, from: !done, to: done, at: now, by, by_name: byName } } });
    return json({ entry: { id: String(entry._id) }, changed: true });
  }
  const plan = planChanges(entry, body || {}, { now });
  if (plan.errors) return json({ message: plan.errors.join('; '), errors: plan.errors }, 400);
  if (!Object.keys(plan.set).length && !plan.note) return json({ entry: { id: String(entry._id) }, changed: false });

  let applied = null;
  if (plan.outcomeChanged) {
    const before = leadStatusForOutcome(entry.outcome, entry.unsold_reason);
    const change = leadStatusForOutcome(plan.set.outcome ?? entry.outcome, plan.set.unsold_reason ?? null);
    // The same outcome and reason again changes nothing. A new unsold reason (Price/Payment -> Credit) is a new
    // follow-up (G-017-023): the AI is told the reason, the Future Follow-Up date and what the visit was about.
    const same = JSON.stringify(before) === JSON.stringify(change);
    if (change?.unsold_reason) {
      const v = { ...(entry.vehicle || {}), ...(plan.set.vehicle || {}) };
      const t = { ...(entry.trade || {}), ...(plan.set.trade || {}) };
      const car = (x) => [x.year, x.make, x.model, x.trim].filter(Boolean).join(' ');
      const next = 'next_step_at' in plan.set ? plan.set.next_step_at : entry.next_step_at;
      change.follow_up_at = next ? new Date(next).toISOString() : null;
      change.visit_note = [car(v) && `Vehicle they looked at: ${car(v)}${entry.stock_number ? ` (stock #${entry.stock_number})` : ''}.`,
        car(t) && `Trade: ${car(t)}.`, plan.note && `Manager's note: ${plan.note}`].filter(Boolean).join(' ');
    }
    const refused = change && !same && await setLeadStatus(req, entry.lead_id, change);
    if (refused) return json({ message: refused.message }, refused.status >= 500 ? 502 : 409);
    const outcome = plan.set.outcome ?? entry.outcome;
    const reason = 'unsold_reason' in plan.set ? plan.set.unsold_reason : entry.unsold_reason;
    applied = await applyRules({ entry, plan, outcome, reason, now, byName });
  }

  const update = { $set: plan.set };
  const push = {};
  if (plan.history.length) push.history = { $each: plan.history.map((h) => ({ ...h, at: now, by, by_name: byName })) };
  if (plan.note) push.notes = { text: plan.note, at: now, by, by_name: byName };
  if (Object.keys(push).length) update.$push = push;
  if (!Object.keys(plan.set).length) delete update.$set;
  await DeskLogEntry.updateOne({ _id: entry._id }, update);
  return json({ entry: { id: String(entry._id) }, changed: true, applied });
}

// The dealer's follow-up rule for the new outcome (Deliverable J). Adds to `plan` (saved with the outcome) and does
// what it says: AI off for the lead, managers alerted. Returns what was done, for the screen.
async function applyRules({ entry, plan, outcome, reason, now, byName }) {
  if (!outcome) return null;
  const { rules, checklist } = await rulesFor(entry.dealer_id);
  const key = outcomeKey(outcome, reason);
  const rule = rules[key];
  if (!rule) return null;
  const done = { rule: key };
  plan.set.report_group = rule.report_group || null;
  plan.set.next_step_owner = rule.who === 'ai_and_staff' || rule.who === 'staff' ? rule.owner : null;
  const hasNext = 'next_step_at' in plan.set ? Boolean(plan.set.next_step_at) : entry.next_step_at && new Date(entry.next_step_at) > now;
  if (rule.next_step_hours && plan.set.next_step_owner && !hasNext) {
    const at = new Date(now.getTime() + rule.next_step_hours * 3600e3);
    plan.history.push({ field: 'next_step_at', from: entry.next_step_at ?? null, to: at });
    plan.set.next_step_at = at;
    done.next_step_at = at;
  }
  if (outcome === 'SOLD PENDING' && checklist.length && !(entry.checklist || []).length) {
    plan.set.checklist = checklist.map((item) => ({ item, done: false }));
    done.checklist = checklist.length;
  }
  if ((rule.who === 'staff' || rule.who === 'nobody') && key !== 'UNSOLD|DND') {
    // Staff follow up themselves: the AI stops on this lead, the same as an admin take-over.
    await pauseAiForLead({ leadId: String(entry.lead_id), dealerId: String(entry.dealer_id),
      reason: `Taken over by staff (Desk Log rule: ${rule.who === 'staff' ? 'staff follow up' : 'no follow-up'})`, by: byName })
      .catch((e) => console.error('[desk-log] AI pause failed', e?.message));
    done.ai_paused = true;
  }
  if (rule.alert_managers) {
    const label = outcome === 'UNSOLD' ? `Unsold - ${reason}` : outcome;
    await notifyManagers({ dealerId: String(entry.dealer_id), leadId: String(entry.lead_id),
      title: `Desk Log: ${label}`, detail: `Set by ${byName || 'staff'}.` })
      .catch((e) => console.error('[desk-log] manager alert failed', e?.message));
    done.managers_alerted = true;
  }
  return done;
}
