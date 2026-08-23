// services/followupService.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dbConnect from './mongodb.js';

import User from '../models/User.js';
import Lead from '../models/Lead.js';
import FollowUpJob from '../models/FollowUpJob.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// clear all pending jobs for a lead (or a single rule on that lead)
export async function clearPendingJobs(leadId, ruleId = null) {
  const filter = { leadId, status: 'pending' };
  //if (ruleId) filter.ruleId = ruleId;
  const result = await FollowUpJob.deleteMany(filter);
  console.log(`Cleared ${result.deletedCount} pending follow-up jobs for lead ${leadId}`);
  return { success: true, deleted: result.deletedCount };
}

// schedule a single follow‑up (runIndex) for one lead+rule
async function scheduleNext(lead, rule, runIndex, baseTs = null) {
  const DAY_MS     = 24 * 60 * 60 * 1000;
  const intervalMs = (rule.frequencyValue || 1) * DAY_MS;
  const windowEnd  = lead.statusChangedAt.getTime() +
                     ((rule.stopAfter || 120) * DAY_MS);

  const startTs    = baseTs != null
    ? baseTs
    : Date.now();

    console.log(startTs,runIndex,intervalMs)
  const nextRunTs  = startTs + 1* intervalMs;
  if (nextRunTs > windowEnd) return;       // past stopAfter
  // Allow same-day followups by allowing a small buffer (5 minutes) for scheduling
  // This ensures followups scheduled for today can still be created
  const now = Date.now();
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer
  if (nextRunTs <= (now - BUFFER_MS)) return;     // no past dates (with buffer)

  // clear any old PENDING for this rule
  await clearPendingJobs(lead._id, rule.id);
  console.log(nextRunTs);
  // create the one next job, **including runIndex**
  await FollowUpJob.create({
    leadId:      lead._id,
    ruleId:      rule.id,
    dealer_id:   lead.dealer_id,
    runIndex,                   // <--- persist this
    status:      'pending',
    scheduledAt: new Date(nextRunTs),
    createdAt:   new Date(),
  });
}

/**
 * Call when a lead’s status is changed/Set.
 * - Clears all old jobs for that lead
 * - Stamps statusChangedAt
 * - Schedules runIndex=1 for each matching rule
 */
export async function onLeadStatusChange(leadId) {
  await dbConnect();
  const lead = await Lead.findById(leadId);
  if (!lead) throw new Error('Lead not found');

  // wipe out old jobs...
  //await clearPendingJobs(lead._id);

  // record when the status was set
  lead.statusChangedAt = new Date();
  await lead.save();

  // fetch dealer rules
  
  const dealer = await User.findById(lead.dealer_id).lean();
  
  if (!dealer?.setting?.rules?.length) return;
  const statusConfig = {
    "Contacted": ["First Response Sent", "Contacted", "Follow-up communication Sent", "No Follow-up Needed", "Visit Requested", "Visit Suggested","First Response Sent for ADF Phone Lead"],
    "Appointment Booked": ["Visit Booked", "Appointment Booked"],
    "Visited": ["Visit Done", "Visited"],
    "Managerial Review": ["Declined", "Lead Closed Due to Time", "Managerial Review","DND"],
    "Sold": ["Deal Closed", "Sold"],
    "Lead": ["New", "Lead","ADF Lead"]
  };
  //const lead_key = Object.keys(statusConfig).find(key => statusConfig[key].includes(lead.fe_lead_status));
  const lead_key = lead.fe_lead_status;
  // for each active rule matching this new status, schedule the first run
  dealer.setting.rules
    .filter(r => r.active && r.leadStatus === lead_key)
    .forEach(r => scheduleNext(lead, r, 1));
}

/**
 * Call after you actually send/receive a follow‑up.
 * - Removes the job that just fired
 * - Schedules the next one (runIndex+1)
 */
export async function onFollowUpCompleted(jobRecord) {
  await dbConnect();

  const { _id, leadId, ruleId, runIndex, scheduledAt } = jobRecord;

  // 1) mark this job done
  await FollowUpJob.updateOne(
    { _id },
    { $set: { status: 'completed', executedAt: new Date() } }
  );

  // 2) fetch fresh data
  const lead   = await Lead.findById(leadId);
  if (!lead) return;
  const dealer = await User.findById(lead.dealer_id).lean();
  const rule   = dealer?.setting?.rules.find(r => r.id === ruleId);
  if (!rule) return;

  // 3) chain the very next follow-up, using this job’s scheduledAt as baseline
  await scheduleNext(lead, rule, runIndex + 1, Date.now());
}


export async function onFollowUpEvent(jobRecord) {
  const {  leadId, ruleId, runIndex, scheduledAt } = jobRecord;

  // 1) mark this job done
  //await clearPendingJobs(leadId, ruleId);

  // 2) fetch fresh data
  const lead   = await Lead.findById(leadId);
  if (!lead) return;
  const dealer = await User.findById(lead.dealer_id).lean();
  const rule   = dealer?.setting?.rules.find(r => r.id === ruleId);
  if (!rule) return;
  console.log( jobRecord.scheduledAt.getTime());
  // 3) chain the very next follow-up, using this job’s scheduledAt as baseline
  await scheduleNext(lead, rule, runIndex, Date.now());
}