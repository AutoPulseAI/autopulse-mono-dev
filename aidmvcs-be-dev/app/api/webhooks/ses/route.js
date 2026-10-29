// POST /api/webhooks/ses - Amazon SNS delivers SES email events here (app/lib/ai/sesEvents.js). The first message is a
// subscription confirmation, which is confirmed once its signature checks out.
import mongoose from 'mongoose';
import dbConnect from '@lib/mongodb';
import Email from '@models/Email';
import Lead from '@models/Lead';
import { applySesEvent, verifySnsMessage } from '@lib/ai/sesEvents';

export async function POST(request) {
  let message;
  try {
    message = JSON.parse(await request.text());  // SNS posts JSON with a text/plain content type
  } catch {
    return Response.json({ error: 'not JSON' }, { status: 400 });
  }
  if (!(await verifySnsMessage(message))) return Response.json({ error: 'signature not valid' }, { status: 403 });
  if (message.Type === 'SubscriptionConfirmation') {
    const res = await fetch(message.SubscribeURL);
    return Response.json({ confirmed: res.ok });
  }
  if (message.Type !== 'Notification') return Response.json({ ok: true });
  let event;
  try {
    event = JSON.parse(message.Message);
  } catch {
    return Response.json({ error: 'event not JSON' }, { status: 400 });
  }
  try {
    await dbConnect();
    const result = await applySesEvent(event, { Email, Lead, db: mongoose.connection });
    return Response.json(result);
  } catch (error) {
    console.error('[ses webhook]', error?.message);
    return Response.json({ error: 'could not apply' }, { status: 500 });  // SNS retries
  }
}
