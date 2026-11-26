// Admin > DMS feed, the three tabs (super admin; 24 Nov 2026; lib/dealervault/feedViews.js).
//   GET ?view=stores&q=                                  store picker (20)
//   GET ?view=needs&dv=&type=&days=                      Needs you: { groups: [{ kind, count, stores, held? }] }
//   GET ?view=needs&kind=&dv=&type=&days=&page=          one group's rows (25 a page)
//   GET ?view=health&q=&status=&type=&page=              Feed health: stores (25 a page), problem stores first
//   GET ?view=files&dv=&type=&days=&page=                one store's files of one type, exact counts
//   GET ?view=rows&file=&outcome=&page=                  the rows of one file with one outcome
//   GET ?view=lookup&q=&dv=                              customers matching a name, phone, email, DMS number, RO, deal or VIN
//   GET ?view=customer&id=                               one customer's field history
//   POST { action: 'resolve', customer_id, field, choice: 'accept'|'keep' }   decide a value waiting for review
//   POST { action: 'confirm'|'dispute', customer_id, field, value }      staff confirm a value / record the customer disputes it
//   from / to (YYYY-MM-DD) narrow needs, files and the look-up list to those days
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import { requireSuperAdmin } from '@lib/apiGuard';
import { KIND_ORDER, OUTCOMES, TYPES, customerHistory, dayAt, fileRows, health, lookup, markValue, needsRows, needsYou, resolveValue, scopeOf,
  storeFiles, storeSearch } from '@lib/dealervault/feedViews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fail = (error, status = 400) => Response.json({ error }, { status });
const DV = /^[A-Za-z0-9-]{1,64}$/;

export async function GET(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const p = new URL(req.url).searchParams;
  const dv = p.get('dv') && DV.test(p.get('dv')) ? p.get('dv') : null;
  switch (p.get('view')) {
    case 'stores': return Response.json({ stores: await storeSearch(p.get('q') || '') });
    case 'needs': {
      const scope = await scopeOf({ dv, type: p.get('type'), from: p.get('from'), to: p.get('to') });
      if (p.get('kind')) {
        if (!KIND_ORDER.includes(p.get('kind'))) return fail('Unknown kind');
        return Response.json(await needsRows(p.get('kind'), scope, p.get('page')));
      }
      return Response.json({ groups: await needsYou(scope) });
    }
    case 'health': return Response.json(await health({ q: p.get('q') || '', status: p.get('status') || '', type: TYPES.includes(p.get('type')) ? p.get('type') : '', page: p.get('page') }));
    case 'files':
      if (!dv || !TYPES.includes(p.get('type'))) return fail('dv and type are required');
      return Response.json(await storeFiles({ dv, type: p.get('type'), page: p.get('page'), from: dayAt(p.get('from')), to: dayAt(p.get('to'), true) }));
    case 'rows':
      if (!p.get('file') || !OUTCOMES.includes(p.get('outcome'))) return fail('file and outcome are required');
      return Response.json(await fileRows({ file: String(p.get('file')).slice(0, 200), outcome: p.get('outcome'), page: p.get('page') }));
    case 'lookup': return Response.json(await lookup({ q: p.get('q'), dv, from: dayAt(p.get('from')), to: dayAt(p.get('to'), true) }));
    case 'customer': {
      const c = await customerHistory(p.get('id'));
      return c ? Response.json(c) : fail('Customer not found', 404);
    }
    default: return fail('Unknown view');
  }
}

export async function POST(req) {
  const access = await requireSuperAdmin(req);
  if (access.response) return access.response;
  await dbConnect();
  const b = await req.json().catch(() => ({}));
  if (['confirm', 'dispute'].includes(b?.action)) {
    if (!mongoose.isValidObjectId(b?.customer_id) || !b?.field || b?.value == null) return fail('customer_id, field and value are required');
    return Response.json(await markValue({ customerId: String(b.customer_id), field: String(b.field).slice(0, 80), value: b.value, action: b.action, who: access.user }));
  }
  if (b?.action !== 'resolve' || !mongoose.isValidObjectId(b?.customer_id) || !b?.field || !['accept', 'keep'].includes(b?.choice)) {
    return fail('action resolve, customer_id, field and choice (accept / keep) are required');
  }
  return Response.json(await resolveValue({ customerId: new mongoose.Types.ObjectId(String(b.customer_id)), field: String(b.field).slice(0, 80), action: b.choice, who: access.user }));
}
