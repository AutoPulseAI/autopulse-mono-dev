// Whether the dealer sidebar shows "Reports". The server decides (GET /api/reports/kpis?check=1 answers 404 unless the
// 'reports_page' feature is visible to the caller, app/lib/reporting/featureFlags.js). While the feature is at
// level 'admin', only a super admin - signed in directly or through "login as" - can see it, so the sidebar asks the
// server only for those sessions: dealers and staff make no extra request and see no change.
import { featureLevel } from "../../lib/reporting/featureFlags";

function tokenPayload() {
  try {
    const token = localStorage.getItem("dealertoken") || "";
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export async function reportsVisible(dealerId) {
  if (typeof window === "undefined" || !dealerId) return false;
  const payload = tokenPayload();
  if (!payload) return false;
  const admin = payload.type === "admin" || payload.impersonator_type === "admin";
  if (!admin && featureLevel("reports_page") === "admin") return false;
  try {
    const res = await fetch(`/api/reports/kpis?check=1&dealer_id=${encodeURIComponent(dealerId)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
