#!/usr/bin/env node
// Manual testing against a running `make crm-local`: play the customer and move time forward, then watch the
// result in the CRM (http://localhost:3100/dealer) or with `show`. Nothing real is sent: the local stack stubs
// Twilio and email (messages are recorded in the CRM conversation and in dev_provider_outbox).
//
//   node scripts/try-ai.mjs lead <source> "<name>" "<comments>" [sms|email]   new lead, as the CRM's lead intake would
//   node scripts/try-ai.mjs text <phone> "<message>"                          the customer texts the dealer
//   node scripts/try-ai.mjs show <phone>                                       the lead's stage and conversation
//   node scripts/try-ai.mjs clock +3h | +2d | +45m                             move the AI's clock forward
//   node scripts/try-ai.mjs clock 10:00                                        jump to the next weekday 10:00 dealer time
//   node scripts/try-ai.mjs clock reset                                        back to real time
//   node scripts/try-ai.mjs status <phone> "<CRM status>" [manager outcome]    staff change the lead status
//
// <source> examples: "Capital One" (credit bucket), "KBB Instant Cash Offer" (trade-in), "CarGurus" (general),
// "Service Department" (service). Phones: use 217555xxxx (Illinois, never a real number).

import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import jwt from 'jsonwebtoken';

const MONGODB_URI = process.env.CRM_LOCAL_MONGODB_URI || 'mongodb://localhost:27018/autopulse_local';
const PLATFORM = process.env.PLATFORM_URL || 'http://localhost:3100';
const AI = process.env.AI_URL || 'http://localhost:8110';
const REDIS = { host: 'localhost', port: Number(process.env.CRM_LOCAL_REDIS_PORT || 6380),
  db: Number(process.env.CRM_LOCAL_REDIS_DB || 4) };

const { DEMO_DEALER_ID, DEMO_DEALER_SMS } = await import('./seed-local-crm.js');

const e164 = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : `+${d}`;
};

async function db() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3_000 });
  return mongoose.connection.db;
}

async function leadFor(phone) {
  const digits = e164(phone).slice(2);
  return (await db()).collection('leads').find({ dealer_id: DEMO_DEALER_ID, phone: { $regex: `${digits}$` } })
    .sort({ _id: -1 }).limit(1).next();
}

async function lead(source, name, comments, channel = 'sms') {
  const n = Date.now().toString().slice(-4);
  const phone = `+1217555${n}`;
  const email = `${String(name).toLowerCase().replace(/\W+/g, '.')}.${n}@example.test`;
  const dealer = await (await db()).collection('users').findOne({ _id: new mongoose.Types.ObjectId(DEMO_DEALER_ID) });
  const queue = new Queue('leadProcessingQueue', { connection: REDIS });
  await queue.add('processLead', {
    leadData: { name, phone, email, source, lead_source: source, followup_preference: channel, comments,
      dealer_id: DEMO_DEALER_ID },
    action: 'create', dealer, jobData: { currentSMS: { mail_content: comments, dealer_id: DEMO_DEALER_ID } },
  }, { attempts: 1 });
  await queue.close();
  console.log(`Lead queued: ${name} <${email}> ${phone} from "${source}" (${channel}).`);
  console.log(`Next: node scripts/try-ai.mjs show ${phone}   (give it a few seconds for the AI's first reply)`);
}

async function text(phone, body) {
  const form = new URLSearchParams({ From: e164(phone), To: DEMO_DEALER_SMS, Body: body,
    MessageSid: `SMtry${Math.random().toString(16).slice(2, 12)}`, AccountSid: 'ACtry', NumMedia: '0',
    SmsStatus: 'received' });
  const r = await fetch(`${PLATFORM}/api/system/sms`, { method: 'POST', body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  console.log(`Customer ${e164(phone)} texted "${body}" -> HTTP ${r.status}. Run "show ${phone}" in a few seconds.`);
}

async function show(phone) {
  const l = await leadFor(phone);
  if (!l) return console.log('No lead with that phone for the demo dealer.');
  const d = await db();
  const state = await d.collection('ai_lead_state').findOne({ lead_id: String(l._id) });
  console.log(`${l.name} | CRM status: ${l.fe_lead_status || l.status || '-'} | AI stage: ${state?.stage || '-'}`
    + ` | bucket: ${state?.bucket?.bucket || state?.bucket || '-'} | AI: ${state?.status || '-'}`);
  const msgs = await d.collection('ai_messages').find({ lead_id: String(l._id) }).sort({ created_at: 1 }).toArray();
  for (const m of msgs) {
    const who = m.direction === 'inbound' ? 'CUSTOMER' : m.author === 'staff' ? 'STAFF' : 'AI';
    const when = new Date(m.created_at).toISOString().replace('T', ' ').slice(0, 16);
    console.log(`\n[${when} UTC] ${who} (${m.channel}${m.status ? `, ${m.status}` : ''})\n  ${String(m.text || '').trim()}`);
  }
  const next = await d.collection('scheduled_followups').find({ lead_id: String(l._id), status: 'pending' })
    .sort({ due_at: 1 }).limit(5).toArray();
  if (next.length) console.log('\nScheduled next:');
  for (const f of next) console.log(`  ${new Date(f.due_at).toISOString().slice(0, 16)} UTC  ${f.kind}${f.touch?.touch_number ? ` (touch ${f.touch.touch_number})` : ''}`);
}

async function clock(arg) {
  let r;
  if (arg === 'reset') r = await fetch(`${AI}/dev/clock/reset`, { method: 'POST' });
  else if (/^\d{1,2}:\d{2}$/.test(arg)) {
    r = await fetch(`${AI}/dev/clock/to-dealer-time`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealer_id: DEMO_DEALER_ID, time: arg, weekdays_only: true }) });
  } else {
    const m = /^\+(\d+)([mhd])$/.exec(arg || '');
    if (!m) throw new Error('clock +45m | +3h | +2d | 10:00 | reset');
    const seconds = Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2]];
    r = await fetch(`${AI}/dev/clock/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }) });
  }
  console.log('AI clock now:', await r.text(), '\n(due follow-ups fire within a few seconds; then run show)');
}

async function status(phone, newStatus, outcome) {
  const l = await leadFor(phone);
  if (!l) return console.log('No lead with that phone for the demo dealer.');
  const token = jwt.sign({ userId: DEMO_DEALER_ID, type: 'dealer' },
    process.env.JWT_SECRET || 'autopulse-local-dev-jwt-secret', { expiresIn: '1h' });
  const body = { id: String(l._id), status: newStatus, ...(outcome ? { manager_outcome: outcome } : {}) };
  const r = await fetch(`${PLATFORM}/api/conversations/lead/status`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  console.log(`Status "${newStatus}"${outcome ? ` / ${outcome}` : ''} -> HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'lead') await lead(args[0], args[1] || 'Test Customer', args[2] || 'Interested in a vehicle', args[3]);
  else if (cmd === 'text') await text(args[0], args.slice(1).join(' '));
  else if (cmd === 'show') await show(args[0]);
  else if (cmd === 'clock') await clock(args[0]);
  else if (cmd === 'status') await status(args[0], args[1], args[2]);
  else console.log('Commands: lead | text | show | clock | status  (see the top of scripts/try-ai.mjs)');
} finally {
  await mongoose.disconnect().catch(() => {});
}
