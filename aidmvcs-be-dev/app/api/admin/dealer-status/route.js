// Super admin: pause, deactivate or reactivate a dealership (app/lib/dealerAccountStatus.js; Betsy, 25 Nov 2026).
//   POST { dealer_id, state: 'active' | 'paused' | 'deactivated', reason }   reason required to pause / deactivate
//   -> { ok, state }
// Errors: 401 · 403 not a super admin · 400 bad request · 404 dealership not found.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import { requireSuperAdmin } from '@lib/apiGuard';
import { setDealershipState } from '@lib/dealerAccountStatus';

export const runtime = 'nodejs';

export async function POST(req) {
  await dbConnect();
  const guard = await requireSuperAdmin(req);
  if (guard.response) return guard.response;
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'The request body must be JSON' }, { status: 400 }); }
  if (!mongoose.isValidObjectId(body?.dealer_id)) return Response.json({ error: 'dealer_id is not valid' }, { status: 400 });
  const res = await setDealershipState({ dealerId: body.dealer_id, state: body.state, reason: body.reason,
    byName: guard.user.name || 'AutoPulse admin' });
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status || 400 });
  return Response.json({ ok: true, state: res.state });
}
