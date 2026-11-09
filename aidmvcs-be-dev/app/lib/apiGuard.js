// Who may call an API route (security fixes, Nov 2026). Middleware protects no /api route, so each route checks here.
//
// A caller is recognised the way the CRM's own pages send their sign-in:
//   1. `Authorization: Bearer <token>` (localStorage "dealertoken" / "vendortoken" / "token"), and when that is
//      missing or invalid,
//   2. the sign-in cookies set at login (`admintoken`, `dealertoken`, `vendortoken`, app/api/auth/login), which the
//      browser sends with the pages' same-origin fetches that carry no header (e.g. the admin cron buttons, the
//      dealer lead list's stats call).
// The user is always re-read from the database (a deleted user's token stops working). Dealer scope uses the
// existing rule in customerListing.js (isAuthorizedForDealer): super admin -> any dealer, dealer owner/staff -> their
// own dealership, agency (and its staff) -> dealers whose vendor_id is the agency. "Login as" tokens carry the
// target user's id, so a super admin or agency inside a dealer account acts as that dealer.
//
// Each require* returns { user } when allowed, or { response } (401/403) to return as is.

import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import dbConnect from "./mongodb.js";
import User from "../models/User.js";
import { isAuthorizedForDealer } from "./customerListing.js";

const SESSION_COOKIES = ["admintoken", "dealertoken", "vendortoken"];
const USER_FIELDS = "_id name email type parent_id vendor_id role";

export function denied(status, message = status === 401 ? "Unauthorized" : "Forbidden") {
  return new Response(JSON.stringify({ message }), { status, headers: { "Content-Type": "application/json" } });
}

function bearerToken(req) {
  const header = req.headers.get("authorization");
  if (!header || !/^Bearer\s+\S+$/.test(header)) return null;
  return header.replace(/^Bearer\s+/, "");
}

function cookieTokens(req) {
  const raw = req.headers.get("cookie");
  if (!raw) return [];
  const jar = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (SESSION_COOKIES.includes(name) && !jar[name]) {
      try { jar[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { jar[name] = part.slice(i + 1).trim(); }
    }
  }
  return SESSION_COOKIES.map((n) => jar[n]).filter(Boolean);
}

async function userFromToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded?.userId || !mongoose.isValidObjectId(decoded.userId)) return null;
  await dbConnect(); // some routes (e.g. /api/cron/report-service) never connect themselves
  const user = await User.findById(decoded.userId).select(USER_FIELDS);
  return user || null;
}

// Every signed-in user the request carries: the Bearer one alone when it is valid, else each valid session cookie.
async function requestUsers(req) {
  const bearer = await userFromToken(bearerToken(req));
  if (bearer) return [bearer];
  const users = [];
  for (const token of cookieTokens(req)) {
    const user = await userFromToken(token);
    if (user && !users.some((u) => String(u._id) === String(user._id))) users.push(user);
  }
  return users;
}

export async function requireUser(req) {
  const [user] = await requestUsers(req);
  return user ? { user } : { response: denied(401) };
}

export async function requireSuperAdmin(req) {
  const users = await requestUsers(req);
  if (!users.length) return { response: denied(401) };
  const admin = users.find((u) => u.type === "admin");
  return admin ? { user: admin } : { response: denied(403) };
}

// An agency user may also name its own agency: the agency's Email Accounts and Conversations pages send the agency's
// own id as dealer_id (its own records).
export async function requireDealerAccess(req, dealerId) {
  const users = await requestUsers(req);
  if (!users.length) return { response: denied(401) };
  if (dealerId === null || dealerId === undefined || String(dealerId) === "") return { response: denied(403) };
  for (const user of users) {
    if (await isAuthorizedForDealer(user, String(dealerId))) return { user };
    if (user.type === "vendor" && String(user.parent_id || user._id) === String(dealerId)) return { user };
  }
  return { response: denied(403) };
}

// Routes that take an optional dealer_id: with one, that dealer's access rule; without one (all dealers' data), super
// admin only.
export async function requireDealerOrSuperAdmin(req, dealerId) {
  if (dealerId === null || dealerId === undefined || String(dealerId) === "") return requireSuperAdmin(req);
  return requireDealerAccess(req, dealerId);
}

// Agency dashboards (?vendor_id=&dealer_id=): a super admin, or an agency user asking for its own agency (the agency
// owner's id; the dashboard sends the signed-in user's own id) and, when named, one of that agency's dealers.
export async function requireAgencyAccess(req, vendorId, dealerId) {
  const users = await requestUsers(req);
  if (!users.length) return { response: denied(401) };
  for (const user of users) {
    if (user.type === "admin") return { user };
    if (user.type !== "vendor" || !vendorId) continue;
    const own = [String(user._id), String(user.parent_id || "")].includes(String(vendorId));
    if (!own) continue;
    if (dealerId && !(await isAuthorizedForDealer(user, String(dealerId)))) continue;
    return { user };
  }
  return { response: denied(403) };
}

// Routes that act for one account named in the request (a ticket's creator, a subscription's owner, ...): the
// account itself, a super admin, its dealership's owner/staff, its agency's staff, or the agency of that dealer
// (the same rule as requireDealerAccess, plus "yourself").
export async function requireActingFor(req, accountId) {
  const users = await requestUsers(req);
  if (!users.length) return { response: denied(401) };
  if (accountId === null || accountId === undefined || String(accountId) === "") return { response: denied(403) };
  const self = users.find((u) => String(u._id) === String(accountId));
  if (self) return { user: self };
  return requireDealerAccess(req, accountId);
}

// A signed-in caller's own dealership (dealer owner -> self, dealer staff -> parent), or null for admin/agency.
export function ownDealerId(user) {
  if (!user || user.type !== "dealer") return null;
  return String(user.parent_id || user._id);
}

function constantTimeEquals(a, b) {
  const da = crypto.createHash("sha256").update(String(a)).digest();
  const db = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

// The server's own scheduled calls to /api/cron/*: header `x-cron-secret: <CRON_SECRET>` or
// `Authorization: Bearer <CRON_SECRET>`. False when CRON_SECRET is not set.
export function hasCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const given = req.headers.get("x-cron-secret") || bearerToken(req);
  return Boolean(given) && constantTimeEquals(given, expected);
}

// /api/cron/* routes: a super admin (the admin panel's buttons) or the cron secret.
// `openUntilSecretSet`: routes the server's scheduler may call without a header today (documented crontab/curl
// callers this repo cannot see, and app/lib/appointmentReminderCronService.js calling back into the app). For those,
// until CRON_SECRET is configured, calls are still let through (logged) so scheduled campaigns and reminders keep
// running; once CRON_SECRET is set they need it.
export async function requireCronCaller(req, { openUntilSecretSet = false } = {}) {
  if (hasCronSecret(req)) return { user: null, cron: true };
  const users = await requestUsers(req);
  const admin = users.find((u) => u.type === "admin");
  if (admin) return { user: admin };
  if (openUntilSecretSet && !process.env.CRON_SECRET) {
    console.warn(`[cron] ${new URL(req.url).pathname} called without the cron secret; allowed until CRON_SECRET is set`);
    return { user: null, cron: true };
  }
  return { response: denied(users.length ? 403 : 401) };
}
