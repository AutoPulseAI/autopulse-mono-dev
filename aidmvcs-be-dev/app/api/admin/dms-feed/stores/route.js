// Admin > DMS feed > DealerVault stores (super admin; 20 Nov 2026). Which DealerVault store IDs send us files, which
// AutoPulse dealer each is linked to (User.dv_dealer_id - the importer matches every file by it), and a store's files
// already in storage imported after it is linked.
//   GET                                   -> { stores: [{ dv, files, first, last, types, linked: {id, name}|null,
//                                               held, imported }], dealers: [{ id, name, dv }] }
//   PUT  { dealer_id, dv }                link (dv "DVD12345") or unlink (dv "") a dealer
//   POST { dv, action: "import_stored" }  every stored file of that store not yet imported is queued for import
//                                         (the worker imports oldest first, 20 a minute; worker/dealervault/sqsConsumer.js)
import mongoose from 'mongoose';
import AWS from 'aws-sdk';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import Batch from '@models/DealerVaultImportBatch';
import HeldFile from '@models/DealerVaultHeldFile';
import { requireSuperAdmin } from '@lib/apiGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const DV = /^DVD\d{3,10}$/;
const FILE = /^(DVD\d+)_(\d{8})_(\d{4})_(PTINV|SL|SV|SV_APPT|OPENRO)\.txt$/;
const IMPORTABLE = new Set(['PTINV', 'SL', 'SV', 'SV_APPT']); // the importer reads these four (OPENRO isn't imported)
const fail = (error, status) => Response.json({ error }, { status });

function s3() {
  return new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1',
    credentials: new AWS.EC2MetadataCredentials({ httpOptions: { timeout: 5000 }, maxRetries: 3 }) });
}

/** Every stored feed file: [{ key, fileName, dv, type, at }] (S3 raw/, the daily copy's destination). */
async function storedFiles() {
  const Bucket = process.env.DEALERVAULT_S3_BUCKET;
  if (!Bucket) throw new Error('DEALERVAULT_S3_BUCKET is not set');
  const out = [];
  let token;
  const client = s3();
  do {
    const page = await client.listObjectsV2({ Bucket, Prefix: 'raw/', ContinuationToken: token }).promise();
    for (const o of page.Contents || []) {
      const fileName = o.Key.slice(4);
      const m = FILE.exec(fileName);
      if (m) out.push({ key: o.Key, fileName, dv: m[1], type: m[4], at: o.LastModified });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  let files = [];
  let storageError = null;
  try { files = await storedFiles(); } catch (e) { storageError = e.code || e.message; }
  const dealers = await User.find({ type: 'dealer', parent_id: null }).select('name dv_dealer_id').sort({ name: 1 }).lean();
  const byDv = {};
  for (const f of files) {
    const s = byDv[f.dv] || (byDv[f.dv] = { dv: f.dv, files: 0, first: f.at, last: f.at, types: new Set() });
    s.files += 1;
    if (f.at < s.first) s.first = f.at;
    if (f.at > s.last) s.last = f.at;
    s.types.add(f.type);
  }
  for (const d of dealers) if (d.dv_dealer_id && !byDv[d.dv_dealer_id]) byDv[d.dv_dealer_id] = { dv: d.dv_dealer_id, files: 0, types: new Set() };
  const stores = await Promise.all(Object.values(byDv).map(async (s) => {
    const linked = dealers.find((d) => d.dv_dealer_id === s.dv);
    const [held, imported] = await Promise.all([
      HeldFile.countDocuments({ dvDealerId: s.dv, status: { $in: ['held', 'release_requested', 'releasing'] } }),
      Batch.distinct('fileName', { dvDealerId: s.dv }).then((x) => x.length),
    ]);
    return { dv: s.dv, files: s.files, first: s.first || null, last: s.last || null, types: [...s.types].sort(),
      linked: linked ? { id: String(linked._id), name: linked.name } : null, held, imported };
  }));
  return Response.json({ storage_error: storageError, stores: stores.sort((a, b) => a.dv.localeCompare(b.dv)),
    dealers: dealers.map((d) => ({ id: String(d._id), name: d.name || 'Unnamed dealer', dv: d.dv_dealer_id || null })) });
}

export async function PUT(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const b = await req.json().catch(() => ({}));
  if (!mongoose.isValidObjectId(b?.dealer_id)) return fail('Pick a dealer', 400);
  const dv = String(b?.dv || '').trim().toUpperCase();
  if (dv && !DV.test(dv)) return fail('A DealerVault ID looks like DVD12345', 400);
  if (dv) {
    const taken = await User.findOne({ type: 'dealer', dv_dealer_id: dv, _id: { $ne: b.dealer_id } }).select('name').lean();
    if (taken) return fail(`${dv} is already linked to ${taken.name}. Unlink it there first.`, 409);
  }
  const res = await User.updateOne({ _id: b.dealer_id, type: 'dealer', parent_id: null }, dv ? { $set: { dv_dealer_id: dv } } : { $unset: { dv_dealer_id: '' } });
  if (!res.matchedCount) return fail('Dealer not found', 404);
  console.info('[dms-feed] DealerVault link changed', { dealer_id: b.dealer_id, dv: dv || null, by: access.user?.name || 'Super admin' });
  return Response.json({ ok: true });
}

export async function POST(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const b = await req.json().catch(() => ({}));
  const dv = String(b?.dv || '').trim().toUpperCase();
  if (b?.action !== 'import_stored' || !DV.test(dv)) return fail('action import_stored and a DealerVault ID are required', 400);
  const dealer = await User.findOne({ type: 'dealer', dv_dealer_id: dv }).select('_id name').lean();
  if (!dealer) return fail(`Link ${dv} to a dealer first`, 409);
  const files = (await storedFiles()).filter((f) => f.dv === dv && IMPORTABLE.has(f.type));
  const done = new Set(await Batch.distinct('fileName', { dvDealerId: dv }));
  const by = access.user?.name || 'Super admin';
  let queued = 0;
  for (const f of files.sort((x, y) => x.fileName.localeCompare(y.fileName))) {
    if (done.has(f.fileName)) continue;
    const res = await HeldFile.updateOne({ fileName: f.fileName, status: { $nin: ['releasing', 'released'] } }, {
      $set: { status: 'release_requested', decided_by_name: by, decided_at: new Date(), dealer_id: String(dealer._id) },
      $setOnInsert: { dvDealerId: dv, fileName: f.fileName, fileType: f.type, bucket: process.env.DEALERVAULT_S3_BUCKET, key: f.key,
        reasons: ['imported from storage after the store was linked'] },
    }, { upsert: true }).catch((e) => (e?.code === 11000 ? { upsertedCount: 0, modifiedCount: 0 } : Promise.reject(e)));
    queued += (res.upsertedCount || 0) + (res.modifiedCount || 0);
  }
  return Response.json({ ok: true, queued, already_imported: done.size, minutes: Math.ceil(queued / 20) });
}
