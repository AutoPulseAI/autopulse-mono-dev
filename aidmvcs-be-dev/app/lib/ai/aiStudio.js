// AI Studio (client, 13 Oct 2026): the AI's settings as versioned items the super admin can see, edit, publish and
// revert. This phase is the dashboard and its history only - the AI keeps using its built-in settings until the next
// phase connects it to the published versions, so nothing here changes a customer message yet.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@lib/adminAuth';
import { AiConfigItem, AiConfigVersion } from '@models/AiConfig';
import defaults from './aiStudioDefaults.json';

export const PLACEHOLDERS = defaults.placeholders;
export const TYPES = ['agents', 'buckets', 'sources', 'cadences', 'workflows', 'messages', 'status_rules', 'prompts'];
// What a workflow branch can wait for, and what it can lead to (the tree editor's dropdowns).
export const CONDITIONS = ['yes', 'no', 'anything_else', 'picks_a_time', 'mentions_trade', 'mentions_credit',
  'mentions_price', 'no_reply'];
export const OUTCOMES = ['ask', 'ai', 'book', 'end', 'escalate', 'set_status', 'call_task'];
const MODES = ['fixed', 'ai', 'fixed_opening_ai'];

// Only the super admin (client, 8 Oct 2026: "workflow access is limited to admins"). The role names that count can be
// set with AI_STUDIO_ROLES (comma separated); an admin with no role is the account owner.
export function requireStudioAdmin(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth;
  const allowed = (process.env.AI_STUDIO_ROLES || 'super admin,superadmin,super-admin,admin')
    .split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
  const role = String(auth.decoded?.role || '').trim().toLowerCase();
  if (role && !allowed.includes(role)) {
    return { error: NextResponse.json({ error: 'Only the super admin can use AI Studio.' }, { status: 403 }) };
  }
  return auth;
}

// Version 1 of every item is the AI's built-in setting. Added once; an item someone edited is never overwritten. A
// built-in item nobody has touched follows a newer built-in shape (defaults.revision), and one the built-ins no longer
// have (and nobody edited) is retired.
// The version is the built-in setting: seeded, reset, or reverted to one of those (the AI reads it the same way,
// agentic-upsell upsell_agent/ai_studio.py).
async function isBuiltInVersion(version) {
  for (let i = 0; i < 20 && version; i += 1) {
    if (/^(Built-in setting|Reset to the AutoPulse default)/.test(version.note || '')) return true;
    if (!version.reverted_from) return false;
    version = await AiConfigVersion.findOne({ item_id: version.item_id, version: version.reverted_from }).lean();
  }
  return false;
}

export async function seedDefaults({ by = 'AutoPulse default' } = {}) {
  let added = 0;
  const revision = defaults.revision || 1;
  const builtIn = new Set(defaults.items.map((row) => `${row.type}:${row.key}`));
  const stale = await AiConfigItem.find({ dealer_id: null, deleted: { $ne: true }, latest_version: 1,
    custom: { $ne: true }, defaults_revision: { $not: { $gte: revision } } }).lean();
  for (const item of stale) {
    const first = await AiConfigVersion.findOne({ item_id: item._id, version: 1 }).lean();
    if (first?.note === 'Created') {
      // Made in AI Studio (before items were marked): never a built-in to retire or upgrade.
      await AiConfigItem.updateOne({ _id: item._id }, { $set: { custom: true } });
      continue;
    }
    if (!builtIn.has(`${item.type}:${item.key}`)) {
      // A built-in that no longer exists: retired, its history kept and its name freed.
      await AiConfigItem.updateOne({ _id: item._id },
        { $set: { deleted: true, deleted_at: new Date(), key: `${item.key}__deleted_${Date.now()}` } });
      continue;
    }
    const row = defaults.items.find((r) => r.type === item.type && r.key === item.key);
    await AiConfigVersion.updateOne({ item_id: item._id, version: 1 }, { $set: { content: row.content } });
    await AiConfigItem.updateOne({ _id: item._id }, { $set: { name: row.name, defaults_revision: revision } });
  }
  // An item reset to the default (or reverted to it) is the built-in too: it takes the new built-in, as a new version.
  const reset = await AiConfigItem.find({ dealer_id: null, deleted: { $ne: true }, latest_version: { $gt: 1 },
    custom: { $ne: true }, defaults_revision: { $not: { $gte: revision } } }).lean();
  for (const item of reset) {
    const row = defaults.items.find((r) => r.type === item.type && r.key === item.key);
    const live = await AiConfigVersion.findOne({ item_id: item._id, version: item.published_version }).lean();
    if (row && live && await isBuiltInVersion(live)) {
      await newVersion(item, row.content, { status: 'published', note: 'Reset to the AutoPulse default (updated)',
        by: { name: by } });
      // A draft someone is working on stays theirs.
      if (item.draft_version) await AiConfigItem.updateOne({ _id: item._id }, { $set: { draft_version: item.draft_version } });
    }
    await AiConfigItem.updateOne({ _id: item._id }, { $set: { defaults_revision: revision } });
  }
  for (const row of defaults.items) {
    const existing = await AiConfigItem.findOne({ type: row.type, key: row.key, dealer_id: null }).lean();
    if (existing) continue;
    const item = await AiConfigItem.create({ type: row.type, key: row.key, name: row.name, locked: !!row.locked,
      published_version: 1, latest_version: 1, defaults_revision: revision });
    await AiConfigVersion.create({ item_id: item._id, version: 1, status: 'published', content: row.content,
      note: 'Built-in setting (what the AI does today)', created_by_name: by, published_at: new Date(),
      published_by_name: by });
    added += 1;
  }
  return added;
}

