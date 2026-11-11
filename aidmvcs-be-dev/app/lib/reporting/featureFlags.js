// Who sees a new report feature while it is rolled out (P1 plan: "shown first to admin 'login as dealer' only, then
// to the dealer"). Levels:
//   admin  a super admin (User.type 'admin'), signed in directly or inside a dealer account through "login as"
//   test   admin, plus the dealers listed in FEATURE_TEST_DEALERS (comma-separated dealer ids)
//   all    everyone who can open the screen
// This only decides visibility. It is not an access check: routes still authenticate and scope the dealer
// (app/lib/apiAuth.js, and the shared guard the security branch adds).
//
// `caller` is what app/lib/apiAuth.js loadSettingsEditor(req) returns - { user, superAdmin } - optionally with the
// dealer the request is for: { user, superAdmin, dealerId }. Without dealerId, a dealer account is its own dealer
// and staff belong to their parent dealer (same rule as requireDealerSession, app/api/dealer-ai/_lib/dealerAi.js).

export const LEVELS = Object.freeze(['admin', 'test', 'all']);

// Every new report feature starts at 'admin'. Move one to 'test', then 'all', by changing this object.
export const FEATURES = Object.freeze({
  reply_cohorts: 'admin',
  appointment_attribution: 'admin',
  kpi_definitions: 'admin',
  reports_page: 'admin',
  daily_performance_email: 'admin',
  desk_log: 'admin', // Desk Log (Priority 3), app/dealer/desk-log
});

export function testDealerIds(env = process.env) {
  return new Set(String(env.FEATURE_TEST_DEALERS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

export function callerDealerId(caller) {
  if (caller?.dealerId) return String(caller.dealerId);
  const user = caller?.user;
  if (user?.type === 'dealer') return String(user.parent_id || user._id);
  return null;
}

export function featureLevel(feature, { config = FEATURES } = {}) {
  const level = config[feature];
  return LEVELS.includes(level) ? level : 'admin';
}

/**
 * @param {string} feature  a key of FEATURES (unknown features are treated as 'admin')
 * @param {{user?: {_id, type, parent_id}, superAdmin?: boolean, dealerId?: string}|null} caller
 * @param {{env?: object, config?: object}} [opts]
 */
export function isFeatureVisible(feature, caller, { env = process.env, config = FEATURES } = {}) {
  if (!caller || (!caller.user && !caller.superAdmin)) return false;
  const level = featureLevel(feature, { config });
  if (caller.superAdmin === true) return true;
  if (level === 'all') return true;
  if (level === 'test') {
    const dealerId = callerDealerId(caller);
    return Boolean(dealerId && testDealerIds(env).has(dealerId));
  }
  return false;
}
