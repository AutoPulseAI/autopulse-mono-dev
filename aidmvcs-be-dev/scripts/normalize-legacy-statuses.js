#!/usr/bin/env node
// Legacy lead statuses: report them, and (with --apply) rewrite the ones with a clear governed value
// (P1 plan decision 9 Nov 2026: "Legacy status values: fix them in the data AND map them in reports").
//
// Reads Lead.fe_lead_status only and, with --apply, writes Lead.fe_lead_status only - nothing else on the lead or
// anywhere else. The mapping is app/lib/reporting/normalize.js (the same table the reports use). Values without a
// clear target ('Sold': pending or delivered?; 'Deal Close'; unknown values; no status) are reported for a person to
// decide and never written. 'Opted Out' and 'DND' are both governed and are not merged (app/lib/ai/aiDnd.js treats
// them differently).
//
// Usage:
//   MONGODB_URI=mongodb://127.0.0.1:27018/autopulse_local node scripts/normalize-legacy-statuses.js        (dry run)
//   ... node scripts/normalize-legacy-statuses.js --apply [--dealer <dealer_id>]
//   --uri <uri>        instead of MONGODB_URI
//   --allow-remote     needed for any host other than localhost / 127.0.0.1 / ::1
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { GOVERNED_STATUSES, normalizeStatus } from '../app/lib/reporting/normalize.js';

export function isLocalUri(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(uri || ''));
  if (!m) return false; // mongodb+srv:// is always remote
  const hosts = m[1].split(',').map((h) => h.replace(/^\[|\](:\d+)?$/g, '').replace(/:\d+$/, '').toLowerCase());
  return hosts.every((h) => ['localhost', '127.0.0.1', '::1'].includes(h));
}

/**
 * @param {import('mongodb').Db} db
 * @param {{apply?: boolean, dealerId?: string|null, log?: (line: string) => void}} opts
 * @returns {Promise<{values: object[], legacy_leads: number, fixable_leads: number, review_leads: number,
 *   updated: number}>}
 */
export async function normalizeLegacyStatuses(db, { apply = false, dealerId = null, log = () => {} } = {}) {
  const leads = db.collection('leads');
  const scope = dealerId ? { dealer_id: { $in: [String(dealerId), ...(mongoose.isValidObjectId(dealerId)
    ? [new mongoose.Types.ObjectId(String(dealerId))] : [])] } } : {};
  const groups = await leads.aggregate([
    { $match: { ...scope, fe_lead_status: { $nin: GOVERNED_STATUSES } } },
    { $group: { _id: '$fe_lead_status', n: { $sum: 1 } } },
    { $sort: { n: -1, _id: 1 } },
  ]).toArray();

  const values = groups.map((g) => {
    const n = normalizeStatus(g._id);
    return { value: g._id ?? null, leads: g.n, becomes: n.fix, group: n.label, needs_review: n.needs_review };
  });
  let updated = 0;
  log(`${apply ? 'APPLY' : 'DRY RUN'}${dealerId ? ` (dealer ${dealerId})` : ''}: ${values.length} non-governed status `
    + 'value(s)');
  for (const v of values) {
    const what = v.becomes ? `-> "${v.becomes}"` : '-> no change (a person must decide)';
    log(`  ${JSON.stringify(v.value)}: ${v.leads} lead(s) ${what}   [reports: ${v.group}]`);
    if (apply && v.becomes && v.value != null) {
      const res = await leads.updateMany({ ...scope, fe_lead_status: v.value }, { $set: { fe_lead_status: v.becomes } });
      updated += res.modifiedCount;
    }
  }
  const sum = (pred) => values.filter(pred).reduce((s, v) => s + v.leads, 0);
  const out = { values, legacy_leads: sum(() => true), fixable_leads: sum((v) => v.becomes && v.value != null),
    review_leads: sum((v) => !v.becomes || v.value == null), updated };
  log(`${out.fixable_leads} lead(s) ${apply ? 'updated' : 'would be updated'}${apply ? ` (${updated} written)` : ''}; `
    + `${out.review_leads} need a person.`);
  return out;
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--apply', '--allow-remote', '--uri', '--dealer']);
  const bad = args.filter((a, i) => a.startsWith('--') && !known.has(a)
    || (!a.startsWith('--') && !['--uri', '--dealer'].includes(args[i - 1])));
  const uri = argValue(args, '--uri') || process.env.MONGODB_URI;
  if (bad.length || !uri) {
    console.error('Usage: MONGODB_URI=... node scripts/normalize-legacy-statuses.js [--apply] [--dealer <id>] '
      + '[--uri <uri>] [--allow-remote]');
    process.exitCode = 1;
    return;
  }
  if (!isLocalUri(uri) && !args.includes('--allow-remote')) {
    console.error('Refusing a non-local database. Add --allow-remote if you really mean it.');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(uri, { autoIndex: false, autoCreate: false,
    serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    await normalizeLegacyStatuses(connection.db, { apply: args.includes('--apply'),
      dealerId: argValue(args, '--dealer'), log: (line) => console.log(line) });
  } catch (error) {
    console.error('normalize-legacy-statuses failed:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
