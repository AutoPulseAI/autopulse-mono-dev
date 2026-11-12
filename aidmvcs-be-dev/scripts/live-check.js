// Live check - READ ONLY (finds and counts only; never writes).
// Run on the web server, after every merge and every morning:
//   cd /var/www/html/autopulse-prod-v2/aidmvcs-be-dev; export URI="$(grep -hE '^MONGODB_URI=' .env* | head -1 | cut -d= -f2- | tr -d '"')"
//   mongosh "$URI" --quiet --file scripts/live-check.js > /tmp/live-check.txt
// Optional: mongosh "$URI" --quiet --eval 'var HOURS=6' --file scripts/live-check.js   (last 6 hours instead of today)
//
// 1. Problems first: overdue / stuck queued follow-ups, open leads with nothing planned (dead zone), unanswered
//    customer messages, safe-template sends, failed turns, failed sends.
// 2. Then every conversation that had a message in the window (or a lead created in it), start to end, to read.

const TZ = 'America/New_York';
const now = new Date();
const since = (typeof HOURS !== 'undefined')
  ? new Date(now.getTime() - HOURS * 3600e3)
  : (() => { // midnight today, New York time
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
    return new Date(now.getTime() - ((+p.hour % 24) * 60 + +p.minute) * 60e3);
  })();
