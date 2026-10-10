// Whether this browser session may edit the dealership's settings: an AutoPulse super admin, signed in directly or
// inside the dealer account through "login as" (its token carries impersonated_by / impersonator_type). Only for
// showing the page view-only; the server checks it on every save (app/lib/apiAuth.js loadSettingsEditor).
export function canEditDealerSettings() {
  if (typeof window === "undefined") return false;
  try {
    const token = localStorage.getItem("dealertoken") || "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.type === "admin" || payload.impersonator_type === "admin";
  } catch {
    return false;
  }
}
