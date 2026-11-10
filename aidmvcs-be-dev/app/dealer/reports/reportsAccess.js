// Whether this session sees the report tabs on the Dashboard (app/dealer/dashboard/page.js). The server decides
// (GET /api/reports/kpis?check=1 answers 404 unless the 'reports_page' feature is visible to the caller,
// app/lib/reporting/featureFlags.js). While the feature is at level 'admin', only a super admin - signed in directly or
// through "login as" - can see it, so the Dashboard asks the server only for those sessions: dealers and staff make no
// extra request and see the Dashboard exactly as before (no tab row).
import { featureLevel } from "../../lib/reporting/featureFlags";

// The Dashboard's tabs: Overview (the Dashboard itself), then one per report. /dealer/dashboard?tab=<key>.
export const DASHBOARD_TABS = Object.freeze([
  ["overview", "Overview"], ["executive", "Executive"], ["appointments", "Appointments"], ["ai", "AI performance"],
  ["lead_source", "Lead source"], ["bdc", "BDC"], ["service", "Service"], ["data_quality", "Data quality"],
  ["sales", "Sales / Desk Log"], ["definitions", "Definitions"],
]);

/**
 * The tab the Dashboard shows. `requested` is ?tab=, `allowed` is reportsVisible(): null while it is being checked.
 * Overview unless the report tabs are visible; null = wait (a report tab was asked for and the check is running).
 */
export function dashboardTab(requested, allowed) {
  const known = DASHBOARD_TABS.some(([key]) => key === requested);
  if (!known || requested === "overview" || allowed === false) return "overview";
  return allowed === true ? requested : null;
}

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