export function defaultContent(type, key) {
  return defaults.items.find((row) => row.type === type && row.key === key)?.content ?? null;
}

// --- Checks before a save (plain-English reasons for a non-technical user) --------------------------------------

const PLACEHOLDER = /\{([a-z_]+)\}/g;

function messageProblems(message, where) {
  const problems = [];
  if (!message || typeof message !== 'object') return [`${where}: the message is missing.`];
  if (!MODES.includes(message.mode)) problems.push(`${where}: choose how the message is written.`);
  if (message.mode !== 'ai' && !String(message.text || '').trim()) problems.push(`${where}: the message text is empty.`);
  if (message.mode !== 'fixed' && !String(message.instruction || '').trim()) {
    problems.push(`${where}: tell the AI what to write (the instruction is empty).`);
  }
  for (const field of ['text', 'email_text', 'email_subject', 'fallback']) {
    for (const [, name] of String(message[field] || '').matchAll(PLACEHOLDER)) {
      if (!PLACEHOLDERS[name] && name !== 'price_line') problems.push(`${where}: {${name}} isn't a known placeholder.`);
    }
  }
  return problems;
}

// A workflow is a tree: every node has a message and branches; every branch waits for a condition and leads somewhere.
function treeProblems(node, path, problems, seen) {
  if (!node || typeof node !== 'object') { problems.push(`${path}: this step is empty.`); return; }
  const where = `${path}${node.label ? ` "${node.label}"` : ''}`;
  if (node.id) {
    if (seen.has(node.id)) problems.push(`${where}: two steps share the name "${node.id}".`);
    seen.add(node.id);
  }
  problems.push(...messageProblems(node.message, where));
  const branches = Array.isArray(node.branches) ? node.branches : [];
  const used = new Set();
  branches.forEach((b, i) => {
    const label = `${where}, branch ${i + 1}`;
    const when = b?.when?.value;
    if (!CONDITIONS.includes(when)) problems.push(`${label}: choose what the customer says or does.`);
    if (used.has(when) && when !== 'no_reply') problems.push(`${label}: "${when}" is used twice on this step.`);
    used.add(when);
    const action = b?.then?.action;
    if (!OUTCOMES.includes(action)) problems.push(`${label}: choose what happens next.`);
    if (action === 'ask') treeProblems(b.then.node, `${label} ->`, problems, seen);
    if (action === 'set_status' && !b.then.status) problems.push(`${label}: choose the status.`);
  });
}

// A wait (client, 13 Oct 2026: "minutes, hours, days, weeks, months, years ... how much time they want").
export const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'];
const AT = /^\s*\d{1,2}(:\d{2})?\s*([ap]\.?m\.?)?\s*$/i;

function waitProblems(wait, where) {
  if (!wait) return [];
  const problems = [];
  const amount = Number(wait.amount);
  if (!Number.isFinite(amount) || amount < 0) problems.push(`${where}: the wait must be a number (0 or more).`);
  if (!UNITS.includes(wait.unit)) problems.push(`${where}: choose minutes, hours, days, weeks, months or years.`);
  if (wait.at && !AT.test(wait.at)) problems.push(`${where}: the send time should look like 10:00 or 2:30 PM.`);
  return problems;
}

