// GET /api/email/open?k=<idempotency key>&s=<signature> - the 1x1 image in an AI email (app/lib/ai/emailTracking.js):
// records the first open and counts them on the email, so the conversation shows "Opened". Always returns the image.
import dbConnect from '@lib/mongodb';
import Email from '@models/Email';
import { PIXEL, validKey } from '@lib/ai/emailTracking';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('k');
  if (validKey(key, searchParams.get('s'))) {
    try {
      await dbConnect();
      const now = new Date();
      await Email.collection.updateOne({ ai_idempotency_key: key }, { $inc: { open_count: 1 }, $min: { opened_at: now } });
    } catch (error) {
      console.error('[email open]', error?.message);
    }
  }
  return new Response(PIXEL, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' } });
}
