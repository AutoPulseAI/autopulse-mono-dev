// The AI Settings page (app/dealer/ai/settings).
//   GET /api/dealer-ai/settings[?dealer_id=]
//   PUT /api/dealer-ai/settings  { ai_mode?: "off" | "shadow" | "live", mms_enabled?: boolean, dealer_id?,
//                                  booking_capacity?: { sales?: {max_per_slot?, slot_minutes?}, service?: {...} },
//                                  ai_daily_call_tasks?: "on" | "off" }
//
// ai_daily_call_tasks (agentic-upsell PLAN_4 stream T): the Days 1-7 morning + afternoon call tasks, saved to
// dealer_account_information.ai_daily_call_tasks (unset = on); see app/lib/ai/aiCallTasks.js.
//
// booking_capacity (stream R): appointments per slot and slot length, per type, saved to
// dealer_account_information.booking_capacity - read by the CRM's booking check (app/lib/bookingService.js
// capacitySettings) and by the AI (agentic-upsell integrations/dealer_profile.py). 1-50 per slot, 15-240 minutes.
//
// ai_mode is the same per-dealer switch as the admin route (app/api/admin/ai-mode),
// with the same side effects: the cache is cleared, and going live clears the
// dealer's pending rule-based follow-ups so a customer never gets both.
// mms_enabled is stored on the dealer (User.ai_mms_enabled, read with the dealer
// record by the AI service; off unless turned on).
// Opening hours are shown read-only: they are the ones on the dealer's account
// (dealer_account_information.weekly_availability), which the AI uses.
//
// Anyone at the dealership can read these; only an AutoPulse super admin changes them (client, 8 Oct 2026).

import { NextResponse } from "next/server";
import { AI_MODES, effectiveAiMode, invalidateDealerAiMode } from "@lib/ai/aiMode";
import User from "@models/User";
import FollowUpJob from "@models/FollowUpJob";
import "@models/Role";
import "@models/Permission";
import { jsonError, requireDealerSession, staffName } from "../_lib/dealerAi";
import { loadSettingsEditor, SETTINGS_VIEW_ONLY_MESSAGE } from "@lib/apiAuth";
import { bookingCapacityUpdate, bookingCapacityView } from "@lib/bookingService";
import { dailyCallTasksUpdate, dailyCallTasksView } from "@lib/ai/aiCallTasks";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function describe(dealer) {
  const info = dealer?.dealer_account_information || {};
  const weekly = info.weekly_availability || {};
  const hours = WEEKDAYS.map((day) => {
    const d = weekly[day] || {};
    return { day, open: Boolean(d.active), start: d.start || null, end: d.end || null };
  });
  return {
    dealer_id: String(dealer._id),
    name: dealer.name,
    ai_mode: AI_MODES.includes(dealer.ai_mode) ? dealer.ai_mode : "off",
    effective_mode: effectiveAiMode(dealer),
    auto_reply_enabled: dealer.setting?.autoReplyEnabled !== false,
    mms_enabled: dealer.ai_mms_enabled !== false, // unset = on, as the AI service reads it (agent/vehicle_media.py)
    timezone: info.time_zone || null,
    hours,
    // The AI falls back to Monday-Saturday 9:00 AM-6:00 PM (for its own timing only,
    // never told to customers) when no day is marked open.
    hours_on_record: hours.some((h) => h.open),
    booking_capacity: bookingCapacityView(dealer), // stream R
    ai_daily_call_tasks: dailyCallTasksView(dealer), // stream T
  };
}

// Client, 8 Oct 2026 meeting: only AutoPulse super admins change AI settings (dealers view them, so they can't drive
// up costs) - a super admin signed in directly or inside the dealer account (app/lib/apiAuth.js).
async function canChange(req) {
  return (await loadSettingsEditor(req)).superAdmin;
}

async function loadDealer(dealerId) {
  return User.findOne({ _id: dealerId, type: "dealer" })
    .select("name ai_mode setting ai_mms_enabled dealer_account_information")
    .lean();
}

export async function GET(req) {
  const session = await requireDealerSession(req, new URL(req.url).searchParams.get("dealer_id"));
  if (session.error) return session.error;
  const dealer = await loadDealer(session.dealerId);
  if (!dealer) return jsonError("Dealership not found", 404);
  return NextResponse.json({ ...describe(dealer), can_change: await canChange(req) });
}

export async function PUT(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError("Body must be JSON", 400);
  }
  const session = await requireDealerSession(req, body?.dealer_id);
  if (session.error) return session.error;
  if (!(await canChange(req))) {
    return jsonError(SETTINGS_VIEW_ONLY_MESSAGE, 403);
  }

  const set = {};
  if (body.ai_mode !== undefined) {
    if (!AI_MODES.includes(body.ai_mode)) return jsonError(`AI mode must be one of ${AI_MODES.join(", ")}`, 422);
    set.ai_mode = body.ai_mode;
  }
  if (body.mms_enabled !== undefined) {
    if (typeof body.mms_enabled !== "boolean") return jsonError("mms_enabled must be true or false", 422);
    set.ai_mms_enabled = body.mms_enabled;
  }
  if (body.booking_capacity !== undefined) {
    const capacity = bookingCapacityUpdate(body.booking_capacity);
    if (capacity.errors.length) return jsonError(capacity.errors.join("; "), 422);
    Object.assign(set, capacity.set);
  }
  if (body.ai_daily_call_tasks !== undefined) { // stream T
    const daily = dailyCallTasksUpdate(body.ai_daily_call_tasks);
    if (daily.error) return jsonError(daily.error, 422);
    Object.assign(set, daily.set);
  }
  if (!Object.keys(set).length) return jsonError("Nothing to change", 400);

  const before = await loadDealer(session.dealerId);
  if (!before) return jsonError("Dealership not found", 404);
  // strict: false - ai_mms_enabled isn't in the shared User schema yet (see stream_C2.md).
  await User.updateOne({ _id: session.dealerId, type: "dealer" }, { $set: set }, { strict: false });
  invalidateDealerAiMode(session.dealerId);

  let followUpJobsCleared = 0;
  if (set.ai_mode === "live" && before.ai_mode !== "live") {
    const result = await FollowUpJob.deleteMany({ dealer_id: String(session.dealerId), status: "pending" });
    followUpJobsCleared = result.deletedCount;
  }
  console.info("[ai] dealer AI settings changed from the dealer portal", {
    dealer_id: session.dealerId, ...set, by: await staffName(session.user), follow_up_jobs_cleared: followUpJobsCleared,
  });
  const dealer = await loadDealer(session.dealerId);
  return NextResponse.json({ ...describe(dealer), can_change: true, follow_up_jobs_cleared: followUpJobsCleared });
}