export function contentProblems(type, content, key = null) {
  if (!content || typeof content !== 'object') return ['Nothing to save.'];
  const problems = [];
  const builtIn = key ? !!defaultContent(type, key) : true;
  if (Array.isArray(content.steps)) {
    content.steps.forEach((step, i) => problems.push(...waitProblems(step.wait, `Step ${i + 1} timing`)));
  }
  if (content.repeat) {
    for (const part of ['first', 'every', 'until']) problems.push(...waitProblems(content.repeat[part], `Repeat (${part})`));
    if (!(Number(content.repeat.every?.amount) > 0)) problems.push('Repeat: "every" must be more than 0.');
  }
  if (content.closes_after) problems.push(...waitProblems(content.closes_after, 'Closes after'));
  if (type === 'cadences' && !builtIn) {
    const start = content.starts_when || {};
    if (!['status', 'lead_created', 'customer_says'].includes(start.type)) {
      problems.push('Choose when this cadence starts.');
    } else if (start.type === 'status' && !start.status) {
      problems.push('Choose the status that starts this cadence.');
    } else if (start.type === 'customer_says' && !(start.phrases || []).length) {
      problems.push('Add the words that start this cadence.');
    }
    if (!(content.steps || []).length) problems.push('Add at least one touch.');
  }
  if (content.tree) {
    treeProblems(content.tree, 'First step', problems, new Set());
    if (type === 'workflows' && !content.trigger?.pattern && !(content.trigger?.phrases || []).length) {
      problems.push('Say what starts this workflow (the words the customer uses).');
    }
  }
  if (content.message) problems.push(...messageProblems(content.message, 'Message'));
  if (Array.isArray(content.steps)) {
    const ids = new Set(content.steps.map((s) => s.id));
    content.steps.forEach((step, i) => {
      const where = `Step ${i + 1}${step.label ? ` (${step.label})` : ''}`;
      if (!step.id) problems.push(`${where}: needs a name.`);
      if (step.message) problems.push(...messageProblems(step.message, where));
      for (const next of [step.go, ...(step.next || []).map((n) => n.go)].filter(Boolean)) {
        if (!['end', 'ai'].includes(next) && !ids.has(next) && !content.steps.some((s) => s.on_step === next)) {
          problems.push(`${where}: "go to ${next}" points at a step that doesn't exist.`);
        }
      }
    });
    if (type === 'workflows' && content.steps.length && !content.steps.some((s) => (s.go || 'end') === 'end'
      || (s.next || []).some((n) => n.go === 'end' || n.go === 'ai'))) {
      problems.push('The flow has no way to finish: at least one step must end it or hand back to the AI.');
    }
  }
  if (type === 'agents' && !String(content.playbook || '').trim()) problems.push('The agent needs a playbook.');
  if (type === 'prompts' && content.text && !/never|TCPA|consent/i.test(content.text)) {
    problems.push('The compliance rules can\'t be removed from a prompt.');
  }
  return problems;
}

// --- Reads ------------------------------------------------------------------------------------------------------

export async function listItems() {
  await seedDefaults();
  const items = await AiConfigItem.find({ deleted: { $ne: true }, dealer_id: null }).sort({ type: 1, name: 1 }).lean();
  return items.map((i) => ({ id: String(i._id), type: i.type, key: i.key, name: i.name, locked: i.locked,
    published_version: i.published_version, draft_version: i.draft_version, updated_at: i.updatedAt }));
}

export async function getItem(id) {
  const item = await AiConfigItem.findById(id).lean();
  if (!item) return null;
  const versions = await AiConfigVersion.find({ item_id: item._id }).sort({ version: -1 }).lean();
  return {
    id: String(item._id), type: item.type, key: item.key, name: item.name, locked: item.locked,
    published_version: item.published_version, draft_version: item.draft_version,
    has_default: !!defaultContent(item.type, item.key),
    versions: versions.map((v) => ({ version: v.version, status: v.status, content: v.content, note: v.note,
      created_by_name: v.created_by_name, created_at: v.createdAt, published_at: v.published_at,
      published_by_name: v.published_by_name, reverted_from: v.reverted_from })),
  };
}

// --- Writes: every one is a new version; nothing is ever overwritten -------------------------------------------

