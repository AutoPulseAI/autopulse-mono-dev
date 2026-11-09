// Appointments made, by who made them, for the dealer dashboard's admin section (P1 plan item 3 display):
// AI / AI-assisted / human-only / unknown from app/lib/reporting/appointmentAttribution.js, bookings created on the
// picked dealer-local days (the same basis as the "Appointments Made" card). The existing cards are unchanged.
// GET ?dealer_id=&start_date=&end_date=. Access and visibility: ../reply-cohorts/reportAccess.js (feature
// 'appointment_attribution'). Counts only; no booking rows.
import { attributeAppointments } from "../../../lib/reporting/appointmentAttribution.js";
import { json, reportRequest } from "../reply-cohorts/reportAccess.js";

export async function GET(req) {
  try {
    const r = await reportRequest(req, "appointment_attribution");
    if (r.response) return r.response;
    const report = await attributeAppointments({ dealerId: r.dealerId, from: r.from, to: r.to, basis: "created",
      tz: r.tz });
    return json({ dealer_id: report.dealer_id, tz: report.tz, basis: report.basis, range: report.range,
      definitions_version: report.definitions_version, as_of: report.as_of, totals: report.totals,
      excluded_duplicates: report.excluded.duplicates.length });
  } catch (error) {
    if (error?.errors) return json({ error: error.message }, 400);
    console.error("appointment-split report failed:", error?.message || error);
    return json({ error: "Could not build the report" }, 500);
  }
}
