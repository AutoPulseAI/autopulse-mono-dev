// Admin > Integration health (super admin; SOW Deliverable G, G-058: "integration health screen showing source, last
// successful sync, last error, backlog/exception count and actionable diagnostics; do not rebuild connectors").
// Read-only, from what each connector already records - nothing is retried or changed here.
//   GET -> { generated_at, thresholds, dealers: [{ id, name, timezone, checks: { <source>: { state, last_ok, detail,
//          counts, fix } } }] }   state: 'ok' | 'warn' | 'error' | 'none' (not used by this dealer)
// Sources: DMS feed (DealerVault batches + held files), lead emails (ADF payloads, leads received), texts (Twilio sends),
// emails (sends), AI service (events waiting in ai_event_outbox), inventory feed (vehicles), daily email (deliveries).
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import User from '@models/User';
import Lead from '@models/Lead';
import Email from '@models/Email';
import Vehicle from '@models/Vehicle';
import RawAdfPayload from '@models/RawAdfPayload';
import Batch from '@models/DealerVaultImportBatch';
import HeldFile from '@models/DealerVaultHeldFile';
import { requireSuperAdmin } from '@lib/apiGuard';
import { AI_OUTBOX_COLLECTION } from '@lib/ai/aiOutbox';
import { heartbeatStatus } from '@lib/cronHeartbeat';

export const runtime = 'nodejs';
const H = 3600e3;
// When a source is flagged. Shown on the page, so nobody has to guess why a cell is yellow or red.
const THRESHOLDS = Object.freeze({
  dms_quiet_hours: 48, leads_quiet_hours: 48, inventory_quiet_hours: 48, failed_send_share: 0.2, ai_backlog_minutes: 30,
});

const byDealer = (rows) => new Map(rows.map((r) => [String(r._id), r]));

