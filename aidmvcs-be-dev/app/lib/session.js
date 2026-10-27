// How long a sign-in lasts (Betsy, 27 Oct 2026 meeting: "I get kicked out all the time"). It was one day unless "remember
// this device" was ticked: the dealertoken cookie ran out mid-shift (900 "No dealertoken" redirects in the CRM's log).
// Now seven days, renewed while the CRM is in use (app/api/auth/me), so someone working in it is never signed out.
import jwt from "jsonwebtoken";

export const SESSION_DAYS = 7;
const RENEW_WHEN_LEFT_S = (SESSION_DAYS - 1) * 86400; // renewed at most once a day

// A fresh token for a signed-in user whose own is past a day old, else null. "Login as" tokens are never renewed.
export function renewedToken(decoded, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!decoded?.userId || decoded.impersonated_by || decoded.rememberDevice || !decoded.exp) return null;
  if (decoded.exp - nowS > RENEW_WHEN_LEFT_S) return null;
  const { iat: _iat, exp: _exp, nbf: _nbf, ...claims } = decoded;
  return jwt.sign(claims, secret, { expiresIn: `${SESSION_DAYS}d` });
}
