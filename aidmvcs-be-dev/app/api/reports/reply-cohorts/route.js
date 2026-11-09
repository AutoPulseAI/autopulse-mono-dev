// Customer replies by lead age for the dealer dashboard (P1 plan item 2, G-043..G-047; F3 design 3.6).
// GET ?dealer_id=&start_date=&end_date=  -> app/lib/reporting/replyCohorts.js for those dealer-local days (counts only;
// each card opens its leads on /dealer/leads?reply_cohort=). Access and visibility: ./reportAccess.js (feature
// 'reply_cohorts').
import { replyCohorts } from "../../../lib/reporting/replyCohorts.js";
import { json, reportRequest } from "./reportAccess.js";

export async function GET(req) {
  try {
    const r = await reportRequest(req, "reply_cohorts");
    if (r.response) return r.response;
    const report = await replyCohorts({ dealerId: r.dealerId, from: r.from, to: r.to, tz: r.tz });
    const { units, rows, ...counts } = report; // eslint-disable-line no-unused-vars
    return json(counts);
  } catch (error) {
    if (error?.errors) return json({ error: error.message }, 400);
    console.error("reply-cohorts report failed:", error?.message || error);
    return json({ error: "Could not build the report" }, 500);
  }
}
