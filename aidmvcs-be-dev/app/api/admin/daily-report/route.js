// Super admin only: the daily performance email's rollout switch, preview, resend and delivery log
// (app/lib/reports/dailyReport.js).
//
//   GET  ?action=dealers                              every dealer: mode, send time, time zone, who it would go to
//   GET  ?action=preview&dealer_id=<id>&date=YYYY-MM-DD   the email HTML for that day (sends nothing)
//   GET  ?action=deliveries[&dealer_id=<id>][&limit=100]  the delivery log, newest first
//   POST { action: "set-mode", dealer_id, mode: "off" | "internal" | "live" }
//   POST { action: "resend", dealer_id, date }       send that day again to the recipients of the current mode
//                                                    (refused when off); audited via resend_of + requested_by
import mongoose from 'mongoose';
import dbConnect from '../../../lib/mongodb.js';
import { requireSuperAdmin } from '../../../lib/apiGuard.js';
import User from '../../../models/User.js';
import DailyReportDelivery from '../../../models/DailyReportDelivery.js';
import { dealerTimezone } from '../../../lib/reporting/time.js';
import {
  dailyEmailMode, dealerRecipients, internalRecipients, sendTimeFor, yesterdayLocal,
} from '../../../lib/reports/settings.js';
import { previewDailyReport, resendDailyReport, setDailyEmailMode } from '../../../lib/reports/dailyReport.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function describeDealer(dealer, env = process.env) {
  const tz = dealerTimezone(dealer);
  const s = dealer.report_schedule_settings || {};
  return {
    dealer_id: String(dealer._id),
    name: dealer.dealer_account_information?.store_name || dealer.name || '',
    mode: dailyEmailMode(dealer),
    tz,
    send_time: sendTimeFor(dealer),
    live_recipients: dealerRecipients(dealer),
    internal_recipients: internalRecipients(env),
    dealer_reports_enabled: s.enabled === true,
    mode_updated_at: s.daily_email_mode_updated_at || null,
    yesterday: yesterdayLocal(new Date(), tz),
  };
}

export async function GET(req) {
  const auth = await requireSuperAdmin(req);
  if (auth.response) return auth.response;
  await dbConnect();
  const params = new URL(req.url).searchParams;
  const action = params.get('action') || 'dealers';
  const dealerId = params.get('dealer_id');

  if (action === 'dealers') {
    const dealers = await User.find({ type: 'dealer', parent_id: null })
      .select('name email report_schedule_settings dealer_account_information').sort({ name: 1 }).lean();
    return json({ dealers: dealers.map((d) => describeDealer(d)) });
  }

  if (action === 'preview') {
    if (!mongoose.isValidObjectId(dealerId)) return json({ message: 'dealer_id is required' }, 400);
    const result = await previewDailyReport({ dealerId, reportDate: params.get('date') });
    if (!result.ok) return json({ message: result.message }, result.status);
    if (params.get('format') === 'json') {
      return json({ subject: result.subject, html: result.html, text: result.text, mode: result.mode,
        recipients: result.recipients, snapshot_saved: result.snapshot_saved, day_finished: result.day_finished });
    }
    return new Response(result.html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Daily-Report-Subject': encodeURIComponent(result.subject) } });
  }

  if (action === 'deliveries') {
    const filter = {};
    if (dealerId) {
      if (!mongoose.isValidObjectId(dealerId)) return json({ message: 'dealer_id is invalid' }, 400);
      filter.dealer_id = dealerId;
    }
    const limit = Math.min(Math.max(parseInt(params.get('limit') || '100', 10) || 100, 1), 500);
    const rows = await DailyReportDelivery.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return json({ deliveries: rows.map((r) => ({
      id: String(r._id), dealer_id: String(r.dealer_id), report_date: r.report_date, recipient: r.recipient,
      mode: r.mode, status: r.status, attempts: r.attempts, last_error: r.last_error, sent_at: r.sent_at,
      provider_message_id: r.provider_message_id, resend_of: r.resend_of,
      requested_by: r.requested_by ? String(r.requested_by) : null, created_at: r.createdAt,
    })) });
  }

  return json({ message: 'Unknown action. Use dealers, preview or deliveries.' }, 400);
}

export async function POST(req) {
  const auth = await requireSuperAdmin(req);
  if (auth.response) return auth.response;
  await dbConnect();
  let body;
  try { body = await req.json(); } catch { return json({ message: 'JSON body required' }, 400); }
  const { action, dealer_id: dealerId } = body || {};

  if (action === 'set-mode') {
    const result = await setDailyEmailMode({ dealerId, mode: body.mode, updatedBy: auth.user._id });
    if (!result.ok) return json({ message: result.message }, result.status);
    console.log(`[daily-report] mode for dealer ${dealerId} set to ${body.mode} by admin ${auth.user._id}`);
    return json({ success: true, dealer: describeDealer(result.dealer) });
  }

  if (action === 'resend') {
    if (!mongoose.isValidObjectId(dealerId)) return json({ message: 'dealer_id is required' }, 400);
    const result = await resendDailyReport({ dealerId, reportDate: body.date, requestedBy: auth.user._id });
    if (!result.ok) return json({ message: result.message }, result.status);
    console.log(`[daily-report] resend ${result.request_id} dealer ${dealerId} ${body.date} by admin ${auth.user._id}`);
    return json({ success: true, ...result });
  }

  return json({ message: 'Unknown action. Use set-mode or resend.' }, 400);
}
