#!/usr/bin/env node
// Old leads into the department their source names (20 Nov 2026). Since 17 Nov a new lead takes its department from its
// source on arrival (app/lib/departmentRouting.js departmentFromSource: "service / repair / maintenance / oil / recall"
// -> Service, "parts" -> Parts). Leads from before - e.g. Victory Mitsubishi's 133 "CarNow Chat - Service" chats - were
// all left in Sales. This moves them with the same rule:
//   - only leads still on the default (department missing, or Sales set by 'default'); never one staff, the AI or an
//     appointment placed, never a sold lead;
//   - each move gets a timeline entry (ActivityLog 'lead_edited' / department, by 'system', as departmentRouting.js writes it); no emails to staff - these are
//     old leads, not new work.
// Without --apply it only reports.
//
// Usage:
//   MONGODB_URI=... node scripts/backfill-lead-departments.js [--apply] [--dealer <dealer_id>] [--uri <uri>] [--allow-remote]
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { departmentFromSource } from '../app/lib/departmentRouting.js';
import { isLocalUri } from './normalize-legacy-statuses.js';

const ids = (id) => [String(id), ...(mongoose.isValidObjectId(String(id)) ? [new mongoose.Types.ObjectId(String(id))] : [])];

export async function backfillLeadDepartments(db, { apply = false, dealerId = null, log = () => {} } = {}) {
  const leads = db.collection('leads');
  const activity = db.collection('activitylogs');
  const query = {
    ...(dealerId ? { dealer_id: { $in: ids(dealerId) } } : {}),
    $and: [
      { $or: [{ department: { $exists: false } }, { department: null }, { department: 'sales', department_set_by: { $in: [null, 'default'] } }] },
      { $or: [{ lead_source: /service|repair|maintenance|oil|recall|parts?\b/i }, { source: /service|repair|maintenance|oil|recall|parts?\b/i },
        { sub_source: /service|repair|maintenance|oil|recall|parts?\b/i }] },
      { fe_lead_status: { $not: /sold/i } },
    ],
  };
  const out = { checked: 0, service: 0, parts: 0, by_source: {} };
  const now = new Date();
  for await (const lead of leads.find(query, { projection: { source: 1, lead_source: 1, sub_source: 1, dealer_id: 1, customer_id: 1 } })) {
    out.checked += 1;
    const dept = departmentFromSource(lead);
    if (!dept) continue;
    out[dept] += 1;
    const label = [lead.lead_source || lead.source, lead.sub_source].filter(Boolean).join(' · ') || '(none)';
    out.by_source[`${dept} <- ${label}`] = (out.by_source[`${dept} <- ${label}`] || 0) + 1;
    if (!apply) continue;
    await leads.updateOne({ _id: lead._id }, { $set: { department: dept, department_set_by: 'source', department_at: now } });
    await activity.insertOne({ dealer_id: String(lead.dealer_id), customer_id: lead.customer_id || null, lead_id: lead._id,
      actor_type: 'system', actor_id: null, actor_name: 'AutoPulse', action: 'lead_edited', from: 'Sales',
      to: dept === 'service' ? 'Service' : 'Parts', detail: 'department', at: now });
  }
  log(`${apply ? 'APPLY' : 'DRY RUN'}${dealerId ? ` (dealer ${dealerId})` : ''}: ${out.checked} lead(s) checked; `
    + `${out.service} ${apply ? 'moved' : 'would move'} to Service, ${out.parts} to Parts`);
  for (const [k, n] of Object.entries(out.by_source).sort((a, b) => b[1] - a[1]).slice(0, 25)) log(`  ${n}  ${k}`);
  return out;
}

const argValue = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function main() {
  const args = process.argv.slice(2);
  const uri = argValue(args, '--uri') || process.env.MONGODB_URI;
  if (!uri) { console.error('Usage: MONGODB_URI=... node scripts/backfill-lead-departments.js [--apply] [--dealer <id>] [--allow-remote]'); process.exitCode = 1; return; }
  if (!isLocalUri(uri) && !args.includes('--allow-remote')) { console.error('Refusing a non-local database. Add --allow-remote if you really mean it.'); process.exitCode = 1; return; }
  const connection = mongoose.createConnection(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    await backfillLeadDepartments(connection.db, { apply: args.includes('--apply'), dealerId: argValue(args, '--dealer'), log: (l) => console.log(l) });
  } catch (error) {
    console.error('backfill-lead-departments failed:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
    await mongoose.disconnect().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
