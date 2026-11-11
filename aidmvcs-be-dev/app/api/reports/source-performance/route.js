// GET /api/reports/source-performance - Betsy's source and sub-source report (app/lib/reporting/sourcePerformance.js),
// behind the Dashboard's "Lead sources" report tag.
//
//   ?dealer_id &start_date &end_date (dealer-local YYYY-MM-DD) &basis=timeframe|current
//   &source &lead_source &assigned_to &actor &appointment_type   (the report filter bar, as /api/reports/kpis)
//   &format=csv  -> the CSV download; otherwise JSON { rows, ... }.
//
// Access: the same as /api/reports/kpis - signed in with access to that dealer, and the 'reports_page' feature visible
// to the caller (super admins, also through "login as"); otherwise 404.
import moment from 'moment-timezone';
import dbConnect from '../../../lib/mongodb.js';
import User from '../../../models/User.js';
import { requireDealerAccess } from '../../../lib/apiGuard.js';
import { isFeatureVisible } from '../../../lib/reporting/featureFlags.js';
import { isSuperAdmin } from '../../../lib/reporting/reportAccess.js';
import { REPORTS, describeSpec, parseFilterSpec } from '../../../lib/reporting/filters.js';
import { getDealerTimezone } from '../../../lib/reporting/time.js';
import { BASIS, sourcePerformance, sourcePerformanceCsv } from '../../../lib/reporting/sourcePerformance.js';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const dealerId = p.get('dealer_id');
  await dbConnect();
  const guard = await requireDealerAccess(req, dealerId);
  if (guard.response) return guard.response;
  const caller = { user: guard.user, superAdmin: await isSuperAdmin(req, guard.user), dealerId };
  if (!isFeatureVisible('reports_page', caller)) return json({ message: 'Not found' }, 404);

  const basis = p.get('basis') || BASIS.TIMEFRAME;
  if (!Object.values(BASIS).includes(basis)) {
    return json({ message: `basis must be ${Object.values(BASIS).join(' or ')}` }, 400);
  }
  const tz = await getDealerTimezone(dealerId);
  const input = new URLSearchParams(p);
  for (const k of ['dealer_id', 'basis', 'format', 'start_date', 'end_date']) input.delete(k);
  if (p.get('start_date')) input.set('from', p.get('start_date'));
  if (p.get('end_date')) input.set('to', p.get('end_date'));
  const parsed = parseFilterSpec(input, { report: REPORTS.KPI_REPORTS, tz });
  if (!parsed.ok) return json({ message: 'Invalid filters', errors: parsed.errors }, 400);
  const { spec } = parsed;
  const filters = describeSpec(spec);
  delete filters.basis;

  let report;
  try {
    report = await sourcePerformance({ dealerId: String(dealerId), from: spec.from, to: spec.to, tz, spec }, { basis });
  } catch (error) {
    console.error('[reports] source-performance failed:', error);
    return json({ message: 'This report could not be built.' }, 500);
  }

  if (p.get('format') === 'csv') {
    const dealer = await User.findById(dealerId).select('name dealer_account_information.store_name').lean()
      .catch(() => null);
    const company = String(dealer?.dealer_account_information?.store_name || dealer?.name || 'Dealership');
    const fmt = (d) => moment(d, 'YYYY-MM-DD').format('M/D/YYYY');
    const filterText = Object.entries(filters).filter(([k, v]) => !['from', 'to', 'tz'].includes(k) && v != null && v !== ''
      && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
    const csv = sourcePerformanceCsv(report, { company, from: fmt(spec.from), to: fmt(spec.to ?? spec.from),
      generated: `${moment().tz(tz).format('M/D/YYYY h:mm:ss A')} (${tz})`, filters: filterText });
    const name = `source-sub-source_${spec.from}_${spec.to ?? spec.from}_${basis}.csv`;
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  }
  return json({ dealer_id: String(dealerId), tz, range: { from: spec.from, to: spec.to }, filters,
    unsupported: parsed.unsupported, generated: new Date().toISOString(), ...report });
}