const ny = (d) => (d ? new Date(d).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit' }) : '-');
const utc = (d) => (d ? new Date(d).toISOString().slice(5, 16).replace('T', ' ') : '-');
const when = (d) => `${utc(d)} UTC / ${ny(d)} NY`;
const ids = (xs) => [...new Set(xs.map(String))];
const oidOf = (x) => { try { return ObjectId(String(x)); } catch (e) { return null; } };
const plain = (t, n = 400) => String(t || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const leadName = new Map();
const nameOf = (id) => {
  const k = String(id);
  if (!leadName.has(k)) {
    const l = oidOf(k) && db.leads.findOne({ _id: oidOf(k) }, { name: 1, fe_lead_status: 1 });
    leadName.set(k, l ? `${l.name || '(no name)'} [${l.fe_lead_status || '-'}]` : '(lead not found)');
  }
  return `${leadName.get(k)} ${k}`;
};
const out = (s = '') => print(s);
let problems = 0;
const section = (title, rows, line) => {
  out(`\n=== ${title}: ${rows.length}`);
  rows.slice(0, 200).forEach((r) => out(`  ${line(r)}`));
  if (rows.length > 200) out(`  ... ${rows.length - 200} more`);
  problems += rows.length;
};

out(`LIVE CHECK  ${when(now)}   window from ${when(since)}`);

// --- 1. The follow-up queue -------------------------------------------------------------------------------------
const OPEN = ['pending', 'standby', 'claimed'];
const late = new Date(now.getTime() - 15 * 60e3);
section('Queued follow-ups OVERDUE (pending, due over 15 min ago)',
  db.scheduled_followups.find({ status: 'pending', due_at: { $lt: late } }).sort({ due_at: 1 }).toArray(),
  (f) => `due ${when(f.due_at)}  ${f.kind || '-'}  ${f.to_channel || ''}  ${nameOf(f.lead_id)}`);
section('Queued follow-ups STUCK (claimed over 15 min ago)',
  db.scheduled_followups.find({ status: 'claimed', claimed_at: { $lt: late } }).toArray(),
  (f) => `claimed ${when(f.claimed_at)}  ${f.kind || '-'}  ${nameOf(f.lead_id)}`);
out('\n=== Queue in the window (created, sent or closed), by status:');
db.scheduled_followups.aggregate([{ $match: { $or: [{ created_at: { $gte: since } }, { sent_at: { $gte: since } },
  { closed_at: { $gte: since } }] } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
  .forEach((g) => out(`  ${g._id}: ${g.n}`));
const nextDue = db.scheduled_followups.find({ status: 'pending', due_at: { $gte: now } }).sort({ due_at: 1 }).limit(1)
  .toArray()[0];
out(`  next pending: ${nextDue ? `${when(nextDue.due_at)} ${nextDue.kind}` : 'none'}`);

// --- 2. Dead zone: an open lead the AI follows up, in a working stage, with nothing planned --------------------
// Same rule as the AI's hourly safety net (agentic-upsell scheduler/safety_net.py); listed only when the safety net
// should already have planned it (nothing for over 2 hours).
const settled = new Date(now.getTime() - 2 * 3600e3);
const ninety = new Date(now.getTime() - 90 * 86400e3);
const working = db.ai_lead_state.find({ status: { $in: ['active', 'partly_qualified', 'qualified'] },
  stage: { $in: ['new_lead', 'no_contact_made', 'contact_made_no_next_action'] },
  $or: [{ status_at: { $lt: settled } }, { status_at: null }] }).toArray()
  .filter((s) => (s.opportunity_created_at || s._id.getTimestamp()) > ninety
    && (s.opportunity_created_at || s._id.getTimestamp()) < settled);
const planned = new Set(db.scheduled_followups.distinct('lead_id', { lead_id: { $in: working.map((s) => s.lead_id) },
  status: { $in: OPEN }, kind: { $ne: 'daily_call_task' } }).map(String));
section('DEAD ZONE: open AI leads with nothing planned for over 2 hours',
  working.filter((s) => !planned.has(String(s.lead_id))),
  (s) => `${s.stage} / ${s.status} since ${when(s.status_at)}  ${nameOf(s.lead_id)}`);

// --- 3. The AI's own turns ----------------------------------------------------------------------------------
const turns = db.ai_turn_log.find({ created_at: { $gte: since } }).toArray();
section('SAFE TEMPLATE sent instead of the AI reply', turns.filter((t) => t.outcome === 'fallback'),
  (t) => `${when(t.created_at)}  ${nameOf(t.lead_id)}  customer: "${plain((t.input || {}).text, 120)}"`);
section('TURN FAILED', turns.filter((t) => t.outcome === 'error'),
  (t) => `${when(t.created_at)}  ${nameOf(t.lead_id)}  ${plain((t.result || {}).error, 160)}`);
section('Customer message NOT ANSWERED (over 10 min, AI messages)',
  db.ai_messages.find({ direction: 'inbound', answered_turn_id: null, auto_reply: { $ne: true },
    created_at: { $gte: since, $lt: new Date(now.getTime() - 10 * 60e3) } }).toArray(),
  (m) => `${when(m.created_at)}  ${m.channel}  ${nameOf(m.lead_id)}  "${plain(m.text, 120)}"`);
out(`\n=== AI turns in the window: ${turns.length}   by outcome:`);
const byOutcome = {};
turns.forEach((t) => { byOutcome[t.outcome || '-'] = (byOutcome[t.outcome || '-'] || 0) + 1; });
Object.entries(byOutcome).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => out(`  ${k}: ${n}`));

// --- 4. Messages in the window ------------------------------------------------------------------------------
const msgs = db.emails.find({ timestamp: { $gte: since }, is_note: { $ne: true } }).toArray();
section('FAILED sends', msgs.filter((m) => m.status === 'failed'),
  (m) => `${when(m.timestamp)}  ${m.communication_type}  ${nameOf(m.lead_id)}  "${plain(m.mail_content, 100)}"`);
const who = (m) => (['received', 'incoming'].includes(m.status) ? 'CUSTOMER' : m.ai_generated ? 'AI' : m.message_by
  ? 'STAFF' : 'SYSTEM');
const count = {};
msgs.forEach((m) => { const k = `${who(m)} ${m.communication_type}`; count[k] = (count[k] || 0) + 1; });
out(`\n=== Messages in the window: ${msgs.length}`);
Object.entries(count).sort().forEach(([k, n]) => out(`  ${k}: ${n}`));

out(`\nPROBLEM LINES ABOVE: ${problems}${problems ? '  <- read these first' : '  (none)'}`);

// --- 5. Every conversation, start to end, to read -------------------------------------------------------------
const newLeads = db.leads.find({ createdAt: { $gte: since } }, { _id: 1 }).toArray().map((l) => String(l._id));
const talked = ids([...msgs.map((m) => m.lead_id).filter(Boolean), ...newLeads]);
out(`\n\n######## CONVERSATIONS: ${talked.length} leads (new in the window: ${newLeads.length}) ########`);
talked.forEach((id) => {
  const o = oidOf(id);
  const lead = o && db.leads.findOne({ _id: o });
  if (!lead) return;
  const thread = db.emails.find({ lead_id: { $in: [o, id] } }).sort({ timestamp: 1 }).toArray();
  const state = db.ai_lead_state.findOne({ lead_id: id }) || {};
  const next = db.scheduled_followups.find({ lead_id: id, status: { $in: OPEN } }).sort({ due_at: 1 }).toArray();
  out(`\n----- ${lead.name || '(no name)'}  ${id}`);
  out(`  lead ${when(lead.createdAt)}  status ${lead.fe_lead_status || '-'}  source ${lead.lead_source || lead.source || '-'}`
    + `  phone ${lead.phone ? 'yes' : 'no'}  email ${lead.email ? 'yes' : 'no'}`);
  out(`  AI: ${state.status || 'no state'} / ${state.stage || '-'}   next: ${next.length
    ? next.map((f) => `${f.kind} ${f.to_channel || ''} ${when(f.due_at)}`).join(' | ') : 'NOTHING PLANNED'}`);
  thread.forEach((m) => {
    const tag = m.is_note ? `NOTE${m.internal_use ? ' (internal)' : ''}` : `${who(m)} ${m.communication_type}`
      + `${m.status === 'failed' ? ' FAILED' : ''}`;
    out(`  ${when(m.timestamp)}  ${tag}: ${plain(m.mail_content, 700)}`);
  });
});
out('\nEND');
