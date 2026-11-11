// Whether this session shows the Desk Log menu line. While the 'desk_log' feature is at level 'admin'
// (app/lib/reporting/featureFlags.js), only a super admin - directly or through "login as" - sees it; dealers and
// staff see the menu exactly as before. The page and its API check again on the server.
import { featureLevel } from "../../lib/reporting/featureFlags";

export function deskLogMenuVisible() {
  if (typeof window === "undefined") return false;
  if (featureLevel("desk_log") !== "admin") return true;
  try {
    const token = localStorage.getItem("dealertoken") || "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.type === "admin" || payload?.impersonator_type === "admin";
  } catch {
    return false;
  }
}