async function newVersion(item, content, { status, note, by, revertedFrom = null }) {
  const version = (item.latest_version || 0) + 1;
  const now = new Date();
  await AiConfigVersion.create({ item_id: item._id, version, status, content, note: note || null,
    created_by: by?.id || null, created_by_name: by?.name || null, reverted_from: revertedFrom,
    ...(status === 'published' ? { published_at: now, published_by_name: by?.name || null } : {}) });
  const update = { latest_version: version };
  if (status === 'draft') update.draft_version = version;
  if (status === 'published') {
    await AiConfigVersion.updateMany({ item_id: item._id, status: 'published', version: { $ne: version } },
      { $set: { status: 'archived' } });
    Object.assign(update, { published_version: version, draft_version: null });
  }
  await AiConfigItem.updateOne({ _id: item._id }, { $set: update });
  return version;
}

export async function saveDraft(id, content, { note, by }) {
  const item = await AiConfigItem.findById(id);
  if (!item) return { status: 404, error: 'Not found.' };
  if (item.locked) return { status: 409, error: 'This one is locked: it keeps the AI legal and safe.' };
  // A draft always saves, half-finished or not; what's wrong is shown, and only publishing waits for it.
  const problems = contentProblems(item.type, content, item.key);
  return { version: await newVersion(item, content, { status: 'draft', note, by }), problems };
}

export async function publish(id, version, { by }) {
  const item = await AiConfigItem.findById(id);
  if (!item) return { status: 404, error: 'Not found.' };
  if (item.locked) return { status: 409, error: 'This one is locked.' };
  const draft = await AiConfigVersion.findOne({ item_id: item._id, version: Number(version) || item.draft_version });
  if (!draft) return { status: 404, error: 'No draft to publish.' };
  const problems = contentProblems(item.type, draft.content, item.key);
  if (problems.length) return { status: 422, error: 'Please fix these first.', problems };
  await AiConfigVersion.updateMany({ item_id: item._id, status: 'published' }, { $set: { status: 'archived' } });
  await AiConfigVersion.updateOne({ _id: draft._id }, { $set: { status: 'published', published_at: new Date(),
    published_by_name: by?.name || null } });
  await AiConfigItem.updateOne({ _id: item._id }, { $set: { published_version: draft.version, draft_version: null } });
  return { version: draft.version };
}

export async function revert(id, version, { by }) {
  const item = await AiConfigItem.findById(id);
  if (!item) return { status: 404, error: 'Not found.' };
  if (item.locked) return { status: 409, error: 'This one is locked.' };
  const old = await AiConfigVersion.findOne({ item_id: item._id, version: Number(version) }).lean();
  if (!old) return { status: 404, error: `Version ${version} doesn't exist.` };
  return { version: await newVersion(item, old.content, { status: 'published', note: `Reverted to version ${version}`,
    by, revertedFrom: Number(version) }) };
}

export async function resetToDefault(id, { by }) {
  const item = await AiConfigItem.findById(id);
  if (!item) return { status: 404, error: 'Not found.' };
  const content = defaultContent(item.type, item.key);
  if (!content) return { status: 404, error: 'This item has no built-in default.' };
  return { version: await newVersion(item, content, { status: 'published', note: 'Reset to the AutoPulse default',
    by }) };
}

export async function createItem({ type, key, name, content }, { by }) {
  if (!TYPES.includes(type)) return { status: 422, error: 'Unknown type.' };
  const slug = String(key || name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!slug || !String(name || '').trim()) return { status: 422, error: 'Give it a name.' };
  const taken = await AiConfigItem.findOne({ type, key: slug, dealer_id: null });
  if (taken && !taken.deleted) return { status: 409, error: 'Something with that name already exists.' };
  if (taken) {  // deleted before names were freed on delete: free it now
    await AiConfigItem.updateOne({ _id: taken._id }, { $set: { key: `${taken.key}__deleted_${Date.now()}` } });
  }
  const item = await AiConfigItem.create({ type, key: slug, name: String(name).trim(), published_version: null,
    latest_version: 0, custom: true });
  const version = await newVersion(item, content, { status: 'draft', note: 'Created', by });
  return { id: String(item._id), version };
}

export async function removeItem(id) {
  const item = await AiConfigItem.findById(id);
  if (!item) return { status: 404, error: 'Not found.' };
  if (item.locked || defaultContent(item.type, item.key)) {
    return { status: 409, error: 'Built-in items can be changed or reset, not deleted.' };
  }
  // Its history stays; the name is freed, so a new item can be made with it.
  await AiConfigItem.updateOne({ _id: item._id },
    { $set: { deleted: true, deleted_at: new Date(), key: `${item.key}__deleted_${Date.now()}` } });
  return { deleted: true };
}
