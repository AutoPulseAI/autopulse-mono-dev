// Admin-only: read and change each dealer's AI mode (MASTER_PLAN_1 Stage 5,
// BPLAN Phase 1). This is the rollout switch: off -> shadow -> live, and back
// to off to roll back (effective everywhere within 60s, the aiMode cache TTL).
//
//   GET /api/admin/ai-mode                  every dealer with its mode
//   GET /api/admin/ai-mode?dealer_id=<id>   one dealer
//   PUT /api/admin/ai-mode  { dealer_id, ai_mode: "off" | "shadow" | "live" }

import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import { requireAdmin } from '@lib/adminAuth';
import { AI_MODES, effectiveAiMode, invalidateDealerAiMode } from '@lib/ai/aiMode';
import User from '@models/User';
import FollowUpJob from '@models/FollowUpJob';

function describe(dealer) {
  return {
    dealer_id: String(dealer._id),
    name: dealer.name,
    ai_mode: AI_MODES.includes(dealer.ai_mode) ? dealer.ai_mode : 'off',
    auto_reply_enabled: dealer.setting?.autoReplyEnabled !== false,
    // What actually applies: auto-replies turned off means no AI replies either.
    effective_mode: effectiveAiMode(dealer),
  };
}

export async function GET(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  await dbConnect();
  const dealerId = new URL(request.url).searchParams.get('dealer_id');
  if (dealerId) {
    if (!mongoose.isValidObjectId(dealerId)) {
      return NextResponse.json({ error: 'Invalid dealer_id' }, { status: 400 });
    }
    const dealer = await User.findOne({ _id: dealerId, type: 'dealer' }).select('name ai_mode setting').lean();
    if (!dealer) return NextResponse.json({ error: 'Dealer not found' }, { status: 404 });
    return NextResponse.json(describe(dealer));
  }

  const dealers = await User.find({ type: 'dealer' }).select('name ai_mode setting').sort({ name: 1 }).lean();
  return NextResponse.json({ dealers: dealers.map(describe) });
}

export async function PUT(request) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const { dealer_id: dealerId, ai_mode: aiMode } = body || {};
  if (!mongoose.isValidObjectId(dealerId)) {
    return NextResponse.json({ error: 'Invalid dealer_id' }, { status: 400 });
  }
  if (!AI_MODES.includes(aiMode)) {
    return NextResponse.json({ error: `ai_mode must be one of ${AI_MODES.join(', ')}` }, { status: 422 });
  }

  await dbConnect();
  const dealer = await User.findOneAndUpdate(
    { _id: dealerId, type: 'dealer' },
    { $set: { ai_mode: aiMode } },
    { new: true, runValidators: true, projection: 'name ai_mode setting' },
  ).lean();
  if (!dealer) return NextResponse.json({ error: 'Dealer not found' }, { status: 404 });

  invalidateDealerAiMode(dealerId);

  // Going live hands follow-ups to the AI service: the dealer's pending
  // rule-based FollowUpJobs are cleared so nobody gets both (Stage 11).
  let followUpJobsCleared = 0;
  if (aiMode === 'live') {
    const result = await FollowUpJob.deleteMany({ dealer_id: String(dealerId), status: 'pending' });
    followUpJobsCleared = result.deletedCount;
  }
  console.info('[ai] dealer AI mode changed', {
    dealer_id: dealerId, ai_mode: aiMode, by: auth.decoded?.userId, follow_up_jobs_cleared: followUpJobsCleared,
  });
  return NextResponse.json({ ...describe(dealer), follow_up_jobs_cleared: followUpJobsCleared });
}
