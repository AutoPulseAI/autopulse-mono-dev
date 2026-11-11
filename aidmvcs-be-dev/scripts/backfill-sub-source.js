#!/usr/bin/env node
// Sub-source for leads that came in before it was saved (Betsy's source / sub-source report, 11 Nov 2026).
//
// Reads each saved lead email (rawadfpayloads.raw_xml), takes the sub-source from its provider the same way new leads
// get it (app/lib/adfLeadParser.js adfSubSource), finds the lead that email created (leads.sourcemail = the email's
// message id, else emails.lead_id for that message) and, with --apply, sets Lead.sub_source. Writes nothing else and
// never overwrites a sub-source that is already set. Without --apply it only reports.
//
// Usage:
//   MONGODB_URI=mongodb://127.0.0.1:27018/autopulse_local node scripts/backfill-sub-source.js          (dry run)
//   ... node scripts/backfill-sub-source.js --apply [--dealer <dealer_id>]
//   --uri <uri>        instead of MONGODB_URI
//   --allow-remote     needed for any host other than localhost / 127.0.0.1 / ::1
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { adfProvider, adfSubSource, parseAdfTree } from '../app/lib/adfLeadParser.js';
import { normalizeProvider } from '../app/lib/reporting/normalize.js';
import { isLocalUri } from './normalize-legacy-statuses.js';

const ids = (id) => [String(id), ...(mongoose.isValidObjectId(String(id)) ? [new mongoose.Types.ObjectId(String(id))]
  : [])];

/** The sub-source in one saved lead email, or undefined when it can't be read. */
export function subSourceOfPayload(rawXml) {
  try {
    const tree = parseAdfTree(rawXml);
    const provider = tree && adfProvider(tree.parsed);
    return provider ? { provider, sub: adfSubSource(provider) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {import('mongodb').Db} db
 * @param {{apply?: boolean, dealerId?: string|null, log?: (line: string) => void}} opts
 */
export async function backfillSubSource(db, { apply = false, dealerId = null, log = () => {} } = {}) {
  const payloads = db.collection('rawadfpayloads');
  const leads = db.collection('leads');
  const emails = db.collection('emails');
  const scope = dealerId ? { dealer_id: { $in: ids(dealerId) } } : {};
  const out = { emails: 0, unreadable: 0, no_lead: 0, no_sub_source: 0, already_set: 0, updated: 0, would_update: 0,
    by_sub_source: {} };
  const seen = new Set();
  const cursor = payloads.find(scope, { projection: { dealer_id: 1, message_id: 1, raw_xml: 1 } }).sort({ _id: 1 });
  for await (const p of cursor) {
    const key = `${p.dealer_id}|${p.message_id}`;
    if (seen.has(key)) continue; // body + attachment rows of the same email
    seen.add(key);
    out.emails += 1;
    const found = subSourceOfPayload(p.raw_xml);
    if (!found) { out.unreadable += 1; continue; }
    const dealer = { dealer_id: { $in: ids(p.dealer_id) } };
    let lead = await leads.findOne({ ...dealer, sourcemail: p.message_id }, { projection: { sub_source: 1 } });
    if (!lead) {
      const email = await emails.findOne({ ...dealer, message_id: p.message_id, lead_id: { $ne: null } },
        { projection: { lead_id: 1 } });
      if (email?.lead_id) {
        lead = await leads.findOne({ _id: mongoose.isValidObjectId(String(email.lead_id))
          ? new mongoose.Types.ObjectId(String(email.lead_id)) : email.lead_id, ...dealer },
        { projection: { sub_source: 1 } });
      }
    }
    if (!lead) { out.no_lead += 1; continue; }
    if (!found.sub) { out.no_sub_source += 1; continue; }
    if (lead.sub_source) { out.already_set += 1; continue; }
    const label = `${normalizeProvider(found.provider.name || found.provider.service)} / ${found.sub}`;
    out.by_sub_source[label] = (out.by_sub_source[label] || 0) + 1;
    if (apply) {
      const res = await leads.updateOne({ _id: lead._id, $or: [{ sub_source: null }, { sub_source: { $exists: false } }] },
        { $set: { sub_source: found.sub } });
      out.updated += res.modifiedCount;
    } else {
      out.would_update += 1;
    }
  }
  log(`${apply ? 'APPLY' : 'DRY RUN'}${dealerId ? ` (dealer ${dealerId})` : ''}: ${out.emails} lead email(s) read`);
  for (const [label, n] of Object.entries(out.by_sub_source).sort((a, b) => b[1] - a[1])) log(`  ${label}: ${n} lead(s)`);
  log(`${apply ? `${out.updated} lead(s) updated` : `${out.would_update} lead(s) would be updated`}; `
    + `${out.no_sub_source} with no sub-source; ${out.already_set} already set; ${out.no_lead} email(s) with no lead; `
    + `${out.unreadable} unreadable.`);
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
    console.error('Usage: MONGODB_URI=... node scripts/backfill-sub-source.js [--apply] [--dealer <id>] [--uri <uri>] '
      + '[--allow-remote]');
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
    await backfillSubSource(connection.db, { apply: args.includes('--apply'), dealerId: argValue(args, '--dealer'),
      log: (line) => console.log(line) });
  } catch (error) {
    console.error('backfill-sub-source failed:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
