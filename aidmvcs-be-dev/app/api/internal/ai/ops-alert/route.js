// POST /api/internal/ai/ops-alert - the AI service emails AutoPulse when it switches itself off (its model provider -
// OpenAI - stopped answering, e.g. no credit) and when it's back on (Betsy, 23 Oct 2026: "we need to be notified
// immediately by email - me and Bibi only, NOT the dealer"). Shared-secret auth. Body: {subject, text}.
// Recipients: AI_OPS_ALERT_EMAILS (comma-separated), else Betsy and Bibi.
import { NextResponse } from 'next/server';
import { verifyInternalServiceToken } from '@lib/internalServiceAuth';
import { sendEmail } from '@lib/emailservice';

const DEFAULT_TO = 'betsy@autopulse.ai,bsingh@autopulse.ai';
const escape = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function POST(req) {
  if (!verifyInternalServiceToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  const subject = String(body?.subject || '').trim().slice(0, 200);
  const text = String(body?.text || '').trim().slice(0, 5000);
  if (!subject || !text) return NextResponse.json({ error: 'subject and text are required' }, { status: 422 });
  const to = String(process.env.AI_OPS_ALERT_EMAILS || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean);
  const html = `<p>${escape(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
    + `<p style="color:#888">Sent ${new Date().toISOString()} by the AutoPulse AI service.</p>`;
  const sent = [];
  for (const address of to) {
    if (await sendEmail({ to: address, subject, html })) sent.push(address);
  }
  console.warn('[ai] ops alert', { subject, sent });
  return NextResponse.json({ sent: sent.length > 0, to: sent });
}