export async function GET(req) {
  await dbConnect();
  const guard = await requireSuperAdmin(req);
  if (guard.response) return guard.response;
  const now = new Date();
  const day = new Date(now - 24 * H); const week = new Date(now - 7 * 24 * H);
  const dealers = await User.find({ type: 'dealer', parent_id: null }).select('name timezone dealer_account_information.store_name').lean();
  const ids = dealers.map((d) => String(d._id));
  const forms = [...ids, ...ids.map((i) => new mongoose.Types.ObjectId(i))];

  const [dmsOk, dmsFailed, held, adf, leads, sms, mail, outbox, cars, daily] = await Promise.all([
    Batch.aggregate([{ $match: { dealer_id: { $in: ids }, status: { $in: ['completed', 'completed_with_errors'] } } },
      { $group: { _id: '$dealer_id', last: { $max: '$completedAt' }, last_id: { $max: '$_id' } } }]),
    Batch.aggregate([{ $match: { dealer_id: { $in: ids }, status: 'failed', _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(week.getTime() / 1000)) } } },
      { $group: { _id: '$dealer_id', n: { $sum: 1 }, last_error: { $last: '$error_code' } } }]),
    HeldFile.aggregate([{ $match: { dealer_id: { $in: ids }, status: { $in: ['held', 'release_requested'] } } }, { $group: { _id: '$dealer_id', n: { $sum: 1 } } }]),
    RawAdfPayload.aggregate([{ $match: { dealer_id: { $in: ids } } }, { $group: { _id: '$dealer_id', last: { $max: '$createdAt' } } }]),
    Lead.aggregate([{ $match: { dealer_id: { $in: forms } } }, { $group: { _id: { $toString: '$dealer_id' }, last: { $max: '$createdAt' } } }]),
    Email.aggregate([{ $match: { dealer_id: { $in: ids }, communication_type: 'sms', timestamp: { $gte: day }, status: { $nin: ['received', 'incoming', 'note', 'draft'] } } },
      { $group: { _id: '$dealer_id', sent: { $sum: 1 }, failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'undelivered', 'error']] }, 1, 0] } }, last: { $max: '$timestamp' } } }]),
    Email.aggregate([{ $match: { dealer_id: { $in: ids }, communication_type: 'email', timestamp: { $gte: day }, status: { $nin: ['received', 'incoming', 'note', 'draft'] } } },
      { $group: { _id: '$dealer_id', sent: { $sum: 1 }, failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced', 'error']] }, 1, 0] } }, last: { $max: '$timestamp' } } }]),
    mongoose.connection.collection(AI_OUTBOX_COLLECTION).aggregate([{ $match: { dealer_id: { $in: forms }, status: 'pending' } },
      { $group: { _id: { $toString: '$dealer_id' }, n: { $sum: 1 }, oldest: { $min: '$created_at' } } }]).toArray().catch(() => []),
    Vehicle.aggregate([{ $match: { dealerId: { $in: ids }, removedAt: null } }, { $group: { _id: '$dealerId', n: { $sum: 1 }, last: { $max: '$updatedAt' } } }]),
    mongoose.connection.collection('daily_report_deliveries').aggregate([{ $match: { dealer_id: { $in: forms } } }, { $sort: { _id: -1 } },
      { $group: { _id: { $toString: '$dealer_id' }, status: { $first: '$status' }, date: { $first: '$report_date' }, error: { $first: '$last_error' } } }]).toArray().catch(() => []),
  ]);
  const M = { dmsOk: byDealer(dmsOk), dmsFailed: byDealer(dmsFailed), held: byDealer(held), adf: byDealer(adf), leads: byDealer(leads),
    sms: byDealer(sms), mail: byDealer(mail), outbox: byDealer(outbox), cars: byDealer(cars), daily: byDealer(daily) };
  const age = (d) => (d ? (now - new Date(d)) / H : Infinity);
  const sendCheck = (r, what) => {
    if (!r) return { state: 'none', detail: `No ${what} sent in the last 24 hours` };
    const share = r.sent ? r.failed / r.sent : 0;
    return { state: share > THRESHOLDS.failed_send_share ? 'error' : r.failed ? 'warn' : 'ok', last_ok: r.last,
      counts: { sent_24h: r.sent, failed_24h: r.failed },
      detail: `${r.sent} sent, ${r.failed} failed in 24 h`,
      fix: r.failed ? `Open a failed ${what === 'texts' ? 'text' : 'email'} on the lead to see the provider's reason` : null };
  };

  const rows = dealers.map((d) => {
    const id = String(d._id);
    const ok = M.dmsOk.get(id); const bad = M.dmsFailed.get(id); const held = M.held.get(id);
    const dmsLast = ok?.last || (ok?.last_id ? ok.last_id.getTimestamp() : null);
    const dms = !ok && !bad && !held ? { state: 'none', detail: 'No DealerVault feed for this store' }
      : { state: bad || held ? 'error' : age(dmsLast) > THRESHOLDS.dms_quiet_hours ? 'warn' : 'ok', last_ok: dmsLast,
        counts: { failed_7d: bad?.n || 0, held: held?.n || 0 },
        detail: `${bad?.n || 0} failed file(s) in 7 days, ${held?.n || 0} held${bad?.last_error ? ` · last error ${bad.last_error}` : ''}`,
        fix: bad || held ? 'Admin > DMS feed: open the failed or held file' : age(dmsLast) > THRESHOLDS.dms_quiet_hours ? 'No file in 2 days: ask DealerVault whether the feed is running' : null };
    const lastAdf = M.adf.get(id)?.last; const lastLead = M.leads.get(id)?.last;
    const leadsCheck = !lastLead && !lastAdf ? { state: 'none', detail: 'No leads yet' }
      : { state: age(lastLead) > THRESHOLDS.leads_quiet_hours ? 'warn' : 'ok', last_ok: lastLead,
        detail: `Last lead ${lastLead ? new Date(lastLead).toISOString() : 'never'}; last lead email (ADF) ${lastAdf ? new Date(lastAdf).toISOString() : 'never'}`,
        fix: age(lastLead) > THRESHOLDS.leads_quiet_hours ? "No lead in 2 days: check the dealer's lead email forwarding" : null };
    const ob = M.outbox.get(id);
    const waitMin = ob ? (now - new Date(ob.oldest)) / 60000 : 0;
    const ai = !ob ? { state: 'ok', detail: 'Nothing waiting for the AI service' }
      : { state: waitMin > THRESHOLDS.ai_backlog_minutes ? 'error' : 'warn', counts: { waiting: ob.n },
        detail: `${ob.n} event(s) waiting, oldest ${Math.round(waitMin)} min`, fix: waitMin > THRESHOLDS.ai_backlog_minutes ? 'The AI service is not taking events: check pm2 agentic-upsell / agentic-worker' : null };
    const car = M.cars.get(id);
    const inventory = !car ? { state: 'none', detail: 'No inventory feed' }
      : { state: age(car.last) > THRESHOLDS.inventory_quiet_hours ? 'warn' : 'ok', last_ok: car.last, counts: { vehicles: car.n },
        detail: `${car.n} vehicles in stock`, fix: age(car.last) > THRESHOLDS.inventory_quiet_hours ? 'Inventory not updated in 2 days: check the feed' : null };
    const dl = M.daily.get(id);
    const daily = !dl ? { state: 'none', detail: 'Daily email not sent for this store' }
      : { state: dl.status === 'sent' ? 'ok' : dl.status === 'failed' ? 'error' : 'warn',
        detail: `${dl.date}: ${dl.status}${dl.error ? ` · ${String(dl.error).slice(0, 120)}` : ''}`,
        fix: dl.status === 'failed' ? 'Admin > Report Cron: see the delivery log' : null };
    return { id, name: d.dealer_account_information?.store_name || d.name || 'Unnamed dealer', timezone: d.timezone || null,
      checks: { dms, leads: leadsCheck, texts: sendCheck(M.sms.get(id), 'texts'), emails: sendCheck(M.mail.get(id), 'emails'),
        ai, inventory, daily_email: daily } };
  });
  const rank = { error: 0, warn: 1, ok: 2, none: 3 };
  const worst = (r) => Math.min(...Object.values(r.checks).map((c) => rank[c.state]));
  rows.sort((a, b) => worst(a) - worst(b) || a.name.localeCompare(b.name));
  // The server's scheduled jobs (20 Nov 2026): when each one's call last reached the app (lib/cronHeartbeat.js).
  const schedulers = await heartbeatStatus(now).catch(() => []);
  // Settings every link and call depends on: set or not (values never shown).
  const config = [['NEXT_PUBLIC_BASE_URL', 'links in emails, texts and campaigns'], ['UPSELL_AGENT_API_URL', 'the CRM reaching the AI service'],
    ['CRON_SECRET', 'scheduled jobs accepted only with the secret']].map(([key, used]) => ({ key, used, set: Boolean(process.env[key]) }));
  return Response.json({ generated_at: now, thresholds: THRESHOLDS, schedulers, config, dealers: rows });
}
