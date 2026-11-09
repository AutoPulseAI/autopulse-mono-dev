// Customer replies by lead age for the dealer dashboard (P1 plan item 2, G-043..G-047; F3 design 3.6).
// GET ?dealer_id=&start_date=&end_date=[&rows=1]  -> app/lib/reporting/replyCohorts.js for those dealer-local days.
// Access and visibility: ./reportAccess.js (feature 'reply_cohorts'). The drill-down rows (customer names) are only
// sent with rows=1.
import mongoose from "mongoose";
import Customer from "../../../models/Customer.js";
import Lead from "../../../models/Lead.js";
import { replyCohorts } from "../../../lib/reporting/replyCohorts.js";
import { json, reportRequest } from "./reportAccess.js";

const isOid = (id) => id != null && /^[0-9a-f]{24}$/i.test(String(id));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// The drill-down table's columns: customer, lead, lead date, reply time, age, channel, handled by, appointment.
async function drillDownRows(rows) {
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(isOid))];
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(isOid))];
  const [leads, customers] = await Promise.all([
    leadIds.length ? Lead.collection.find({ _id: { $in: leadIds.map(oid) } }, { projection: { name: 1 } }).toArray() : [],
    customerIds.length ? Customer.collection.find({ _id: { $in: customerIds.map(oid) } }, { projection: { name: 1 } })
      .toArray() : [],
  ]);
  const leadName = new Map(leads.map((l) => [String(l._id), l.name || null]));
  const customerName = new Map(customers.map((c) => [String(c._id), c.name || null]));
  return rows.map((r) => ({
    email_id: r.email_id,
    customer_key: r.customer_key,
    customer_id: r.customer_id,
    customer_name: (r.customer_id && customerName.get(r.customer_id)) || (r.lead_id && leadName.get(r.lead_id)) || null,
    lead_id: r.lead_id,
    lead_name: (r.lead_id && leadName.get(r.lead_id)) || null,
    lead_received_at: r.lead_received_at,
    reply_at: r.reply_at,
    local_day: r.local_day,
    age_days: r.age_days,
    bucket: r.bucket,
    review_reason: r.review_reason,
    channel: r.channel,
    handler: r.handler,
    has_appointment: r.has_appointment,
    booked_after_reply: r.booked_after_reply,
  })).sort((a, b) => new Date(b.reply_at) - new Date(a.reply_at));
}

export async function GET(req) {
  try {
    const r = await reportRequest(req, "reply_cohorts");
    if (r.response) return r.response;
    const report = await replyCohorts({ dealerId: r.dealerId, from: r.from, to: r.to, tz: r.tz });
    const { units, rows, ...counts } = report;
    if (r.searchParams.get("rows") === "1") return json({ ...counts, rows: await drillDownRows(rows) });
    return json(counts);
  } catch (error) {
    if (error?.errors) return json({ error: error.message }, 400);
    console.error("reply-cohorts report failed:", error?.message || error);
    return json({ error: "Could not build the report" }, 500);
  }
}
