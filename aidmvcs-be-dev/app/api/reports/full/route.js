// GET /api/reports/full - the Dashboard's "Download report": every report for the picked dates in one CSV
// (app/lib/reporting/fullReport.js).
//
//   ?dealer_id &start_date &end_date (dealer-local YYYY-MM-DD) [&source &lead_source &assigned_to &actor
//   &appointment_type]
//
// Access: the same as /api/reports/kpis - signed in with access to that dealer, and the 'reports_page' feature visible
// to the caller (super admins, also through "login as"); otherwise 404.
import moment from 'moment-timezone';
import { dealershipName, filtersText, reportRequest } from '../../../lib/reporting/reportAccess.js';
import { fullReport, fullReportCsv } from '../../../lib/reporting/fullReport.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const r = await reportRequest(req);
  if (r.response) return r.response;
  const { dealerId, tz, spec, filters } = r;
  const to = spec.to ?? spec.from;
  let report;
  try {
    report = await fullReport({ dealerId, from: spec.from, to, tz, spec });
  } catch (error) {
    console.error('[reports] full report failed:', error);
    return new Response(JSON.stringify({ message: 'The report could not be built.' }), { status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  const fmt = (d) => moment(d, 'YYYY-MM-DD').format('M/D/YYYY');
  const csv = fullReportCsv(report, { company: await dealershipName(dealerId), from: fmt(spec.from), to: fmt(to),
    generated: `${moment().tz(tz).format('M/D/YYYY h:mm:ss A')} (${tz})`, filters: filtersText(filters) });
  return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="dealership-report_${spec.from}_${to}.csv"`,
    'Cache-Control': 'no-store' } });
}
