import dbConnect from '@lib/mongodb';
import Vehicle from '@models/Vehicle';
import { imageType } from '@lib/imageType';

// A vehicle's own photo, served with its image type (Betsy, 27 Oct 2026 meeting: the Tesla Model 3 lead's first text
// had no photo). The stock-photo host most of the feed uses (imageonthefly.autodatadirect.com) answers without a
// content type or a size, so the AI's image check turned 8 of 9 such photos down - and Twilio refuses MMS media with
// no content type. The AI attaches this URL instead. Not an open proxy: only photo `n` of vehicle `vin` in dealer
// `dealerId`'s own stock is fetched, and only a real JPEG / PNG / GIF / WebP within 5 MB is served.

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

function photoLinks(doc) {
  if (doc?.imagesSecure?.length) return doc.imagesSecure;
  if (doc?.photourls) return String(doc.photourls).split('|');
  return [];
}

const notFound = (why) => new Response(why, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request, { params }) {
  const { dealerId, vin, n } = await params;
  const index = Number.parseInt(String(n).replace(/\.\w+$/, ''), 10);
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(String(vin)) || !/^[a-f0-9]{24}$/i.test(String(dealerId))
      || !Number.isInteger(index) || index < 0 || index > 60) {
    return notFound('no such photo');
  }
  await dbConnect();
  const doc = await Vehicle.findOne({ dealerId: String(dealerId), vin: String(vin).toUpperCase() })
    .select('imagesSecure photourls').lean();
  const url = String(photoLinks(doc)[index] || '').trim();
  if (!url.startsWith('https://')) return notFound('no such photo');

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  } catch {
    return new Response('photo host unreachable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!response.ok || !response.body) {
    return new Response('photo host error', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) return new Response('photo too large', { status: 413, headers: { 'Cache-Control': 'no-store' } });
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const type = imageType(bytes);
  if (!type) return new Response('not an image', { status: 415, headers: { 'Cache-Control': 'no-store' } });
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(bytes.length), 'Cache-Control': 'public, max-age=86400' },
  });
}

// Twilio and the AI's image check ask with HEAD first.
export async function HEAD(request, ctx) {
  const full = await GET(request, ctx);
  return new Response(null, { status: full.status, headers: full.headers });
}
