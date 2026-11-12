// GET /api/reports/source-performance - Betsy's source and sub-source report (app/lib/reporting/sourcePerformance.js),
// behind the Dashboard's "Lead sources" report tag.
//
//   ?dealer_id &start_date &end_date (dealer-local YYYY-MM-DD) &basis=timeframe|current
//   &source &lead_source &assigned_to &actor &appointment_type   (the report filter bar, as /api/reports/kpis)
//   &format=csv | pdf  -> the CSV or PDF download (same rows); otherwise JSON { rows, ... }.
//
// Access: the same as /api/reports/kpis - signed in with access to that dealer, and the 'reports_page' feature visible
// to the caller (super admins, also through "login as"); otherwise 404.
import moment from 'moment-timezone';
import { dealershipName, filtersText, reportRequest } from '../../../lib/reporting/reportAccess.js';
import { BASIS, sourcePerformance, sourcePerformanceCsv } from '../../../lib/reporting/sourcePerformance.js';
import { sourcePerformancePdf } from '../../../lib/reporting/sourcePerformancePdf.js';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET(req) {
  const r = await reportRequest(req, { own: ['basis', 'format'] });
  if (r.response) return r.response;
  const { dealerId, tz, spec, filters, params: p } = r;
  const basis = p.get('basis') || BASIS.TIMEFRAME;
  if (!Object.values(BASIS).includes(basis)) {
    return json({ message: `basis must be ${Object.values(BASIS).join(' or ')}` }, 400);
  }

  let report;
  try {
    report = await sourcePerformance({ dealerId, from: spec.from, to: spec.to, tz, spec }, { basis });
  } catch (error) {
    console.error('[reports] source-performance failed:', error);
    return json({ message: 'This report could not be built.' }, 500);
  }

  const format = p.get('format');
  if (format === 'csv' || format === 'pdf') {
    const fmt = (d) => moment(d, 'YYYY-MM-DD').format('M/D/YYYY');
    const opts = { company: await dealershipName(dealerId), from: fmt(spec.from), to: fmt(spec.to ?? spec.from),
      generated: `${moment().tz(tz).format('M/D/YYYY h:mm:ss A')} (${tz})`, filters: filtersText(filters) };
    if (format === 'pdf') {
      let pdf;
      try {
        pdf = await sourcePerformancePdf(report, opts);
      } catch (error) {
        console.error('[reports] source-performance pdf failed:', error);
        return json({ message: 'The PDF could not be built.' }, 500);
      }
      const pdfName = `source-sub-source_${spec.from}_${spec.to ?? spec.from}_${basis}.pdf`;
      return new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfName}"`, 'Cache-Control': 'no-store' } });
    }
    const csv = sourcePerformanceCsv(report, opts);
    const name = `source-sub-source_${spec.from}_${spec.to ?? spec.from}_${basis}.csv`;
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  }
  return json({ dealer_id: dealerId, tz, range: { from: spec.from, to: spec.to }, filters,
    unsupported: r.unsupported, generated: new Date().toISOString(), ...report });
}
