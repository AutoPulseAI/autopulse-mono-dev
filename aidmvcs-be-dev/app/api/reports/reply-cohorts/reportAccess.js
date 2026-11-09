// Shared by the dashboard's report routes (/api/reports/reply-cohorts, /api/reports/appointment-split; P1 plan items 2
// and 3): who may call them and which dealer-local days they cover.
//   1. Signed in, for this dealer (app/lib/apiGuard.js requireDealerAccess) -> else 401 / 403.
//   2. The report feature is visible to the caller (app/lib/reporting/featureFlags.js; every new report starts at
//      'admin': a super admin, signed in directly or inside the dealer through "login as") -> else 404, so the
//      dashboard simply shows nothing.
//   3. start_date / end_date: the same ISO instants the dashboard sends to /api/leads/stats, read as the dealer's
//      local calendar days (the dealer's time zone, as the dashboard's date picker). Both are required.
import dbConnect from "../../../lib/mongodb.js";
import { loadSettingsEditor } from "../../../lib/apiAuth.js";
import { denied, requireDealerAccess } from "../../../lib/apiGuard.js";
import { isFeatureVisible } from "../../../lib/reporting/featureFlags.js";
import { getDealerTimezone, toLocalDate } from "../../../lib/reporting/time.js";

export const MAX_RANGE_DAYS = 366;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Whether `user` (the signed-in account, already allowed for dealerId) may see a report feature: a super admin signed
// in directly, or a dealer account opened through "login as" (the token's impersonated_by). Also used by
// /api/leads for the dashboard's reply / appointment drill-down links.
export async function callerSeesFeature(req, user, dealerId, feature) {
  if (!user) return false;
  // "Login as" tokens carry the dealer's id; loadSettingsEditor reads the token's impersonated_by.
  const editor = await loadSettingsEditor(req);
  const sameUser = editor.user && String(editor.user._id) === String(user._id);
  const superAdmin = user.type === "admin" || Boolean(sameUser && editor.superAdmin);
  return isFeatureVisible(feature, { user, superAdmin, dealerId: String(dealerId) });
}

// The dashboard's ISO instants as the dealer's local calendar days -> { from, to } or { error }.
export function localRange(startValue, endValue, tz) {
  const from = toLocalDate(startValue, tz);
  const to = toLocalDate(endValue, tz);
  if (!from || !to) return { error: "start_date and end_date are required" };
  if (to < from) return { error: "end_date is before start_date" };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) return { error: `pick at most ${MAX_RANGE_DAYS} days` };
  return { from, to };
}

/** @returns {Promise<{response: Response} | {dealerId: string, tz: string, from: string, to: string, searchParams}>} */
export async function reportRequest(req, feature) {
  const { searchParams } = new URL(req.url);
  const dealerId = searchParams.get("dealer_id");
  await dbConnect();
  const access = await requireDealerAccess(req, dealerId);
  if (access.response) return { response: access.response };
  if (!(await callerSeesFeature(req, access.user, dealerId, feature))) {
    return { response: denied(404, "Not found") };
  }

  const tz = await getDealerTimezone(dealerId);
  const range = localRange(searchParams.get("start_date"), searchParams.get("end_date"), tz);
  if (range.error) return { response: json({ error: range.error }, 400) };
  return { dealerId: String(dealerId), tz, from: range.from, to: range.to, searchParams };
}
