// Who may see the reports: a super admin, signed in directly or inside a dealer account through "login as" (the
// token carries impersonated_by, app/api/login-as). Same rule as app/lib/apiAuth.js loadSettingsEditor, for the
// user requireDealerAccess returned. Used by GET /api/reports/kpis, /api/reports/source-performance and
// /api/reports/full.
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dbConnect from '../mongodb.js';
import User from '../../models/User.js';
import { requireDealerAccess } from '../apiGuard.js';
import { isFeatureVisible } from './featureFlags.js';
import { REPORTS, describeSpec, parseFilterSpec } from './filters.js';
import { getDealerTimezone } from './time.js';

export async function isSuperAdmin(req, user) {
  if (user?.type === 'admin') return true;
  const header = req.headers.get('authorization') || '';
  const tokens = [];
  if (/^Bearer\s+\S+$/.test(header)) tokens.push(header.replace(/^Bearer\s+/, ''));
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (['dealertoken', 'admintoken', 'vendortoken'].includes(name)) tokens.push(decodeURIComponent(rest.join('=')));
  }
  for (const token of tokens) {
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { continue; }
    if (String(decoded?.userId) !== String(user?._id)) continue;
    if (!decoded.impersonated_by || !mongoose.isValidObjectId(decoded.impersonated_by)) continue;
    const by = await User.findById(decoded.impersonated_by).select('_id type').lean();
    if (by?.type === 'admin') return true;
  }
  return false;
}

const json = (body, status) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * A report download request: ?dealer_id &start_date &end_date (dealer-local YYYY-MM-DD) and the report filter bar's
 * filters. Answers { response } when it must stop (not signed in, 404 when the reports are not visible to the caller,
 * 400 bad filters), else { dealerId, tz, spec, filters, unsupported, params }. `own` = this route's own parameters.
 */
export async function reportRequest(req, { own = [] } = {}) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  await dbConnect();
  const guard = await requireDealerAccess(req, dealerId);
  if (guard.response) return { response: guard.response };
  const caller = { user: guard.user, superAdmin: await isSuperAdmin(req, guard.user), dealerId };
  if (!isFeatureVisible('reports_page', caller)) return { response: json({ message: 'Not found' }, 404) };
  const tz = await getDealerTimezone(dealerId);
  const input = new URLSearchParams(params);
  for (const k of ['dealer_id', 'start_date', 'end_date', ...own]) input.delete(k);
  if (params.get('start_date')) input.set('from', params.get('start_date'));
  if (params.get('end_date')) input.set('to', params.get('end_date'));
  const parsed = parseFilterSpec(input, { report: REPORTS.KPI_REPORTS, tz });
  if (!parsed.ok) return { response: json({ message: 'Invalid filters', errors: parsed.errors }, 400) };
  const filters = describeSpec(parsed.spec);
  delete filters.basis;
  return { dealerId: String(dealerId), tz, spec: parsed.spec, filters, unsupported: parsed.unsupported, params };
}

// The filters in words, for a report's header ("" when none).
export function filtersText(filters = {}) {
  return Object.entries(filters).filter(([k, v]) => !['from', 'to', 'tz'].includes(k) && v != null && v !== ''
    && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
}

// The dealership's name for a report's header.
export async function dealershipName(dealerId) {
  const dealer = await User.findById(dealerId).select('name dealer_account_information.store_name').lean()
    .catch(() => null);
  return String(dealer?.dealer_account_information?.store_name || dealer?.name || 'Dealership');
}
