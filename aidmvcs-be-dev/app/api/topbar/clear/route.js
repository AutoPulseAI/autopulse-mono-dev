// POST /api/topbar/clear  clear notifications from the signed-in user's bell.
//   body { keys: [...] }              these notifications
//   body { all: true, keys: [...] }   Clear all: the alerts / calls listed in keys, plus every new lead, reassignment
//                                     and takeover up to now
// Hides them for this user only; it never marks an alert handled or completes a task.
import NotificationClear from "@models/NotificationClear";
import { jsonError, requireDealerSession } from "../../dealer-ai/_lib/dealerAi";

export const dynamic = "force-dynamic";
const KEY = /^(alert|call|new|moved|taken):[A-Za-z0-9_-]{1,64}$/;
const MAX = 1000;

export async function POST(req) {
  const url = new URL(req.url);
  const session = await requireDealerSession(req, url.searchParams.get("dealer_id"));
  if (session.error) return session.error;
  let body;
  try { body = await req.json(); } catch { return jsonError("The request body must be JSON", 400); }
  const keys = [...new Set((Array.isArray(body?.keys) ? body.keys : []).map(String))];
  if (keys.length > MAX) return jsonError(`At most ${MAX} notifications at a time`, 400);
  if (keys.some((k) => !KEY.test(k))) return jsonError("Unknown notification", 400);
  if (!keys.length && body?.all !== true) return jsonError("Nothing to clear", 400);
  const who = { user_id: session.user._id, dealer_id: session.dealerId };
  const at = new Date();
  const ops = keys.map((key) => ({ updateOne: { filter: { ...who, key }, update: { $set: { at } }, upsert: true } }));
  if (body?.all === true) ops.push({ updateOne: { filter: { ...who, key: "all" }, update: { $set: { at } }, upsert: true } });
  await NotificationClear.bulkWrite(ops, { ordered: false });
  return Response.json({ ok: true, cleared: keys.length });
}
