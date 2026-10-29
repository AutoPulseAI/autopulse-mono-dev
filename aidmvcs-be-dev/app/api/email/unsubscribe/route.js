// GET /api/email/unsubscribe?k=<idempotency key>&s=<signature> - the unsubscribe link in an AI email
// (app/lib/ai/emailTracking.js; Betsy and Bibi, 28 Oct 2026 meeting). The customer stops getting the AI's emails: an
// email opt-out the AI reads (ai_consent, as agentic-upsell channels/consent.py writes it) - texts are not touched
// (an opt-out stops only its channel) - the lead is marked, and staff get a note in the conversation.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Email from '@models/Email';
import Lead from '@models/Lead';
import { validKey } from '@lib/ai/emailTracking';

const page = (title, body) => new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport"
  content="width=device-width, initial-scale=1"/><title>${title}</title></head><body style="font-family:Arial,sans-serif;
  max-width:520px;margin:60px auto;padding:0 16px;color:#262a2a"><h2>${title}</h2><p>${body}</p></body></html>`,
{ headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('k');
  if (!validKey(key, searchParams.get('s'))) return page('Link not valid', 'This unsubscribe link is not valid.');
  try {
    await dbConnect();
    const email = await Email.findOne({ ai_idempotency_key: key }).select('lead_id dealer_id ai_customer_id recipient').lean();
    if (!email) return page('Link not valid', 'We could not find this email.');
    const lead = await Lead.findById(email.lead_id).select('email dealer_id email_unsubscribed').lean();
    const address = String(lead?.email || email.recipient || '').trim().toLowerCase() || null;
    const now = new Date();
    if (!lead?.email_unsubscribed) {
      await mongoose.connection.collection('ai_consent').insertOne({
        dealer_id: String(email.dealer_id), customer_id: email.ai_customer_id || null, channel: 'email',
        consent_type: 'opt_out', consent_status: 'opted_out', consent_source: 'email_unsubscribe_link',
        consent_timestamp: now, consent_text_version: null, consent_evidence_id: `unsubscribe:${key}`,
        consenting_seller_id: String(email.dealer_id), source_url: null, lead_id: String(email.lead_id),
        evidence: { email_id: String(email._id) }, recorded_at: now, ...(address ? { address } : {}),
      });
      await Lead.collection.updateOne({ _id: email.lead_id }, { $set: { email_unsubscribed: true, email_unsubscribed_at: now } });
      await Email.create({
        sender: 'AutoPulse AI', recipient: 'staff', subject: 'Lead Note', status: 'sent', communication_type: 'note',
        mail_content: 'The customer unsubscribed from emails (the link in our email). No more emails go to them; texts '
          + 'are not affected.',
        dealer_id: String(email.dealer_id), lead_id: email.lead_id, is_note: true, internal_use: true,
        message_id: `note_unsubscribe_${key}`, timestamp: now, date: now, ai_generated: true,
      });
    }
    return page("You're unsubscribed", "You won't receive these emails from us anymore.");
  } catch (error) {
    console.error('[email unsubscribe]', error?.message);
    return page('Something went wrong', 'Please try the link again in a few minutes.');
  }
}
