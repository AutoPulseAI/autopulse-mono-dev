// GET /l/<code> - a short link the AI sent (Betsy, 22 Oct 2026: "when a link has to be sent ... a short autopulse link
// that opens the same page"). Written by the AI service (agentic-upsell agent/short_links.py) into ai_short_links;
// public, like the page it opens. An unknown code goes to the home page, never an error page.
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';

const CODE = /^[A-Za-z0-9]{5,16}$/;

export async function GET(req, { params }) {
  const { code } = await params;
  const home = new URL('/', req.url);
  if (!CODE.test(String(code || ''))) return NextResponse.redirect(home, 302);
  try {
    await dbConnect();
    const links = mongoose.connection.db.collection('ai_short_links');
    const link = await links.findOneAndUpdate({ code }, { $inc: { clicks: 1 }, $set: { last_click_at: new Date() } },
      { returnDocument: 'after' });
    const url = (link?.value ?? link)?.url;
    if (!url || !/^https?:\/\//i.test(url)) return NextResponse.redirect(home, 302);
    return NextResponse.redirect(url, 302);
  } catch (error) {
    console.error('[ai] short link failed', { code, error: error?.message });
    return NextResponse.redirect(home, 302);
  }
}
