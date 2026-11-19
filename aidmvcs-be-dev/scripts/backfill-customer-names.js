#!/usr/bin/env node
// First / middle / last name for customers saved before names were kept in parts (19 Nov 2026; app/lib/personName.js).
// New customers get them on arrival; this does the same for the ones already there, strongest source last so it wins:
//   1. adf    each saved lead email (rawadfpayloads.raw_xml) -> its lead gets first / middle / last, and the lead's
//             customer too when the customer's full name is that same name
//   2. dms    the newest DealerVault deal linked to the customer (deals.customer_id): buyer's First / Middle / Last
//   3. guess  any customer still without parts: split from the full name (staff correct it on the profile)
// Never touches a name staff typed (name_parts_from "staff"), never changes Customer.name. Without --apply it only
// reports.
//
// Usage:
//   MONGODB_URI=mongodb://127.0.0.1:27018/autopulse_local node scripts/backfill-customer-names.js          (dry run)
//   ... node scripts/backfill-customer-names.js --apply [--dealer <dealer_id>]
//   --uri <uri>        instead of MONGODB_URI
//   --allow-remote     needed for any host other than localhost / 127.0.0.1 / ::1
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { parseAdfLeadEmail } from '../app/lib/adfLeadParser.js';
import { cleanPart, dmsNameParts, joinName, splitFullName } from '../app/lib/personName.js';
import { isLocalUri } from './normalize-legacy-statuses.js';

const ids = (id) => [String(id), ...(mongoose.isValidObjectId(String(id)) ? [new mongoose.Types.ObjectId(String(id))]
  : [])];
const oid = (v) => (mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : v);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asSet = (parts) => Object.fromEntries(['first_name', 'middle_name', 'last_name', 'suffix']
  .map((k) => [k, cleanPart(parts[k]) || null]));

/** ADF name parts in one saved lead email, or null. */
export function adfPartsOfPayload(rawXml) {
  try {
    const lead = parseAdfLeadEmail(rawXml);
    const p = lead?.nameParts;
    return p ? { first_name: cleanPart(p.first), middle_name: cleanPart(p.middle), last_name: cleanPart(p.last) } : null;
  } catch {
    return null;
  }
}

/**
 * @param {import('mongodb').Db} db
 * @param {{apply?: boolean, dealerId?: string|null, log?: (line: string) => void}} opts
 */
export async function backfillCustomerNames(db, { apply = false, dealerId = null, log = () => {} } = {}) {
  const payloads = db.collection('rawadfpayloads');
  const leads = db.collection('leads');
  const emails = db.collection('emails');
  const customers = db.collection('customers');
  const deals = db.collection('deals');
  const scope = dealerId ? { dealer_id: { $in: ids(dealerId) } } : {};
  const out = { adf_emails: 0, adf_leads: 0, adf_customers: 0, dms_customers: 0, guessed: 0, staff_kept: 0 };

  // 1. ADF
  const seen = new Set();
  for await (const p of payloads.find(scope, { projection: { dealer_id: 1, message_id: 1, raw_xml: 1 } }).sort({ _id: 1 })) {
    const key = `${p.dealer_id}|${p.message_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = adfPartsOfPayload(p.raw_xml);
    if (!parts || (!parts.first_name && !parts.last_name)) continue;
    out.adf_emails += 1;
    const dealer = { dealer_id: { $in: ids(p.dealer_id) } };
    let lead = await leads.findOne({ ...dealer, sourcemail: p.message_id }, { projection: { customer_id: 1, last_name: 1 } });
    if (!lead) {
      const email = await emails.findOne({ ...dealer, message_id: p.message_id, lead_id: { $ne: null } }, { projection: { lead_id: 1 } });
      if (email?.lead_id) lead = await leads.findOne({ _id: oid(email.lead_id), ...dealer }, { projection: { customer_id: 1, last_name: 1 } });
    }
    if (!lead) continue;
    if (!lead.last_name) {
      out.adf_leads += 1;
      if (apply) await leads.updateOne({ _id: lead._id }, { $set: { first_name: parts.first_name || null,
        middle_name: parts.middle_name || null, last_name: parts.last_name || null } });
    }
    if (lead.customer_id) {
      const sameName = new RegExp(`^\\s*${escape(joinName(parts))}\\s*$`, 'i');
      const filter = { _id: oid(lead.customer_id), name: sameName, name_parts_from: { $in: [null, 'guess'] } };
      if (apply) out.adf_customers += (await customers.updateOne(filter, { $set: { ...asSet(parts), name_parts_from: 'adf' } })).modifiedCount;
      else out.adf_customers += await customers.countDocuments(filter);
    }
  }

  // 2. DMS: the newest deal per customer
  const newest = deals.aggregate([
    { $match: { ...scope, customer_id: { $ne: null } } },
    { $sort: { _id: -1 } },
    { $group: { _id: '$customer_id', deal: { $first: '$$ROOT' } } },
  ], { allowDiskUse: true });
  for await (const row of newest) {
    const parts = dmsNameParts(row.deal);
    if (!parts) continue;
    const filter = { _id: oid(row._id), name_parts_from: { $in: [null, 'guess', 'adf'] } };
    if (apply) out.dms_customers += (await customers.updateOne(filter, { $set: { ...asSet(parts), name_parts_from: 'dms' } })).modifiedCount;
    else out.dms_customers += await customers.countDocuments(filter);
  }

  // 3. Everyone else: split the full name
  const rest = customers.find({ ...scope, name_parts_from: null, name: { $nin: [null, ''] } }, { projection: { name: 1 } });
  const batch = [];
  for await (const c of rest) {
    const parts = splitFullName(c.name);
    if (!parts.first_name && !parts.last_name) continue;
    out.guessed += 1;
    batch.push({ updateOne: { filter: { _id: c._id, name_parts_from: null }, update: { $set: { ...asSet(parts), name_parts_from: 'guess' } } } });
    if (apply && batch.length >= 500) await customers.bulkWrite(batch.splice(0), { ordered: false });
  }
  if (apply && batch.length) await customers.bulkWrite(batch, { ordered: false });
  out.staff_kept = await customers.countDocuments({ ...scope, name_parts_from: 'staff' });

  const verb = apply ? 'updated' : 'would be updated';
  log(`${apply ? 'APPLY' : 'DRY RUN'}${dealerId ? ` (dealer ${dealerId})` : ''}: ${out.adf_emails} lead email(s) with a name in parts`);
  log(`  leads ${verb} from their lead email: ${out.adf_leads}`);
  log(`  customers ${verb} from a lead email: ${out.adf_customers}`);
  log(`  customers ${verb} from the DMS: ${out.dms_customers}`);
  log(`  customers ${verb} by splitting the full name: ${out.guessed}`);
  log(`  customers whose name staff typed (left alone): ${out.staff_kept}`);
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
    console.error('Usage: MONGODB_URI=... node scripts/backfill-customer-names.js [--apply] [--dealer <id>] [--uri <uri>] '
      + '[--allow-remote]');
    process.exitCode = 1;
    return;
  }
  if (!isLocalUri(uri) && !args.includes('--allow-remote')) {
    console.error('Refusing a non-local database. Add --allow-remote if you really mean it.');
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    await connection.asPromise();
    await backfillCustomerNames(connection.db, { apply: args.includes('--apply'), dealerId: argValue(args, '--dealer'),
      log: (line) => console.log(line) });
  } catch (error) {
    console.error('backfill-customer-names failed:', error?.message);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
