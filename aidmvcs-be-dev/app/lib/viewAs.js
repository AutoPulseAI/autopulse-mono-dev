// "View as" an employee (Betsy, 25 Nov 2026: "if I want to view as Mercy ... I want to see what she has access to ...
// when we do training, see what they're seeing and help them"). The dealership account, or staff who manage employees,
// open the CRM as one of their own staff: a sign-in token for that staff member marked `view_as`. It is look-only:
// middleware.js refuses every change (POST / PUT / PATCH / DELETE to /api) made with it. The screens show a banner with
// "Back to my account".

/** May `viewer` view the CRM as `target`? viewer: the dealership itself, or its staff with "Manage Employee". */
export function mayViewAs(viewer, target, viewerPermissions = []) {
  if (!viewer || !target || viewer.type !== 'dealer' || target.type !== 'dealer') return false;
  if (!target.parent_id) return false; // only staff are viewed as
  if (String(viewer._id) === String(target._id)) return false;
  const viewerDealership = String(viewer.parent_id || viewer._id);
  if (String(target.parent_id) !== viewerDealership) return false;
  return !viewer.parent_id || viewerPermissions.includes('Manage Employee');
}

/** The payload of a JWT without checking its signature - only to REFUSE (a token can't grant itself anything here). */
export function tokenPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = typeof atob === 'function'
      ? atob(part.replace(/-/g, '+').replace(/_/g, '/'))
      : Buffer.from(part, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** True when this request changes something with a "view as" token (middleware.js answers 403). */
export function viewAsWriteRequest({ method, pathname, authorization, cookieTokens = [] }) {
  if (!pathname.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())) return false;
  if (pathname.startsWith('/api/auth/logout')) return false;
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization || '')?.[1];
  const tokens = bearer ? [bearer] : cookieTokens;
  return tokens.some((t) => tokenPayload(t)?.view_as === true);
}
