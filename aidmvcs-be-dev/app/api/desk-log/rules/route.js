// The dealership's Desk Log settings (lib/deskLog/rules.js): which outcomes alert the managers, and the Sold Pending
// delivery checklist. Who follows up and how is the AI's, set in AI Studio.
//   GET ?dealer_id                      -> { rules, checklist, version, history, outcomes, can_edit }
//   PUT { dealer_id, rules, checklist } -> saves a new version (dealer account / "Manage Account Information")
import DeskLogRules from '@models/DeskLogRules';
import { deskLogAccess, json } from '@lib/deskLog/access';
import { hasPermission } from '@lib/staffPermission';
import { OUTCOME_KEYS, normalizeChecklist, normalizeRules, rulesFor } from '@lib/deskLog/rules';

const canEdit = (user) => hasPermission(user, 'Manage Account Information');

async function view(dealerId, user) {
  const r = await rulesFor(dealerId);
  return { rules: r.rules, checklist: r.checklist, version: r.version,
    history: r.history.slice(-10).reverse().map((h) => ({ version: h.version, at: h.at, by_name: h.by_name })),
    outcomes: OUTCOME_KEYS.map(([key, label]) => ({ key, label })), can_edit: await canEdit(user) };
}

export async function GET(req) {
  const dealerId = new URL(req.url).searchParams.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  return json(await view(dealerId, access.user));
}

export async function PUT(req) {
  let body;
  try { body = await req.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
  const access = await deskLogAccess(req, body?.dealer_id);
  if (access.response) return access.response;
  if (!(await canEdit(access.user))) return json({ message: 'You do not have permission to change the follow-up rules' }, 403);
  let rules; let checklist;
  try { rules = normalizeRules(body.rules || {}); checklist = normalizeChecklist(body.checklist); }
  catch (e) { return json({ message: e.message }, 400); }
  const dealerId = String(body.dealer_id);
  const current = await DeskLogRules.findOne({ dealer_id: dealerId }).select('version').lean();
  const version = (current?.version || 0) + 1;
  const by = access.user?._id || null; const byName = access.user?.name || access.user?.email || null;
  await DeskLogRules.updateOne({ dealer_id: dealerId }, { $set: { rules, checklist, version },
    $push: { history: { $each: [{ version, at: new Date(), by, by_name: byName, rules, checklist }], $slice: -50 } } },
  { upsert: true });
  return json(await view(dealerId, access.user));
}
