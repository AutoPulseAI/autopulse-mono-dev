// GET /api/reports/kpis - the Reports page (app/dealer/reports; SOW 8 Deliverable F, P1 plan items 1, 4, 5).
//
//   ?dealer_id&dashboard=<executive|appointments|ai|lead_source|bdc|service|data_quality|sales>
//     &start_date&end_date (dealer-local YYYY-MM-DD) &source &lead_source &assigned_to &actor &appointment_type &channel
//       -> every KPI of that tab: value, count, definition, state, breakdowns, trend; plus last_updated. Totals are
//          cached for five minutes per dealer + tab + range + filters (cache.js).
//   A number's records are not listed here: a number tied to leads (leads_link) opens the Leads list,
//   /dealer/leads?report_kpi=<id> (app/api/leads/route.js), whose Export CSV is that list.
//
// Access: signed in with access to that dealer (requireDealerAccess), and the 'reports_page' feature visible to the
// caller (app/lib/reporting/featureFlags.js; super admins, also inside a dealer account through "login as") -
// otherwise 404, so the page doesn't exist for anyone else.
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dbConnect from '../../../lib/mongodb.js';
import User from '../../../models/User.js';
import { requireDealerAccess } from '../../../lib/apiGuard.js';
import { isFeatureVisible } from '../../../lib/reporting/featureFlags.js';
import { REPORTS, describeSpec, parseFilterSpec } from '../../../lib/reporting/filters.js';
import { getDealerTimezone } from '../../../lib/reporting/time.js';
import {
  evaluateKpi, isLeadLinked, kpisForDashboard, listDashboards, listKpis,
} from '../../../lib/reporting/registry.js';
import { cacheGet, cacheKey, cacheSet } from './cache.js';
import { filterOptions } from './options.js';

export const dynamic = 'force-dynamic';

const REPORTS_FEATURE = 'reports_page';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// A super admin, signed in directly or inside this dealer account through "login as" (the token carries
// impersonated_by, app/api/login-as). Same rule as app/lib/apiAuth.js loadSettingsEditor, for the guard's user.
async function isSuperAdmin(req, user) {
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

function summary(def, ev) {
  return {
    id: def.id, label: def.label, dashboard: def.dashboard, grain: def.grain, kind: def.kind, unit: def.unit || null,
    state: ev?.state || def.state, reason: def.reason || ev?.reason || null, proxy: Boolean(def.proxy),
    value: ev?.value ?? null, count: ev?.count ?? null,
    numerator: ev?.numerator || null, denominator: ev?.denominator ? { count: ev.denominator.count } : null,
    denominator_label: def.denominatorLabel || null, leads_link: isLeadLinked(def),
    breakdowns: ev?.breakdowns || {}, trend: ev?.trend || null, ignored_filters: ev?.ignored_filters || [],
    error: ev?.error || null,
    definition: { dateBasis: def.dateBasis, numerator: def.numerator, denominator: def.denominator,
      inclusions: def.inclusions || null, exclusions: def.exclusions, source: def.source, timezone: def.timezone,
      basedOn: def.basedOn || null,
      filters: def.filters || [] },
  };
}

export async function GET(req) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const dealerId = p.get('dealer_id');
  await dbConnect();
  const guard = await requireDealerAccess(req, dealerId);
  if (guard.response) return guard.response;
  const caller = { user: guard.user, superAdmin: await isSuperAdmin(req, guard.user), dealerId };
  if (!isFeatureVisible(REPORTS_FEATURE, caller)) return json({ message: 'Not found' }, 404);

  // The sidebar asks only whether the page is there.
  if (p.get('check') === '1') return json({ visible: true });
  // The Definitions tab: every KPI in the registry, with its written definition.
  if (p.get('definitions') === '1') {
    return json({ dashboards: listDashboards(), kpis: listKpis().map((k) => ({ ...k,
      columns: (k.columns || []).map(([key, label]) => ({ key, label })) })) });
  }
  // The filter bar's choices (sources, lead sources, staff of this dealer).
  if (p.get('options') === '1') return json(await filterOptions(String(dealerId)));

  const tz = await getDealerTimezone(dealerId);
  const input = new URLSearchParams(p);
  for (const k of ['dealer_id', 'dashboard']) input.delete(k);
  if (p.get('start_date')) input.set('from', p.get('start_date'));
  if (p.get('end_date')) input.set('to', p.get('end_date'));
  input.delete('start_date');
  input.delete('end_date');
  const parsed = parseFilterSpec(input, { report: REPORTS.KPI_REPORTS, tz });
  if (!parsed.ok) return json({ message: 'Invalid filters', errors: parsed.errors }, 400);
  const { spec } = parsed;
  const args = { dealerId: String(dealerId), from: spec.from, to: spec.to, tz, spec };
  const filters = describeSpec(spec);
  delete filters.basis;

  const dashboard = p.get('dashboard');
  if (!listDashboards().some((d) => d.id === dashboard)) {
    return json({ message: `dashboard must be one of: ${listDashboards().map((d) => d.id).join(', ')}` }, 400);
  }
  const key = cacheKey({ dealerId: String(dealerId), dashboard, from: spec.from, to: spec.to, filters });
  const hit = await cacheGet(key);
  if (hit) return json({ ...hit, cached: true });

  const ctx = {};
  const kpis = [];
  let failed = false;
  for (const def of kpisForDashboard(dashboard)) {
    let ev = null;
    try {
      ev = await evaluateKpi(def.id, args, ctx);
    } catch (error) {
      console.error(`[reports] ${def.id} failed:`, error);
      failed = true;
      ev = { state: 'error', error: 'This number could not be computed.' };
    }
    kpis.push(summary(def, ev));
  }
  const body = {
    dealer_id: String(dealerId), dashboard, tz, range: { from: spec.from, to: spec.to }, filters,
    unsupported: parsed.unsupported, last_updated: new Date().toISOString(), kpis,
  };
  if (!failed) await cacheSet(key, body);
  return json({ ...body, cached: false });
}
