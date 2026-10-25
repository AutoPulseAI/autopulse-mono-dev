// GET /api/ai/system-status - is the AI paused for the whole platform (agentic-upsell agent/provider_health.py: the
// model provider stopped answering, e.g. the OpenAI credit ran out)? Read by the banner on every admin and dealer page
// (26 Oct 2026: "where on the admin dashboard, even in AI Studio, can we see that the AI is on or off?"). Only whether
// it's paused, since when, and how many messages are waiting - nothing about any customer.
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await dbConnect();
    const db = mongoose.connection.db;
    const row = await db.collection('ai_system_status').findOne({ _id: 'llm' });
    const paused = !!row?.down;
    const held = paused ? await db.collection('ai_held_events').countDocuments({}) : 0;
    const credit = /credit|quota|billing/i.test(String(row?.reason || ''));
    return NextResponse.json({
      paused,
      since: paused ? row.since : null,
      held,
      why: paused ? (credit ? 'The OpenAI credit ran out.' : 'The AI model provider is not answering.') : null,
    });
  } catch (error) {
    return NextResponse.json({ paused: false, error: 'status unavailable' }, { status: 200 });
  }
}
